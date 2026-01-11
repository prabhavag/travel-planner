import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, selectedActivityIds } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId" },
        { status: 400 }
      );
    }

    if (!selectedActivityIds || !Array.isArray(selectedActivityIds)) {
      return NextResponse.json(
        { success: false, message: "Missing or invalid selectedActivityIds" },
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

    // Validate state
    const allowedStates = [
      WORKFLOW_STATES.SUGGEST_ACTIVITIES as string,
      WORKFLOW_STATES.SELECT_ACTIVITIES as string,
      WORKFLOW_STATES.GROUP_DAYS as string,
      WORKFLOW_STATES.DAY_ITINERARY as string
    ];
    if (!allowedStates.includes(session.workflowState as string)) {
      return NextResponse.json(
        {
          success: false,
          message: `Can only select activities from states: ${allowedStates.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate that all selected IDs exist in suggested activities
    const validIds = new Set(session.suggestedActivities.map((a) => a.id));
    const invalidIds = selectedActivityIds.filter((id: string) => !validIds.has(id));

    if (invalidIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid activity IDs: ${invalidIds.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Update session with selected activities
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.SELECT_ACTIVITIES,
      selectedActivityIds: selectedActivityIds,
    });

    const selectedCount = selectedActivityIds.length;
    const message = `You've selected ${selectedCount} activit${selectedCount === 1 ? "y" : "ies"}. Ready to organize them into days!`;

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.SELECT_ACTIVITIES,
      message,
      selectedActivityIds,
      selectedCount,
    });
  } catch (error) {
    console.error("Error in selectActivities:", error);
    return NextResponse.json(
      { success: false, message: "Failed to select activities", error: String(error) },
      { status: 500 }
    );
  }
}
