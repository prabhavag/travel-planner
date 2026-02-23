import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { ResearchOptionPreference, ResearchOption, SuggestedActivity } from "@/lib/models/travel-plan";
import { mergeSuggestedActivities } from "@/lib/services/card-merging";
import { buildGroupedDays, groupActivitiesByDay } from "@/lib/services/day-grouping";
import { runAccommodationSearch, runFlightSearch } from "@/lib/services/sub-agent-search";

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
    bestTimeOfDay: option.bestTimeOfDay || "any",
    timeReason: option.timeReason || null,
    timeSourceLinks: option.timeSourceLinks || [],
    neighborhood: null,
    locationMode: option.locationMode || "point",
    startCoordinates: option.startCoordinates || null,
    endCoordinates: option.endCoordinates || null,
    coordinates:
      option.coordinates ||
      (option.locationMode === "route" ? option.startCoordinates || null : null),
    photo_url: option.photoUrls?.[0] || null,
    photo_urls: option.photoUrls || [],
    researchOption: option,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, selectedResearchOptionIds, researchOptionSelections } = await request.json();

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

    const validOptionIds = new Set((session.tripResearchBrief?.popularOptions || []).map((option) => option.id));
    const normalizedSelectedIds = new Set<string>();

    if (Array.isArray(selectedResearchOptionIds)) {
      for (const rawId of selectedResearchOptionIds) {
        if (typeof rawId === "string" && rawId.trim() && validOptionIds.has(rawId)) {
          normalizedSelectedIds.add(rawId);
        }
      }
    }

    // Legacy compatibility: support old tri-state payload during rollout.
    if (researchOptionSelections && typeof researchOptionSelections === "object") {
      for (const [key, value] of Object.entries(researchOptionSelections as Record<string, unknown>)) {
        if (typeof key !== "string" || !key.trim() || !validOptionIds.has(key)) continue;
        if (value === "selected" || value === "keep") {
          normalizedSelectedIds.add(key);
        }
      }
    }

    const parsedSelections: Record<string, ResearchOptionPreference> = {};
    for (const id of normalizedSelectedIds) {
      parsedSelections[id] = "selected";
    }

    const selectedResearchOptions = (session.tripResearchBrief?.popularOptions || []).filter((option) =>
      normalizedSelectedIds.has(option.id)
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

    const updatedSession = sessionStore.get(sessionId);
    if (!updatedSession) {
      throw new Error("Session not found after sub-agent run");
    }
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
    console.error("Error in confirmResearchBrief:", error);
    return NextResponse.json(
      { success: false, message: "Failed to confirm research brief", error: String(error) },
      { status: 500 }
    );
  }
}
