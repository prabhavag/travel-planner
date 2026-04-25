import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { chooseAuthoritativeScheduleBase } from "@/lib/utils/schedule-source";

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

    // Validate state
    if (session.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
      return NextResponse.json(
        {
          success: false,
          message: "Can only confirm day grouping from GROUP_DAYS state",
        },
        { status: 400 }
      );
    }

    const authoritativeScheduleBase = chooseAuthoritativeScheduleBase({
      currentSchedule: session.currentSchedule,
      legacyDayGroups: session.dayGroups,
      legacyUnassignedActivityIds: session.unassignedActivityIds || [],
    });
    const authoritativeGroupedDays =
      authoritativeScheduleBase.source === "currentSchedule"
        ? session.currentSchedule.groupedDays
        : session.groupedDays;
    const authoritativeActivityCostDebugById =
      authoritativeScheduleBase.source === "currentSchedule"
        ? session.currentSchedule.activityCostDebugById
        : session.activityCostDebugById;

    // Validate we have grouped days
    if (!authoritativeGroupedDays || authoritativeGroupedDays.length === 0) {
      return NextResponse.json(
        { success: false, message: "No grouped days to confirm" },
        { status: 400 }
      );
    }

    // Transition to DAY_ITINERARY state
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.DAY_ITINERARY,
      dayGroups: authoritativeScheduleBase.dayGroups,
      groupedDays: authoritativeGroupedDays,
      activityCostDebugById: authoritativeActivityCostDebugById,
      unassignedActivityIds: authoritativeScheduleBase.unassignedActivityIds,
    });

    const message = `Your ${authoritativeGroupedDays.length}-day itinerary is set! Would you like to add restaurants to your trip?`;

    sessionStore.addToConversation(sessionId, "assistant", message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.DAY_ITINERARY,
      message,
      currentSchedule: session.currentSchedule,
      tentativeSchedule: session.tentativeSchedule,
      dayGroups: authoritativeScheduleBase.dayGroups,
      groupedDays: authoritativeGroupedDays,
      activityCostDebugById: authoritativeActivityCostDebugById,
      unassignedActivityIds: authoritativeScheduleBase.unassignedActivityIds,
    });
  } catch (error) {
    console.error("Error in confirmDayGrouping:", error);
    return NextResponse.json(
      { success: false, message: "Failed to confirm day grouping", error: String(error) },
      { status: 500 }
    );
  }
}
