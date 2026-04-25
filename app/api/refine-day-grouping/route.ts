import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { runLlmRefinementIteration } from "@/lib/services/day-grouping-refinement";
import {
  buildDayCapacityProfiles,
  buildPreparedActivityMap,
  buildScoredSchedule,
  computeActivityCommuteMatrix,
  type ScheduleState,
} from "@/lib/services/day-grouping";
import type { DayGroup } from "@/lib/models/travel-plan";
import { chooseAuthoritativeScheduleBase } from "@/lib/utils/schedule-source";
import { schedulesHaveSamePlacements } from "@/lib/utils/schedule-placements";

function extractScheduleTotal(schedule: ScheduleState | null): number | null {
  if (!schedule) return null;
  const value = schedule.groupedDays.find((day) => typeof day.debugCost?.overallTripCost === "number")?.debugCost?.overallTripCost;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uniqueOrderedIds(ids: string[], validIds: Set<string>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  ids.forEach((id) => {
    if (!validIds.has(id) || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  });
  return ordered;
}

function cloneFallbackDayGroups(dayGroups: DayGroup[], validIds: Set<string>): DayGroup[] {
  return dayGroups.map((day) => ({
    ...day,
    activityIds: uniqueOrderedIds(Array.isArray(day.activityIds) ? day.activityIds : [], validIds),
    nightStay: day.nightStay
      ? {
        label: day.nightStay.label,
        notes: day.nightStay.notes ?? null,
        coordinates: day.nightStay.coordinates ?? null,
      }
      : null,
    debugCost: null,
  }));
}

function resolveBaseDayGroups({
  requestedDayGroups,
  fallbackDayGroups,
  validIds,
}: {
  requestedDayGroups: unknown;
  fallbackDayGroups: DayGroup[];
  validIds: Set<string>;
}): DayGroup[] {
  const fallback = cloneFallbackDayGroups(fallbackDayGroups, validIds);
  if (!Array.isArray(requestedDayGroups) || requestedDayGroups.length === 0) {
    return fallback;
  }

  const requestedByDayNumber = new Map<number, DayGroup>();
  requestedDayGroups.forEach((rawDay, index) => {
    if (!rawDay || typeof rawDay !== "object") return;
    const day = rawDay as Partial<DayGroup>;
    const dayNumber = Number.isFinite(day.dayNumber) ? Number(day.dayNumber) : index + 1;
    const nightStay =
      day.nightStay && typeof day.nightStay.label === "string"
        ? {
          label: day.nightStay.label,
          notes: day.nightStay.notes ?? null,
          coordinates: day.nightStay.coordinates ?? null,
        }
        : null;
    requestedByDayNumber.set(dayNumber, {
      dayNumber,
      date: typeof day.date === "string" ? day.date : "",
      theme: typeof day.theme === "string" ? day.theme : `Day ${dayNumber} Highlights`,
      activityIds: uniqueOrderedIds(Array.isArray(day.activityIds) ? day.activityIds.filter((id): id is string => typeof id === "string") : [], validIds),
      nightStay,
      debugCost: null,
    });
  });

  return fallback.map((fallbackDay, index) => {
    const requested = requestedByDayNumber.get(fallbackDay.dayNumber);
    if (!requested) {
      return {
        ...fallbackDay,
        dayNumber: Number.isFinite(fallbackDay.dayNumber) ? fallbackDay.dayNumber : index + 1,
        debugCost: null,
      };
    }
    return {
      ...fallbackDay,
      date: requested.date || fallbackDay.date,
      theme: requested.theme || fallbackDay.theme,
      activityIds: requested.activityIds,
      nightStay: requested.nightStay ?? fallbackDay.nightStay ?? null,
      debugCost: null,
    };
  });
}

function resolveBaseUnassignedActivityIds({
  requestedUnassignedActivityIds,
  fallbackUnassignedActivityIds,
  validIds,
}: {
  requestedUnassignedActivityIds: unknown;
  fallbackUnassignedActivityIds: string[];
  validIds: Set<string>;
}): string[] {
  if (!Array.isArray(requestedUnassignedActivityIds)) {
    return uniqueOrderedIds(fallbackUnassignedActivityIds, validIds);
  }
  return uniqueOrderedIds(
    requestedUnassignedActivityIds.filter((id): id is string => typeof id === "string"),
    validIds
  );
}

function summarizeSuggestedOperation(
  operation: Record<string, unknown>,
  activityNameById: Map<string, string>
): string {
  const formatActivityList = (activityIds: string[]): string => {
    return activityIds
      .map((id) => {
        const name = activityNameById.get(id);
        return name ? `${name} (${id})` : id;
      })
      .join(", ");
  };
  const type = typeof operation.type === "string" ? operation.type : "unknown";
  if (type === "move") {
    const dayNumber = typeof operation.dayNumber === "number" ? operation.dayNumber : "?";
    const activityIds = Array.isArray(operation.activityIds)
      ? operation.activityIds.filter((id): id is string => typeof id === "string")
      : [];
    return `move to day ${dayNumber} [${formatActivityList(activityIds)}]`;
  }
  if (type === "unschedule") {
    const activityIds = Array.isArray(operation.activityIds)
      ? operation.activityIds.filter((id): id is string => typeof id === "string")
      : [];
    return `unschedule [${formatActivityList(activityIds)}]`;
  }
  if (type === "set_night_stay") {
    const dayNumber = typeof operation.dayNumber === "number" ? operation.dayNumber : "?";
    const label = typeof operation.label === "string" ? operation.label : "unknown";
    return `set night stay day ${dayNumber} (${label})`;
  }
  if (type === "no_op") {
    return "no-op";
  }
  return JSON.stringify(operation);
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

    if (session.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
      return NextResponse.json(
        {
          success: false,
          message: "LLM refinement is available only in GROUP_DAYS",
        },
        { status: 400 }
      );
    }

    const selectedActivities = session.suggestedActivities.filter((activity) =>
      session.selectedActivityIds.includes(activity.id)
    );
    const authoritativeScheduleBase = chooseAuthoritativeScheduleBase({
      currentSchedule: session.currentSchedule,
      legacyDayGroups: session.dayGroups,
      legacyUnassignedActivityIds: session.unassignedActivityIds || [],
    });

    if (selectedActivities.length === 0 || authoritativeScheduleBase.dayGroups.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No grouped activities available for refinement.",
        },
        { status: 400 }
      );
    }

    if (session.llmRefinementPreview) {
      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: session.workflowState,
        message: "Reopened unresolved LLM refinement preview.",
        llmRefinementResult: session.llmRefinementResult,
        llmRefinementPreview: session.llmRefinementPreview,
        tentativeSchedule: session.tentativeSchedule,
      });
    }

    const selectedActivityIdSet = new Set(selectedActivities.map((activity) => activity.id));
    const refinementBaseDayGroups = resolveBaseDayGroups({
      requestedDayGroups: null,
      fallbackDayGroups: authoritativeScheduleBase.dayGroups,
      validIds: selectedActivityIdSet,
    });
    const refinementBaseUnassignedActivityIds = resolveBaseUnassignedActivityIds({
      requestedUnassignedActivityIds: null,
      fallbackUnassignedActivityIds: authoritativeScheduleBase.unassignedActivityIds,
      validIds: selectedActivityIdSet,
    });

    const iteration = await runLlmRefinementIteration({
      tripInfo: session.tripInfo,
      selectedActivities,
      dayGroups: refinementBaseDayGroups,
      unassignedActivityIds: refinementBaseUnassignedActivityIds,
    });
    const dayCapacities = buildDayCapacityProfiles(session.tripInfo, refinementBaseDayGroups.length);
    const commuteMinutesByPair = await computeActivityCommuteMatrix(selectedActivities);
    const preparedMap = buildPreparedActivityMap(selectedActivities);
    const currentSchedule = authoritativeScheduleBase.source === "currentSchedule"
      ? session.currentSchedule
      : buildScoredSchedule({
        dayGroups: refinementBaseDayGroups,
        activities: selectedActivities,
        unassignedActivityIds: refinementBaseUnassignedActivityIds,
        dayCapacities,
        preparedMap,
        commuteMinutesByPair,
        options: { forceSchedule: true, tripInfo: session.tripInfo },
      });
    const rawTentativeSchedule = iteration.candidateDayGroups && iteration.candidateUnassignedActivityIds
      ? buildScoredSchedule({
        dayGroups: iteration.candidateDayGroups,
        activities: selectedActivities,
        unassignedActivityIds: iteration.candidateUnassignedActivityIds,
        dayCapacities,
        preparedMap,
        commuteMinutesByPair,
        options: { forceSchedule: true, tripInfo: session.tripInfo },
      })
      : null;
    const tentativeScheduleMatchesCurrent = Boolean(
      rawTentativeSchedule && schedulesHaveSamePlacements(currentSchedule, rawTentativeSchedule)
    );
    const tentativeSchedule =
      tentativeScheduleMatchesCurrent
        ? currentSchedule
        : rawTentativeSchedule;

    const beforeTotalCost = extractScheduleTotal(currentSchedule) ?? iteration.result.beforeTotalCost;
    const candidateTotalCost = extractScheduleTotal(tentativeSchedule) ?? iteration.result.candidateTotalCost;
    const costDelta =
      candidateTotalCost != null
        ? candidateTotalCost - beforeTotalCost
        : null;
    const accepted = costDelta != null ? costDelta < -1e-6 : false;
    const llmRefinementResult = {
      ...iteration.result,
      accepted,
      beforeTotalCost,
      candidateTotalCost,
      afterTotalCost: accepted && candidateTotalCost != null ? candidateTotalCost : beforeTotalCost,
      costDelta,
    };
    const delta =
      llmRefinementResult.candidateTotalCost != null
        ? llmRefinementResult.candidateTotalCost - llmRefinementResult.beforeTotalCost
        : null;
    const statusText =
      delta == null
        ? "candidate unavailable"
        : delta < 0
          ? `candidate lower by ${Math.abs(delta).toFixed(2)}`
          : delta > 0
            ? `candidate higher by ${delta.toFixed(2)}`
            : "candidate unchanged";
    const suggestedOps = Array.isArray(iteration.result.suggestedOperations)
      ? iteration.result.suggestedOperations
      : [];
    const activityNameById = new Map(selectedActivities.map((activity) => [activity.id, activity.name]));
    const suggestionsSummary = suggestedOps.length > 0
      ? suggestedOps
        .slice(0, 4)
        .map((operation) => summarizeSuggestedOperation(operation as Record<string, unknown>, activityNameById))
        .join("; ")
      : "none";
    const suggestionsSuffix = suggestedOps.length > 4 ? " (+more)" : "";
    const candidateTotalText = llmRefinementResult.candidateTotalCost != null
      ? llmRefinementResult.candidateTotalCost.toFixed(2)
      : "N/A";
    const message = `LLM refinement preview: ${statusText}. Total trip cost ${llmRefinementResult.beforeTotalCost.toFixed(2)} → ${candidateTotalText}. Suggestions: ${suggestionsSummary}${suggestionsSuffix}.`;
    const llmRefinementPreview = {
      hasCandidate: Boolean(iteration.candidateGroupedDays && iteration.candidateDayGroups && iteration.candidateUnassignedActivityIds),
      recommendedByCost: llmRefinementResult.accepted,
      beforeGroupedDays: currentSchedule.groupedDays,
      afterGroupedDays: tentativeSchedule?.groupedDays ?? iteration.candidateGroupedDays,
      beforeUnassignedActivityIds: currentSchedule.unassignedActivityIds,
      afterUnassignedActivityIds: tentativeSchedule?.unassignedActivityIds ?? iteration.candidateUnassignedActivityIds,
      candidateDayGroups: tentativeSchedule?.dayGroups ?? iteration.candidateDayGroups,
      candidateUnassignedActivityIds: tentativeSchedule?.unassignedActivityIds ?? iteration.candidateUnassignedActivityIds,
      currentSchedule,
      tentativeSchedule,
    };

    if (authoritativeScheduleBase.source === "currentSchedule") {
      sessionStore.update(sessionId, {
        llmRefinementResult,
        llmRefinementPreview,
        tentativeSchedule,
      });
    } else {
      sessionStore.update(sessionId, {
        currentSchedule,
        dayGroups: currentSchedule.dayGroups,
        groupedDays: currentSchedule.groupedDays,
        activityCostDebugById: currentSchedule.activityCostDebugById,
        unassignedActivityIds: currentSchedule.unassignedActivityIds,
        llmRefinementResult,
        llmRefinementPreview,
        tentativeSchedule,
      });
    }

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: session.workflowState,
      message,
      llmRefinementResult,
      llmRefinementPreview,
      tentativeSchedule,
      ...(authoritativeScheduleBase.source === "legacy"
        ? {
          currentSchedule,
          groupedDays: currentSchedule.groupedDays,
          dayGroups: currentSchedule.dayGroups,
          activityCostDebugById: currentSchedule.activityCostDebugById,
          unassignedActivityIds: currentSchedule.unassignedActivityIds,
        }
        : {}),
    });
  } catch (error) {
    console.error("Error in refineDayGrouping:", error);
    return NextResponse.json(
      { success: false, message: "Failed to refine day grouping", error: String(error) },
      { status: 500 }
    );
  }
}
