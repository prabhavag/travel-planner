import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

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

    return NextResponse.json({
      success: true,
      sessionId: session.sessionId,
      workflowState: session.workflowState,
      tripInfo: session.tripInfo,
      skeleton: session.skeleton,
      expandedDays: session.expandedDays,
      currentExpandDay: session.currentExpandDay,
      finalPlan: session.finalPlan,
      conversationHistory: session.conversationHistory,
    });
  } catch (error) {
    console.error("Error in getSession:", error);
    return NextResponse.json(
      { success: false, message: "Failed to get session", error: String(error) },
      { status: 500 }
    );
  }
}
