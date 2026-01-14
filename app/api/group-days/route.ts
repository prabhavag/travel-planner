import { NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import type { SuggestedActivity, GroupedDay, DayGroup } from "@/lib/models/travel-plan";
import { calculateDateForDay } from "@/lib/utils/date";
import { withSession } from "@/lib/api/route-handler";

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

export const POST = withSession(
  async (request, { sessionId, session }) => {
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

    // Sanitize: Ensure each activity ID only appears once across all days
    const seenActivityIds = new Set<string>();
    const sanitizedDayGroups = result.dayGroups.map((group) => {
      const uniqueActivityIds = group.activityIds.filter((id) => {
        if (seenActivityIds.has(id)) {
          console.warn(`Removing duplicate activity ${id} from Day ${group.dayNumber}`);
          return false;
        }
        seenActivityIds.add(id);
        return true;
      });

      // Enforce correct date based on day number and trip start date
      const enforcedDate = session.tripInfo.startDate
        ? calculateDateForDay(session.tripInfo.startDate, group.dayNumber)
        : group.date;

      return { ...group, activityIds: uniqueActivityIds, date: enforcedDate };
    });

    // Build grouped days with full activity data
    const groupedDays = buildGroupedDays(sanitizedDayGroups, selectedActivities);

    // Update session
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      dayGroups: sanitizedDayGroups,
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
  },
  {
    allowedStates: [
      WORKFLOW_STATES.SELECT_ACTIVITIES,
      WORKFLOW_STATES.GROUP_DAYS,
      WORKFLOW_STATES.DAY_ITINERARY,
    ],
  }
);
