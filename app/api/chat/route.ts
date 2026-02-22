import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import { mergeResearchBriefAndSelections } from "@/lib/services/card-merging";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, message } = await request.json();

    if (!sessionId || !message) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId or message" },
        { status: 400 }
      );
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Session not found or expired" },
        { status: 404 }
      );
    }

    sessionStore.addToConversation(sessionId, "user", message);

    const llmClient = getLLMClient();

    if (session.workflowState === WORKFLOW_STATES.INFO_GATHERING) {
      const result = await llmClient.gatherInfo({
        tripInfo: session.tripInfo,
        userMessage: message,
      });

      const oldDestination = session.tripInfo.destination;
      const newDestination = result.tripInfo?.destination;
      const destinationChanged =
        oldDestination &&
        newDestination &&
        oldDestination.toLowerCase() !== newDestination.toLowerCase();

      if (destinationChanged) {
        // Reset activity-related data when destination changes
        sessionStore.update(sessionId, {
          tripInfo: result.tripInfo!,
          tripResearchBrief: null,
          researchOptionSelections: {},
          suggestedActivities: [],
          selectedActivityIds: [],
          dayGroups: [],
          groupedDays: [],
          restaurantSuggestions: [],
          selectedRestaurantIds: [],
          finalPlan: null,
        });
      } else {
        sessionStore.update(sessionId, { tripInfo: result.tripInfo! });
      }
      sessionStore.addToConversation(sessionId, "assistant", result.message);

      const updatedSession = sessionStore.get(sessionId);

      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: updatedSession?.workflowState,
        message: result.message,
        tripInfo: result.tripInfo,
        tripResearchBrief: updatedSession?.tripResearchBrief,
        missingInfo: result.missingInfo,
      });
    } else if (session.workflowState === WORKFLOW_STATES.INITIAL_RESEARCH) {
      if (!session.tripResearchBrief) {
        return NextResponse.json(
          { success: false, message: "Research brief not found. Generate it first." },
          { status: 400 }
        );
      }

      const refreshedSession = sessionStore.get(sessionId);
      const result = await llmClient.runInitialResearchDebriefAgent({
        tripInfo: session.tripInfo,
        currentBrief: session.tripResearchBrief,
        researchOptionSelections: session.researchOptionSelections || {},
        conversationHistory: refreshedSession?.conversationHistory || [],
        userMessage: message,
      });

      if (!result.success) {
        const fallback = await llmClient.refineInitialResearchBrief({
          tripInfo: session.tripInfo,
          currentBrief: session.tripResearchBrief,
          userMessage: message,
        });

        if (!fallback.success || !fallback.tripResearchBrief) {
          const safeMessage =
            result.message || "I couldn't apply that change right now, but your current research cards are unchanged.";
          sessionStore.addToConversation(sessionId, "assistant", safeMessage);
          const updatedSession = sessionStore.get(sessionId);

          return NextResponse.json({
            success: true,
            sessionId,
            workflowState: updatedSession?.workflowState,
            message: safeMessage,
            tripInfo: updatedSession?.tripInfo,
            tripResearchBrief: updatedSession?.tripResearchBrief,
            researchOptionSelections: updatedSession?.researchOptionSelections,
          });
        }

        const merged = mergeResearchBriefAndSelections({
          currentBrief: session.tripResearchBrief,
          currentSelections: session.researchOptionSelections || {},
          incomingBrief: fallback.tripResearchBrief,
        });

        sessionStore.update(sessionId, {
          tripResearchBrief: merged.tripResearchBrief,
          researchOptionSelections: merged.researchOptionSelections,
        });
        sessionStore.addToConversation(sessionId, "assistant", fallback.message);
        const updatedSession = sessionStore.get(sessionId);

        return NextResponse.json({
          success: true,
          sessionId,
          workflowState: updatedSession?.workflowState,
          message: fallback.message,
          tripInfo: updatedSession?.tripInfo,
          tripResearchBrief: updatedSession?.tripResearchBrief,
          researchOptionSelections: updatedSession?.researchOptionSelections,
        });
      }

      sessionStore.update(sessionId, {
        tripResearchBrief: result.tripResearchBrief,
        researchOptionSelections: result.researchOptionSelections,
      });

      sessionStore.addToConversation(sessionId, "assistant", result.message);
      const updatedSession = sessionStore.get(sessionId);

      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: updatedSession?.workflowState,
        message: result.message,
        tripInfo: updatedSession?.tripInfo,
        tripResearchBrief: updatedSession?.tripResearchBrief,
        researchOptionSelections: updatedSession?.researchOptionSelections,
      });
    } else if (session.workflowState === WORKFLOW_STATES.REVIEW) {
      const result = await llmClient.reviewPlan({
        tripInfo: session.tripInfo,
        groupedDays: session.groupedDays,
        userMessage: message,
      });

      // Handle modifications to groupedDays
      if (result.modifications) {
        const updatedGroupedDays = [...session.groupedDays];
        for (const [dayNum, dayData] of Object.entries(result.modifications)) {
          const dayIndex = updatedGroupedDays.findIndex((d) => d.dayNumber === parseInt(dayNum));
          if (dayIndex !== -1) {
            updatedGroupedDays[dayIndex] = { ...updatedGroupedDays[dayIndex], ...(dayData as object) };
          }
        }
        sessionStore.setGroupedDays(sessionId, updatedGroupedDays);
      }

      sessionStore.addToConversation(sessionId, "assistant", result.message);
      const updatedSession = sessionStore.get(sessionId);

      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: session.workflowState,
        message: result.message,
        tripResearchBrief: updatedSession?.tripResearchBrief,
        groupedDays: updatedSession?.groupedDays,
        readyToFinalize: result.readyToFinalize,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: `Chat not available in ${session.workflowState} state. Use the appropriate endpoint.`,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error in chat:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process message", error: String(error) },
      { status: 500 }
    );
  }
}
