import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import {
  buildDayCapacityProfiles,
  buildGroupedDays,
  buildPreparedActivityMap,
  buildScoredSchedule,
  computeActivityCommuteMatrix,
  groupActivitiesByDay,
} from "@/lib/services/day-grouping";
import { assignNightStays } from "@/lib/services/night-stays";
import { runAccommodationSearch, runFlightSearch } from "@/lib/services/sub-agent-search";

function sameSelectedIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

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

    const allowedStates = [
      WORKFLOW_STATES.SELECT_ACTIVITIES as string,
      WORKFLOW_STATES.GROUP_DAYS as string,
      WORKFLOW_STATES.DAY_ITINERARY as string,
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

    const dayGroups = await groupActivitiesByDay({
      tripInfo: session.tripInfo,
      activities: selectedActivities,
    });
    let groupedDays = buildGroupedDays({
      dayGroups,
      activities: selectedActivities,
    });

    const nightStayResult = await assignNightStays({
      tripInfo: session.tripInfo,
      dayGroups,
      groupedDays,
      selectedAccommodation: null,
    });
    let updatedDayGroups = nightStayResult.dayGroups;
    groupedDays = nightStayResult.groupedDays;
    const dayCapacities = buildDayCapacityProfiles(session.tripInfo, updatedDayGroups.length);
    const commuteMinutesByPair = await computeActivityCommuteMatrix(selectedActivities);
    const preparedMap = buildPreparedActivityMap(selectedActivities);
    let currentSchedule = buildScoredSchedule({
      dayGroups: updatedDayGroups,
      activities: selectedActivities,
      unassignedActivityIds: [],
      dayCapacities,
      preparedMap,
      commuteMinutesByPair,
      options: { forceSchedule: false, tripInfo: session.tripInfo },
    });
    updatedDayGroups = currentSchedule.dayGroups;
    groupedDays = currentSchedule.groupedDays;

    const selectedIdsChanged = !sameSelectedIds(session.selectedActivityIds || [], selectedActivityIds);
    const shouldRunTravelSearch =
      selectedIdsChanged || (session.accommodationStatus === "idle" && session.flightStatus === "idle");

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      selectedActivityIds,
      currentSchedule,
      tentativeSchedule: null,
      dayGroups: currentSchedule.dayGroups,
      groupedDays: currentSchedule.groupedDays,
      activityCostDebugById: currentSchedule.activityCostDebugById,
      unassignedActivityIds: currentSchedule.unassignedActivityIds,
      llmRefinementResult: null,
      llmRefinementPreview: null,
      ...(shouldRunTravelSearch
        ? {
          accommodationStatus: "running" as const,
          flightStatus: "running" as const,
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
        }
        : {}),
    });

    const refreshed = sessionStore.get(sessionId);
    if (!refreshed) {
      throw new Error("Session not found after update");
    }

    let accommodationResult = {
      success: refreshed.accommodationStatus !== "error",
      message: refreshed.accommodationError || "",
      options: refreshed.accommodationOptions,
    };
    let flightResult = {
      success: refreshed.flightStatus !== "error",
      message: refreshed.flightError || "",
      options: refreshed.flightOptions,
    };

    if (shouldRunTravelSearch) {
      [accommodationResult, flightResult] = await Promise.all([
        runAccommodationSearch({ session: refreshed }),
        runFlightSearch({ session: refreshed }),
      ]);
    }

    const now = new Date().toISOString();
    if (shouldRunTravelSearch) {
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
    }

    if (shouldRunTravelSearch && accommodationResult.success && accommodationResult.options.length > 0) {
      const availabilityStayResult = await assignNightStays({
        tripInfo: session.tripInfo,
        dayGroups: updatedDayGroups,
        groupedDays,
        selectedAccommodation: null,
        accommodationOptions: accommodationResult.options,
      });
      updatedDayGroups = availabilityStayResult.dayGroups;
      groupedDays = availabilityStayResult.groupedDays;
      currentSchedule = buildScoredSchedule({
        dayGroups: updatedDayGroups,
        activities: selectedActivities,
        unassignedActivityIds: [],
        dayCapacities,
        preparedMap,
        commuteMinutesByPair,
        options: { forceSchedule: false, tripInfo: session.tripInfo },
      });
      sessionStore.update(sessionId, {
        currentSchedule,
        dayGroups: currentSchedule.dayGroups,
        groupedDays: currentSchedule.groupedDays,
        activityCostDebugById: currentSchedule.activityCostDebugById,
        unassignedActivityIds: currentSchedule.unassignedActivityIds,
      });
    }

    const selectedCount = selectedActivityIds.length;
    const message = `Updated ${selectedCount} activit${selectedCount === 1 ? "y" : "ies"} and regrouped your itinerary by day.`;

    const updatedSession = sessionStore.get(sessionId);
    if (!updatedSession) {
      throw new Error("Session not found after regrouping");
    }

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message,
      selectedActivityIds,
      selectedCount,
      currentSchedule: updatedSession.currentSchedule,
      tentativeSchedule: updatedSession.tentativeSchedule,
      dayGroups: updatedSession.dayGroups,
      groupedDays: updatedSession.groupedDays,
      activityCostDebugById: updatedSession.activityCostDebugById,
      unassignedActivityIds: updatedSession.unassignedActivityIds,
      llmRefinementResult: null,
      llmRefinementPreview: null,
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
