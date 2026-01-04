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

    if (session.workflowState !== WORKFLOW_STATES.INFO_GATHERING) {
      return NextResponse.json(
        { success: false, message: "Can only generate skeleton from INFO_GATHERING state" },
        { status: 400 }
      );
    }

    if (!session.tripInfo.destination || !session.tripInfo.startDate || !session.tripInfo.endDate) {
      return NextResponse.json(
        { success: false, message: "Missing required trip info: destination, startDate, or endDate" },
        { status: 400 }
      );
    }

    const llmClient = getLLMClient();
    const result = await llmClient.generateSkeleton({ tripInfo: session.tripInfo });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.SKELETON,
      skeleton: result.skeleton,
      currentExpandDay: 1,
    });
    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.SKELETON,
      message: result.message,
      skeleton: result.skeleton,
      tripInfo: session.tripInfo,
      nextDayToExpand: 1,
    });
  } catch (error) {
    console.error("Error in generateSkeleton:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate skeleton", error: String(error) },
      { status: 500 }
    );
  }
}
