import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { SuggestedActivity, GroupedDay, DayGroup } from "@/lib/models/travel-plan";
import {
  generateDayTheme,
  buildDayCapacityProfiles,
  parseDurationHours,
  activityLoadFactor,
  isFullDayDuration,
  computeActivityCommuteMatrix,
  annotateDayGroupsWithCostDebug,
} from "@/lib/services/day-grouping";
import { assignNightStays } from "@/lib/services/night-stays";

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
    const { sessionId, activityId, fromDay, toDay } = await request.json();

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

    // Validate day numbers
    const maxDay = session.dayGroups.length;
    if (fromDay < 1 || fromDay > maxDay || toDay < 1 || toDay > maxDay) {
      return NextResponse.json(
        { success: false, message: `Invalid day numbers. Days must be between 1 and ${maxDay}` },
        { status: 400 }
      );
    }

    // Clone day groups to avoid mutation
    const updatedDayGroups = session.dayGroups.map((dg) => ({
      ...dg,
      activityIds: [...dg.activityIds],
    }));

    // Find source and target day groups
    const sourceDay = updatedDayGroups.find((d) => d.dayNumber === fromDay);
    const targetDay = updatedDayGroups.find((d) => d.dayNumber === toDay);

    if (!sourceDay || !targetDay) {
      return NextResponse.json(
        { success: false, message: "Could not find source or target day" },
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

    // Move activity from source to target
    sourceDay.activityIds.splice(activityIndex, 1);
    targetDay.activityIds.push(activityId);

    // Regenerate source and target day themes after the move.
    const selectedActivities = session.suggestedActivities.filter((a) =>
      session.selectedActivityIds.includes(a.id)
    );
    const sourceActivities = selectedActivities.filter((a) =>
      sourceDay.activityIds.includes(a.id)
    );
    const targetActivities = selectedActivities.filter((a) =>
      targetDay.activityIds.includes(a.id)
    );

    sourceDay.theme = generateDayTheme(sourceActivities);
    targetDay.theme = generateDayTheme(targetActivities);

    const dayCapacities = buildDayCapacityProfiles(session.tripInfo, updatedDayGroups.length);
    const commuteMinutesByPair = await computeActivityCommuteMatrix(selectedActivities);
    const preparedMap = new Map(
      selectedActivities.map((activity) => {
        const durationHours = parseDurationHours(activity.estimatedDuration);
        return [
          activity.id,
          {
            activity,
            durationHours,
            loadDurationHours: Math.min(durationHours, durationHours * activityLoadFactor(activity)),
            isFullDay: isFullDayDuration(activity.estimatedDuration, durationHours),
          },
        ] as const;
      })
    );
    const dayGroupsWithDebugCosts = annotateDayGroupsWithCostDebug({
      dayGroups: updatedDayGroups,
      dayCapacities,
      preparedMap,
      commuteMinutesByPair,
    });

    // Rebuild grouped days
    let groupedDays = buildGroupedDays(dayGroupsWithDebugCosts, selectedActivities);
    const selectedAccommodation = session.selectedAccommodationOptionId
      ? session.accommodationOptions.find((option) => option.id === session.selectedAccommodationOptionId) || null
      : null;
    const nightStayResult = await assignNightStays({
      tripInfo: session.tripInfo,
      dayGroups: dayGroupsWithDebugCosts,
      groupedDays,
      selectedAccommodation,
    });
    const finalizedDayGroups = nightStayResult.dayGroups;
    groupedDays = nightStayResult.groupedDays;

    // Update session
    sessionStore.update(sessionId, {
      dayGroups: finalizedDayGroups,
      groupedDays,
    });

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message: `Moved activity to Day ${toDay}`,
      dayGroups: finalizedDayGroups,
      groupedDays,
    });
  } catch (error) {
    console.error("Error in adjustDayGroups:", error);
    return NextResponse.json(
      { success: false, message: "Failed to adjust day groups", error: String(error) },
      { status: 500 }
    );
  }
}
