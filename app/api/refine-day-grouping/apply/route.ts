import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { DayGroup } from "@/lib/models/travel-plan";
import {
  buildDayCapacityProfiles,
  buildPreparedActivityMap,
  buildScoredSchedule,
  computeActivityCommuteMatrix,
} from "@/lib/services/day-grouping";

function sanitizeDayGroups(dayGroups: DayGroup[]): DayGroup[] {
  return dayGroups
    .map((day, index) => ({
      dayNumber: Number.isFinite(day.dayNumber) ? day.dayNumber : index + 1,
      date: typeof day.date === "string" ? day.date : "",
      theme: typeof day.theme === "string" ? day.theme : `Day ${index + 1} Highlights`,
      activityIds: Array.isArray(day.activityIds) ? day.activityIds.filter((id): id is string => typeof id === "string") : [],
      nightStay: day.nightStay
        ? {
          label: day.nightStay.label,
          notes: day.nightStay.notes ?? null,
          coordinates: day.nightStay.coordinates ?? null,
        }
        : null,
      debugCost: null,
    }))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, candidateDayGroups, candidateUnassignedActivityIds, llmRefinementResult } = await request.json();

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

    if (session.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
      return NextResponse.json(
        {
          success: false,
          message: "LLM refinement apply is available only in GROUP_DAYS",
        },
        { status: 400 }
      );
    }

    if (!Array.isArray(candidateDayGroups) || candidateDayGroups.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No candidate day groups to apply.",
        },
        { status: 400 }
      );
    }

    const selectedActivities = session.suggestedActivities.filter((activity) =>
      session.selectedActivityIds.includes(activity.id)
    );
    const selectedActivityIds = new Set(selectedActivities.map((activity) => activity.id));
    const sanitizedDayGroups = sanitizeDayGroups(candidateDayGroups as DayGroup[]).map((day) => ({
      ...day,
      activityIds: day.activityIds.filter((id) => selectedActivityIds.has(id)),
    }));
    const sanitizedUnassigned = Array.isArray(candidateUnassignedActivityIds)
      ? (candidateUnassignedActivityIds as unknown[]).filter((id): id is string => typeof id === "string" && selectedActivityIds.has(id))
      : [];

    const dayCapacities = buildDayCapacityProfiles(session.tripInfo, sanitizedDayGroups.length);
    const commuteMinutesByPair = await computeActivityCommuteMatrix(selectedActivities);
    const preparedMap = buildPreparedActivityMap(selectedActivities);
    const currentSchedule = buildScoredSchedule({
      dayGroups: sanitizedDayGroups,
      activities: selectedActivities,
      unassignedActivityIds: sanitizedUnassigned,
      dayCapacities,
      preparedMap,
      commuteMinutesByPair,
      options: { forceSchedule: true, tripInfo: session.tripInfo },
    });

    sessionStore.update(sessionId, {
      currentSchedule,
      tentativeSchedule: null,
      dayGroups: currentSchedule.dayGroups,
      groupedDays: currentSchedule.groupedDays,
      activityCostDebugById: currentSchedule.activityCostDebugById,
      unassignedActivityIds: currentSchedule.unassignedActivityIds,
      llmRefinementResult: llmRefinementResult ?? null,
      llmRefinementPreview: null,
    });

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: session.workflowState,
      message: "Applied LLM itinerary changes.",
      currentSchedule,
      tentativeSchedule: null,
      dayGroups: currentSchedule.dayGroups,
      groupedDays: currentSchedule.groupedDays,
      activityCostDebugById: currentSchedule.activityCostDebugById,
      unassignedActivityIds: currentSchedule.unassignedActivityIds,
      llmRefinementResult: llmRefinementResult ?? null,
      llmRefinementPreview: null,
    });
  } catch (error) {
    console.error("Error in applyRefineDayGrouping:", error);
    return NextResponse.json(
      { success: false, message: "Failed to apply LLM refinement candidate", error: String(error) },
      { status: 500 }
    );
  }
}
