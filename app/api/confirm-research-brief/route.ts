import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { ResearchOptionPreference, ResearchOption, SuggestedActivity } from "@/lib/models/travel-plan";
import { mergeSuggestedActivities } from "@/lib/services/card-merging";
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

function parseFixedStartLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function inferFixedStartFromText(option: ResearchOption): string | null {
  const text = `${option.title} ${option.whyItMatches} ${option.bestForDates} ${option.reviewSummary} ${option.timeReason || ""}`.toLowerCase();
  if (text.includes("sunrise")) return "sunrise";
  if (text.includes("sunset")) return "sunset";

  const timeMatch = text.match(/\b(?:[01]?\d(?::[0-5]\d)?\s?(?:am|pm)|[01]\d:[0-5]\d|2[0-3]:[0-5]\d)\b/i);
  return timeMatch ? timeMatch[0].toUpperCase() : null;
}

function fallbackFixedStartFromBestTime(bestTimeOfDay: ResearchOption["bestTimeOfDay"]): string {
  if (bestTimeOfDay === "morning") return "09:00";
  if (bestTimeOfDay === "afternoon") return "13:00";
  if (bestTimeOfDay === "evening") return "17:00";
  return "09:00";
}

function inferRecommendedStartWindowFromText(option: ResearchOption): { start: string; end: string; reason: string | null } | null {
  const text = `${option.title} ${option.category} ${option.whyItMatches} ${option.bestForDates} ${option.reviewSummary} ${option.timeReason || ""}`.toLowerCase();
  if (/(road to hana|hana highway)/i.test(text)) {
    return {
      start: "06:00",
      end: "08:00",
      reason: "Start early to avoid traffic and crowds.",
    };
  }
  return null;
}

function inferDaylightPreferenceFromText(option: ResearchOption): "daylight_only" | "night_only" | "flexible" {
  if (option.daylightPreference) return option.daylightPreference;
  const text = `${option.title} ${option.category} ${option.whyItMatches} ${option.bestForDates} ${option.reviewSummary} ${option.timeReason || ""}`.toLowerCase();
  if (/(night snorkel|night snorkeling|night dive|moonlight|stargaz|astronomy|night tour|after dark|biolumines|sunset cruise)/i.test(text)) {
    return "night_only";
  }
  if (/(snorkel|snorkeling|scuba|dive|surf|kayak|paddle|canoe|boat tour|hike|trail|outdoor|national park|waterfall|beach)/i.test(text)) {
    return "daylight_only";
  }
  if (option.bestTimeOfDay === "morning" || option.bestTimeOfDay === "afternoon") return "daylight_only";
  return "flexible";
}

function inferDurationFlexibilityFromText(option: ResearchOption): boolean {
  if (typeof option.isDurationFlexible === "boolean") return option.isDurationFlexible;
  const text = `${option.title} ${option.category} ${option.whyItMatches} ${option.bestForDates} ${option.reviewSummary} ${option.timeReason || ""}`.toLowerCase();
  if (/(guided tour|tour\b|ticketed|timed entry|time slot|set departure|show\b|performance|class\b|workshop|ferry crossing|cruise departure|boat departure)/i.test(text)) {
    return false;
  }
  return true;
}

function mapResearchOptionToSuggestedActivity(option: ResearchOption): SuggestedActivity {
  const fallbackDuration =
    option.category === "food"
      ? "1-2 hours"
      : option.category === "hiking" || option.category === "snorkeling" || option.category === "adventure"
        ? "2-4 hours"
        : "1-3 hours";

  const explicitFixedStartTime = parseFixedStartLabel(option.fixedStartTime);
  const inferredFixedStartTime = inferFixedStartFromText(option);
  const isFixedStartTime = Boolean(option.isFixedStartTime || explicitFixedStartTime || inferredFixedStartTime);
  const fixedStartTime = isFixedStartTime
    ? explicitFixedStartTime || inferredFixedStartTime || fallbackFixedStartFromBestTime(option.bestTimeOfDay)
    : null;
  const recommendedStartWindow = option.recommendedStartWindow || inferRecommendedStartWindowFromText(option);

  return {
    id: option.id,
    name: option.title,
    type: option.category,
    interestTags: [option.category],
    description: option.reviewSummary || option.whyItMatches || option.bestForDates,
    estimatedDuration: option.estimatedDuration || fallbackDuration,
    isDurationFlexible: inferDurationFlexibilityFromText(option),
    estimatedCost: null,
    currency: "USD",
    difficultyLevel: option.difficultyLevel || "moderate",
    bestTimeOfDay: option.bestTimeOfDay || "any",
    daylightPreference: inferDaylightPreferenceFromText(option),
    isFixedStartTime,
    fixedStartTime,
    recommendedStartWindow,
    timeReason: option.timeReason || null,
    timeSourceLinks: option.timeSourceLinks || [],
    neighborhood: null,
    locationMode: option.locationMode || "point",
    routeWaypoints: option.routeWaypoints || [],
    routePoints: option.routePoints || [],
    startCoordinates: option.startCoordinates || null,
    endCoordinates: option.endCoordinates || null,
    coordinates:
      option.coordinates ||
      (option.locationMode === "route" ? option.routePoints?.[0] || option.startCoordinates || null : null),
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
    let updatedDayGroups = await groupActivitiesByDay({
      tripInfo: session.tripInfo,
      activities: selectedActivities,
    });
    let groupedDays = buildGroupedDays({
      dayGroups: updatedDayGroups,
      activities: selectedActivities,
    });

    const nightStayResult = await assignNightStays({
      tripInfo: session.tripInfo,
      dayGroups: updatedDayGroups,
      groupedDays,
      selectedAccommodation: null,
    });
    updatedDayGroups = nightStayResult.dayGroups;
    groupedDays = nightStayResult.groupedDays;
    const currentSchedule = buildScoredSchedule({
      dayGroups: updatedDayGroups,
      activities: selectedActivities,
      unassignedActivityIds: [],
      dayCapacities: buildDayCapacityProfiles(session.tripInfo, updatedDayGroups.length),
      preparedMap: buildPreparedActivityMap(selectedActivities),
      commuteMinutesByPair: await computeActivityCommuteMatrix(selectedActivities),
      options: { forceSchedule: false, tripInfo: session.tripInfo },
    });

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.GROUP_DAYS,
      researchOptionSelections: parsedSelections,
      suggestedActivities,
      selectedActivityIds,
      currentSchedule,
      tentativeSchedule: null,
      dayGroups: currentSchedule.dayGroups,
      groupedDays: currentSchedule.groupedDays,
      activityCostDebugById: currentSchedule.activityCostDebugById,
      unassignedActivityIds: currentSchedule.unassignedActivityIds,
      llmRefinementResult: null,
      llmRefinementPreview: null,
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

    if (accommodationResult.success && accommodationResult.options.length > 0) {
      const availabilityStayResult = await assignNightStays({
        tripInfo: session.tripInfo,
        dayGroups: updatedDayGroups,
        groupedDays,
        selectedAccommodation: null,
        accommodationOptions: accommodationResult.options,
      });
      groupedDays = availabilityStayResult.groupedDays;
      sessionStore.update(sessionId, {
        dayGroups: availabilityStayResult.dayGroups,
        groupedDays,
      });
    }

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
    console.error("Error in confirmResearchBrief:", error);
    return NextResponse.json(
      { success: false, message: "Failed to confirm research brief", error: String(error) },
      { status: 500 }
    );
  }
}
