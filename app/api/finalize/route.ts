import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import { getTravelPlanner } from "@/lib/travel-planner";

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

    const llmClient = getLLMClient();
    const llmResult = await llmClient.finalizePlan({
      tripInfo: session.tripInfo,
      expandedDays: session.expandedDays,
    });

    if (!llmResult.success) {
      return NextResponse.json(llmResult, { status: 500 });
    }

    let finalPlan = llmResult.finalPlan;
    try {
      const planner = getTravelPlanner();
      finalPlan = await planner.enrichFinalPlan(finalPlan);
    } catch (enrichError) {
      console.warn("Places enrichment failed, continuing without:", (enrichError as Error).message);
    }

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.FINALIZE,
      finalPlan,
    });
    sessionStore.addToConversation(sessionId, "assistant", llmResult.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.FINALIZE,
      message: llmResult.message,
      finalPlan,
    });
  } catch (error) {
    console.error("Error in finalize:", error);
    return NextResponse.json(
      { success: false, message: "Failed to finalize itinerary", error: String(error) },
      { status: 500 }
    );
  }
}
