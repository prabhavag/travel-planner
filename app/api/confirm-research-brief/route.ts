import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { ResearchOptionPreference, ResearchOption, SuggestedActivity } from "@/lib/models/travel-plan";
import { mergeSuggestedActivities } from "@/lib/services/card-merging";
import { buildGroupedDays, groupActivitiesByDay } from "@/lib/services/day-grouping";

function mapResearchOptionToSuggestedActivity(option: ResearchOption): SuggestedActivity {
  return {
    id: option.id,
    name: option.title,
    type: option.category,
    interestTags: [option.category],
    description: option.reviewSummary || option.whyItMatches || option.bestForDates,
    estimatedDuration: "2-4 hours",
    estimatedCost: null,
    currency: "USD",
    bestTimeOfDay: "any",
    neighborhood: null,
    photo_url: option.photoUrls?.[0] || null,
    photo_urls: option.photoUrls || [],
    researchOption: option,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, researchOptionSelections } = await request.json();

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

    if (session.workflowState !== WORKFLOW_STATES.INITIAL_RESEARCH) {
      return NextResponse.json(
        {
          success: false,
          message: "Can only confirm research brief from INITIAL_RESEARCH state",
        },
        { status: 400 }
      );
    }

    const allowedPreferences: ResearchOptionPreference[] = ["keep", "maybe", "reject"];
    const parsedSelections: Record<string, ResearchOptionPreference> = {};
    if (researchOptionSelections && typeof researchOptionSelections === "object") {
      for (const [key, value] of Object.entries(researchOptionSelections as Record<string, unknown>)) {
        if (typeof key !== "string" || !key.trim()) continue;
        if (typeof value === "string" && allowedPreferences.includes(value as ResearchOptionPreference)) {
          parsedSelections[key] = value as ResearchOptionPreference;
        }
      }
    }

    const selectedResearchOptions = (session.tripResearchBrief?.popularOptions || []).filter(
      (option) => parsedSelections[option.id] === "keep"
    );
    const mappedActivities = selectedResearchOptions.map(mapResearchOptionToSuggestedActivity);
    const suggestedActivities = mergeSuggestedActivities({
      existingActivities: session.suggestedActivities || [],
      incomingActivities: mappedActivities,
    });
    const selectedActivityIds = selectedResearchOptions
      .map((option) => suggestedActivities.find((activity) => activity.id === option.id)?.id || option.id)
      .filter(Boolean);

    const selectedActivities = suggestedActivities.filter((activity) => selectedActivityIds.includes(activity.id));
    const dayGroups = groupActivitiesByDay({
      tripInfo: session.tripInfo,
      activities: selectedActivities,
    });
    const groupedDays = buildGroupedDays({
      dayGroups,
      activities: selectedActivities,
    });

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      researchOptionSelections: parsedSelections,
      suggestedActivities,
      selectedActivityIds,
      dayGroups,
      groupedDays,
    });
    const message = "Great. I organized your selected cards into day-by-day groups.";
    sessionStore.addToConversation(sessionId, "assistant", message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      message,
      tripResearchBrief: session.tripResearchBrief,
      researchOptionSelections: parsedSelections,
      suggestedActivities,
      selectedActivityIds,
      dayGroups,
      groupedDays,
    });
  } catch (error) {
    console.error("Error in confirmResearchBrief:", error);
    return NextResponse.json(
      { success: false, message: "Failed to confirm research brief", error: String(error) },
      { status: 500 }
    );
  }
}
