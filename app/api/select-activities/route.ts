import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { buildGroupedDays, groupActivitiesByDay } from "@/lib/services/day-grouping";

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

    const selectedActivities = session.suggestedActivities.filter((activity) =>
      selectedActivityIds.includes(activity.id)
    );
    const dayGroups = groupActivitiesByDay({
      tripInfo: session.tripInfo,
      activities: selectedActivities,
    });
    const groupedDays = buildGroupedDays({
      dayGroups,
      activities: selectedActivities,
    });

    // Update session with selected activities and regrouped days
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      selectedActivityIds: selectedActivityIds,
      dayGroups,
      groupedDays,
    });

    const selectedCount = selectedActivityIds.length;
    const message = `Updated ${selectedCount} activit${selectedCount === 1 ? "y" : "ies"} and regrouped your itinerary by day.`;

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message,
      selectedActivityIds,
      selectedCount,
      dayGroups,
      groupedDays,
    });
  } catch (error) {
    console.error("Error in selectActivities:", error);
    return NextResponse.json(
      { success: false, message: "Failed to select activities", error: String(error) },
      { status: 500 }
    );
  }
}
