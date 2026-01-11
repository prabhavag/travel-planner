import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import type { SuggestedActivity, GroupedDay, DayGroup } from "@/lib/models/travel-plan";

/**
 * Build GroupedDay objects from DayGroups and activities
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

    // Validate state - allow from SELECT_ACTIVITIES, or GROUP_DAYS/DAY_ITINERARY for re-org
    const allowedStates = [
      WORKFLOW_STATES.SELECT_ACTIVITIES as string,
      WORKFLOW_STATES.GROUP_DAYS as string,
      WORKFLOW_STATES.DAY_ITINERARY as string
    ];
    if (!allowedStates.includes(session.workflowState as string)) {
      return NextResponse.json(
        {
          success: false,
          message: `Can only group days from states: ${allowedStates.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate selected activities
    if (!session.selectedActivityIds || session.selectedActivityIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "No activities selected" },
        { status: 400 }
      );
    }

    // Get selected activities with full data
    const selectedActivities = session.suggestedActivities.filter((a) =>
      session.selectedActivityIds.includes(a.id)
    );

    // Use LLM to group activities into days
    const llmClient = getLLMClient();
    const result = await llmClient.groupActivitiesIntoDays({
      tripInfo: session.tripInfo,
      activities: selectedActivities,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    // Build grouped days with full activity data
    const groupedDays = buildGroupedDays(result.dayGroups, selectedActivities);

    // Update session
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      dayGroups: result.dayGroups,
      groupedDays: groupedDays,
    });

    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message: result.message,
      dayGroups: result.dayGroups,
      groupedDays: groupedDays,
    });
  } catch (error) {
    console.error("Error in groupDays:", error);
    return NextResponse.json(
      { success: false, message: "Failed to group activities into days", error: String(error) },
      { status: 500 }
    );
  }
}
