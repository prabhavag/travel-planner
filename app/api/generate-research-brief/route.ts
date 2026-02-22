import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import { mergeResearchBriefAndSelections } from "@/lib/services/card-merging";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, depth, mode } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId" },
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

    if (!session.tripInfo.destination || !session.tripInfo.startDate || !session.tripInfo.endDate) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required trip info: destination, startDate, or endDate",
        },
        { status: 400 }
      );
    }

    const llmClient = getLLMClient();
    const requestDepth = depth === "deep" ? "deep" : "fast";
    const requestMode = mode === "augment" ? "augment" : "refresh";

    if (requestMode === "augment" && session.tripResearchBrief) {
      const currentOptionCount = session.tripResearchBrief.popularOptions.length;
      const refreshedSession = sessionStore.get(sessionId);
      const result = await llmClient.runInitialResearchDebriefAgent({
        tripInfo: session.tripInfo,
        currentBrief: session.tripResearchBrief,
        researchOptionSelections: session.researchOptionSelections || {},
        conversationHistory: refreshedSession?.conversationHistory || [],
        userMessage:
          "Add 3 to 5 new and distinct research options that fit this trip. Avoid duplicates and keep strong source evidence.",
      });

      if (result.success) {
        const addedCount = Math.max(
          0,
          (result.tripResearchBrief?.popularOptions.length || 0) - currentOptionCount
        );
        const assistantMessage =
          addedCount > 0
            ? `Added ${addedCount} new suggestion${addedCount === 1 ? "" : "s"}. ${result.message}`
            : result.message;

        sessionStore.update(sessionId, {
          workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
          tripResearchBrief: result.tripResearchBrief,
          researchOptionSelections: result.researchOptionSelections,
        });
        sessionStore.addToConversation(sessionId, "assistant", assistantMessage);

        return NextResponse.json({
          success: true,
          sessionId,
          workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
          message: assistantMessage,
          tripResearchBrief: result.tripResearchBrief,
          researchOptionSelections: result.researchOptionSelections,
        });
      }
    }

    const result = await llmClient.generateInitialResearchBrief({
      tripInfo: session.tripInfo,
      depth: requestDepth,
    });

    if (!result.success || !result.tripResearchBrief) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 500 }
      );
    }

    const merged = mergeResearchBriefAndSelections({
      currentBrief: session.tripResearchBrief,
      currentSelections: session.researchOptionSelections || {},
      incomingBrief: result.tripResearchBrief,
    });

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      tripResearchBrief: merged.tripResearchBrief,
      researchOptionSelections: merged.researchOptionSelections,
    });
    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      message: result.message,
      tripResearchBrief: merged.tripResearchBrief,
      researchOptionSelections: merged.researchOptionSelections,
    });
  } catch (error) {
    console.error("Error in generateResearchBrief:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate research brief", error: String(error) },
      { status: 500 }
    );
  }
}
