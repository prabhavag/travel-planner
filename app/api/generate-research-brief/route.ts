import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

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
    const result = await llmClient.generateInitialResearchBrief({
      tripInfo: session.tripInfo,
    });

    if (!result.success || !result.tripResearchBrief) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 500 }
      );
    }

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      tripResearchBrief: result.tripResearchBrief,
      researchOptionSelections: {},
    });
    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      message: result.message,
      tripResearchBrief: result.tripResearchBrief,
      researchOptionSelections: {},
    });
  } catch (error) {
    console.error("Error in generateResearchBrief:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate research brief", error: String(error) },
      { status: 500 }
    );
  }
}
