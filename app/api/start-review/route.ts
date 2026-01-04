import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";

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

    const totalDays = session.skeleton?.days?.length || 0;
    const expandedCount = Object.keys(session.expandedDays).length;

    if (expandedCount < totalDays) {
      return NextResponse.json(
        {
          success: false,
          message: `Not all days expanded. ${expandedCount}/${totalDays} completed.`,
        },
        { status: 400 }
      );
    }

    const daysSummary = Object.values(session.expandedDays)
      .sort((a, b) => a.dayNumber - b.dayNumber)
      .map((day) => `Day ${day.dayNumber}: ${day.theme}`)
      .join("\n");

    const reviewMessage = `Great! Here's your complete trip overview:\n\n${daysSummary}\n\nYou can now review each day, request changes, or finalize your itinerary. What would you like to do?`;

    sessionStore.update(sessionId, { workflowState: WORKFLOW_STATES.REVIEW });
    sessionStore.addToConversation(sessionId, "assistant", reviewMessage);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.REVIEW,
      message: reviewMessage,
      tripInfo: session.tripInfo,
      skeleton: session.skeleton,
      expandedDays: session.expandedDays,
    });
  } catch (error) {
    console.error("Error in startReview:", error);
    return NextResponse.json(
      { success: false, message: "Failed to start review", error: String(error) },
      { status: 500 }
    );
  }
}
