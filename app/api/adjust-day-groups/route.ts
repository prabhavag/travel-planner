import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { SuggestedActivity, GroupedDay, DayGroup } from "@/lib/models/travel-plan";
import { generateDayTheme } from "@/lib/services/day-grouping";

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

    // Rebuild grouped days
    const groupedDays = buildGroupedDays(updatedDayGroups, selectedActivities);

    // Update session
    sessionStore.update(sessionId, {
      dayGroups: updatedDayGroups,
      groupedDays: groupedDays,
    });

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message: `Moved activity to Day ${toDay}`,
      dayGroups: updatedDayGroups,
      groupedDays: groupedDays,
    });
  } catch (error) {
    console.error("Error in adjustDayGroups:", error);
    return NextResponse.json(
      { success: false, message: "Failed to adjust day groups", error: String(error) },
      { status: 500 }
    );
  }
}
