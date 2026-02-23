import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { buildGroupedDays, groupActivitiesByDay } from "@/lib/services/day-grouping";
import { runAccommodationSearch, runFlightSearch } from "@/lib/services/sub-agent-search";

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
      accommodationStatus: "running",
      flightStatus: "running",
      accommodationError: null,
      flightError: null,
      accommodationOptions: [],
      flightOptions: [],
      selectedAccommodationOptionId: null,
      selectedFlightOptionId: null,
      wantsAccommodation: null,
      wantsFlight: null,
      accommodationLastSearchedAt: null,
      flightLastSearchedAt: null,
    });

    const refreshed = sessionStore.get(sessionId);
    if (!refreshed) {
      throw new Error("Session not found after update");
    }

    const [accommodationResult, flightResult] = await Promise.all([
      runAccommodationSearch({ session: refreshed }),
      runFlightSearch({ session: refreshed }),
    ]);

    const now = new Date().toISOString();
    sessionStore.update(sessionId, {
      accommodationStatus: accommodationResult.success ? "complete" : "error",
      flightStatus: flightResult.success ? "complete" : "error",
      accommodationError: accommodationResult.success ? null : accommodationResult.message,
      flightError: flightResult.success ? null : flightResult.message,
      accommodationOptions: accommodationResult.options,
      flightOptions: flightResult.options,
      accommodationLastSearchedAt: now,
      flightLastSearchedAt: now,
    });

    const selectedCount = selectedActivityIds.length;
    const message = `Updated ${selectedCount} activit${selectedCount === 1 ? "y" : "ies"} and regrouped your itinerary by day.`;
    const updatedSession = sessionStore.get(sessionId);
    if (!updatedSession) {
      throw new Error("Session not found after sub-agent run");
    }

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message,
      selectedActivityIds,
      selectedCount,
      dayGroups,
      groupedDays,
      accommodationStatus: updatedSession.accommodationStatus,
      flightStatus: updatedSession.flightStatus,
      accommodationError: updatedSession.accommodationError,
      flightError: updatedSession.flightError,
      accommodationOptions: updatedSession.accommodationOptions,
      flightOptions: updatedSession.flightOptions,
      selectedAccommodationOptionId: updatedSession.selectedAccommodationOptionId,
      selectedFlightOptionId: updatedSession.selectedFlightOptionId,
      wantsAccommodation: updatedSession.wantsAccommodation,
      wantsFlight: updatedSession.wantsFlight,
      accommodationLastSearchedAt: updatedSession.accommodationLastSearchedAt,
      flightLastSearchedAt: updatedSession.flightLastSearchedAt,
    });
  } catch (error) {
    console.error("Error in selectActivities:", error);
    return NextResponse.json(
      { success: false, message: "Failed to select activities", error: String(error) },
      { status: 500 }
    );
  }
}
