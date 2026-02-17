import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";

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
        canProceed: result.isComplete,
        missingInfo: result.missingInfo,
      });
    } else if (session.workflowState === WORKFLOW_STATES.INITIAL_RESEARCH) {
      if (!session.tripResearchBrief) {
        return NextResponse.json(
          { success: false, message: "Research brief not found. Generate it first." },
          { status: 400 }
        );
      }

      const result = await llmClient.refineInitialResearchBrief({
        tripInfo: session.tripInfo,
        currentBrief: session.tripResearchBrief,
        userMessage: message,
      });

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 500 }
        );
      }

      if (result.tripResearchBrief) {
        sessionStore.update(sessionId, { tripResearchBrief: result.tripResearchBrief });
      }

      sessionStore.addToConversation(sessionId, "assistant", result.message);
      const updatedSession = sessionStore.get(sessionId);

      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: updatedSession?.workflowState,
        message: result.message,
        tripInfo: updatedSession?.tripInfo,
        tripResearchBrief: updatedSession?.tripResearchBrief,
      });
    } else if (session.workflowState === WORKFLOW_STATES.SUGGEST_ACTIVITIES) {
      const result = await llmClient.chatDuringSuggestActivities({
        tripInfo: session.tripInfo,
        suggestedActivities: session.suggestedActivities || [],
        selectedActivityIds: session.selectedActivityIds || [],
        userMessage: message,
      });

      // Update trip info if changed
      if (result.tripInfo) {
        sessionStore.update(sessionId, { tripInfo: result.tripInfo });
      }

      // Merge or replace activities
      if (result.newActivities && result.newActivities.length > 0) {
        const existingActivities = result.replaceActivities ? [] : (session.suggestedActivities || []);
        sessionStore.update(sessionId, {
          suggestedActivities: [...existingActivities, ...result.newActivities],
          selectedActivityIds: result.replaceActivities ? [] : (session.selectedActivityIds || []),
        });
      }

      sessionStore.addToConversation(sessionId, "assistant", result.message);
      const updatedSession = sessionStore.get(sessionId);

      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: updatedSession?.workflowState,
        message: result.message,
        tripInfo: updatedSession?.tripInfo,
        tripResearchBrief: updatedSession?.tripResearchBrief,
        suggestedActivities: updatedSession?.suggestedActivities,
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
