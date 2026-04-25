import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, action } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId" },
        { status: 400 }
      );
    }

    if (action !== "reject") {
      return NextResponse.json(
        { success: false, message: "action must be reject" },
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

    if (session.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
      return NextResponse.json(
        {
          success: false,
          message: "LLM refinement resolution is available only in GROUP_DAYS",
        },
        { status: 400 }
      );
    }

    const resolvedResult = session.llmRefinementResult
      ? {
        ...session.llmRefinementResult,
        accepted: false,
        reason: session.llmRefinementResult.reason ?? "Rejected by user.",
      }
      : null;

    sessionStore.update(sessionId, {
      llmRefinementResult: resolvedResult,
      llmRefinementPreview: null,
      tentativeSchedule: null,
    });

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: session.workflowState,
      message: "Rejected LLM itinerary changes.",
      llmRefinementResult: resolvedResult,
      llmRefinementPreview: null,
      currentSchedule: session.currentSchedule,
      tentativeSchedule: null,
      dayGroups: session.currentSchedule.dayGroups,
      groupedDays: session.currentSchedule.groupedDays,
      activityCostDebugById: session.currentSchedule.activityCostDebugById,
      unassignedActivityIds: session.currentSchedule.unassignedActivityIds,
    });
  } catch (error) {
    console.error("Error in resolveRefineDayGrouping:", error);
    return NextResponse.json(
      { success: false, message: "Failed to resolve LLM refinement", error: String(error) },
      { status: 500 }
    );
  }
}
