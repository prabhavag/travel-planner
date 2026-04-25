import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { SuggestedActivity, GroupedDay, DayGroup } from "@/lib/models/travel-plan";
import {
  generateDayTheme,
  buildDayCapacityProfiles,
  computeActivityCommuteMatrix,
  buildPreparedActivityMap,
  buildScoredSchedule,
} from "@/lib/services/day-grouping";
import { assignNightStays } from "@/lib/services/night-stays";
import { chooseAuthoritativeScheduleBase } from "@/lib/utils/schedule-source";

/**
 * Rebuild GroupedDay objects from DayGroups and activities
 */
function buildGroupedDays(
  dayGroups: DayGroup[],
  activities: SuggestedActivity[]
): GroupedDay[] {
  const activityMap = new Map(activities.map((a) => [a.id, a]));

  return dayGroups.map((group) => ({
    dayNumber: group.dayNumber,
    date: group.date,
    theme: group.theme,
    activities: group.activityIds
      .map((id) => activityMap.get(id))
      .filter((a): a is SuggestedActivity => a !== undefined),
    restaurants: [],
    nightStay: group.nightStay ?? null,
    debugCost: group.debugCost ?? null,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, activityId, fromDay, toDay, targetIndex } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId" },
        { status: 400 }
      );
    }

    if (!activityId || typeof fromDay !== "number" || typeof toDay !== "number") {
      return NextResponse.json(
        { success: false, message: "Missing activityId, fromDay, or toDay" },
        { status: 400 }
      );
    }
    if (targetIndex != null && (!Number.isInteger(targetIndex) || targetIndex < 0)) {
      return NextResponse.json(
        { success: false, message: "targetIndex must be a non-negative integer" },
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
    if (session.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
      return NextResponse.json(
        {
          success: false,
          message: "Can only adjust day groups from GROUP_DAYS state",
        },
        { status: 400 }
      );
    }

    const authoritativeScheduleBase = chooseAuthoritativeScheduleBase({
      currentSchedule: session.currentSchedule,
      legacyDayGroups: session.dayGroups,
      legacyUnassignedActivityIds: session.unassignedActivityIds || [],
    });

    // Validate day numbers
    const maxDay = authoritativeScheduleBase.dayGroups.length;
    if (fromDay < 0 || fromDay > maxDay || toDay < 0 || toDay > maxDay) {
      return NextResponse.json(
        { success: false, message: `Invalid day numbers. fromDay and toDay must be between 0 and ${maxDay}` },
        { status: 400 }
      );
    }
    if (fromDay === 0 && toDay === 0) {
      return NextResponse.json(
        { success: false, message: "Activity is already unscheduled." },
        { status: 400 }
      );
    }

    // Clone day groups to avoid mutation
    const updatedDayGroups = authoritativeScheduleBase.dayGroups.map((dg) => ({
      ...dg,
      activityIds: [...dg.activityIds],
    }));

    // Find source and target day groups
    const sourceDay = fromDay === 0 ? null : updatedDayGroups.find((d) => d.dayNumber === fromDay);
    const targetDay = toDay === 0 ? null : updatedDayGroups.find((d) => d.dayNumber === toDay);
    let updatedUnassignedActivityIds = [...authoritativeScheduleBase.unassignedActivityIds];

    if (toDay !== 0 && !targetDay) {
      return NextResponse.json(
        { success: false, message: "Could not find target day" },
        { status: 400 }
      );
    }

    if (fromDay === 0) {
      if (!updatedUnassignedActivityIds.includes(activityId)) {
        return NextResponse.json(
          { success: false, message: `Activity ${activityId} not found in unassigned bucket` },
          { status: 400 }
        );
      }
      updatedUnassignedActivityIds = updatedUnassignedActivityIds.filter((id) => id !== activityId);
    } else {
      if (!sourceDay) {
        return NextResponse.json(
          { success: false, message: "Could not find source day" },
          { status: 400 }
        );
      }

      // Validate activity exists in source day
      const activityIndex = sourceDay.activityIds.indexOf(activityId);
      if (activityIndex === -1) {
        return NextResponse.json(
          { success: false, message: `Activity ${activityId} not found in day ${fromDay}` },
          { status: 400 }
        );
      }

      // Move activity from source to target while preserving explicit ordering when provided.
      sourceDay.activityIds.splice(activityIndex, 1);
    }

    if (toDay === 0) {
      if (!updatedUnassignedActivityIds.includes(activityId)) {
        updatedUnassignedActivityIds.push(activityId);
      }
    } else if (targetDay) {
      updatedUnassignedActivityIds = updatedUnassignedActivityIds.filter((id) => id !== activityId);
      if (targetDay.activityIds.includes(activityId)) {
        targetDay.activityIds = targetDay.activityIds.filter((id) => id !== activityId);
      }
      const insertionIndex =
        typeof targetIndex === "number"
          ? Math.min(Math.max(0, targetIndex), targetDay.activityIds.length)
          : targetDay.activityIds.length;
      targetDay.activityIds.splice(insertionIndex, 0, activityId);
    }

    // Regenerate source and target day themes after the move.
    const selectedActivities = session.suggestedActivities.filter((a) =>
      session.selectedActivityIds.includes(a.id)
    );
    const sourceActivities = sourceDay
      ? selectedActivities.filter((a) => sourceDay.activityIds.includes(a.id))
      : [];
    const targetActivities = targetDay
      ? selectedActivities.filter((a) => targetDay.activityIds.includes(a.id))
      : [];

    if (sourceDay) {
      sourceDay.theme = generateDayTheme(sourceActivities);
    }
    if (targetDay) {
      targetDay.theme = generateDayTheme(targetActivities);
    }

    const dayCapacities = buildDayCapacityProfiles(session.tripInfo, updatedDayGroups.length);
    const commuteMinutesByPair = await computeActivityCommuteMatrix(selectedActivities);
    const preparedMap = buildPreparedActivityMap(selectedActivities);

    // Rebuild grouped days
    let groupedDays = buildGroupedDays(updatedDayGroups, selectedActivities);
    const selectedAccommodation = session.selectedAccommodationOptionId
      ? session.accommodationOptions.find((option) => option.id === session.selectedAccommodationOptionId) || null
      : null;
    const nightStayResult = await assignNightStays({
      tripInfo: session.tripInfo,
      dayGroups: updatedDayGroups,
      groupedDays,
      selectedAccommodation,
    });
    const currentSchedule = buildScoredSchedule({
      dayGroups: nightStayResult.dayGroups,
      activities: selectedActivities,
      unassignedActivityIds: updatedUnassignedActivityIds,
      dayCapacities,
      preparedMap,
      commuteMinutesByPair,
      options: { forceSchedule: true, tripInfo: session.tripInfo },
    });

    // Update session
    sessionStore.update(sessionId, {
      currentSchedule,
      tentativeSchedule: null,
      dayGroups: currentSchedule.dayGroups,
      groupedDays: currentSchedule.groupedDays,
      activityCostDebugById: currentSchedule.activityCostDebugById,
      unassignedActivityIds: currentSchedule.unassignedActivityIds,
      llmRefinementResult: null,
      llmRefinementPreview: null,
    });

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message: toDay === 0 ? "Moved activity to unscheduled." : fromDay === toDay ? "Reordered activity within the day" : `Moved activity to Day ${toDay}`,
      currentSchedule,
      tentativeSchedule: null,
      dayGroups: currentSchedule.dayGroups,
      groupedDays: currentSchedule.groupedDays,
      activityCostDebugById: currentSchedule.activityCostDebugById,
      unassignedActivityIds: currentSchedule.unassignedActivityIds,
      llmRefinementResult: null,
      llmRefinementPreview: null,
    });
  } catch (error) {
    console.error("Error in adjustDayGroups:", error);
    return NextResponse.json(
      { success: false, message: "Failed to adjust day groups", error: String(error) },
      { status: 500 }
    );
  }
}
