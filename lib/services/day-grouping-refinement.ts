import type { DayGroup, GroupedDay, SuggestedActivity, TripInfo } from "@/lib/models/travel-plan";
import {
  buildDayCapacityProfiles,
  buildPreparedActivityMap,
  buildScoredSchedule,
  computeActivityCommuteMatrix,
  generateDayTheme,
} from "@/lib/services/day-grouping";
import { getLLMClient, type DayGroupingRefinementOperation } from "@/lib/services/llm-client";
import type { ActivityCommuteMatrix, DayCapacityProfile, PreparedActivity } from "@/lib/services/day-grouping/types";
import { parseFixedStartTimeMinutes } from "@/lib/services/day-grouping/utils";
import { ALLOW_DURATION_SHRINKING } from "@/lib/planning-flags";

const IMPROVEMENT_EPSILON = 1e-6;
export const NO_COST_IMPROVEMENT_REASON = "Candidate plan did not reduce total cost.";

type EvaluatedPlan = {
  dayGroups: DayGroup[];
  groupedDays: GroupedDay[];
  overallCost: number;
};

export interface LlmRefinementResult {
  accepted: boolean;
  beforeTotalCost: number;
  candidateTotalCost: number | null;
  afterTotalCost: number;
  costDelta: number | null;
  operationType: DayGroupingRefinementOperation["type"] | "multi" | "error";
  operationCount: number;
  operationSummary: string;
  suggestedOperations: DayGroupingRefinementOperation[];
  reason: string | null;
  llmRequestMessages?: Array<{ role: "system" | "user"; content: string }>;
  llmRawResponse?: string | null;
  llmResponseSource?: "openai" | "manual";
}

export interface LlmRefinementIterationOutcome {
  dayGroups: DayGroup[];
  groupedDays: GroupedDay[];
  unassignedActivityIds: string[];
  currentDayGroups: DayGroup[];
  currentGroupedDays: GroupedDay[];
  currentUnassignedActivityIds: string[];
  candidateDayGroups: DayGroup[] | null;
  candidateGroupedDays: GroupedDay[] | null;
  candidateUnassignedActivityIds: string[] | null;
  result: LlmRefinementResult;
}

export function reconcileLlmRefinementResult({
  result,
  beforeTotalCost,
  candidateTotalCost,
}: {
  result: LlmRefinementResult;
  beforeTotalCost: number;
  candidateTotalCost: number | null;
}): LlmRefinementResult {
  const costDelta =
    candidateTotalCost != null
      ? candidateTotalCost - beforeTotalCost
      : null;
  const accepted = costDelta != null ? costDelta < -IMPROVEMENT_EPSILON : false;

  let reason = result.reason;
  if (accepted && reason === NO_COST_IMPROVEMENT_REASON) {
    reason = null;
  } else if (!accepted && candidateTotalCost != null && costDelta != null && costDelta >= -IMPROVEMENT_EPSILON) {
    reason = reason ?? NO_COST_IMPROVEMENT_REASON;
  }

  return {
    ...result,
    accepted,
    beforeTotalCost,
    candidateTotalCost,
    afterTotalCost: accepted && candidateTotalCost != null ? candidateTotalCost : beforeTotalCost,
    costDelta,
    reason,
  };
}

type NormalizedPlan = {
  dayGroups: DayGroup[];
  unassignedActivityIds: string[];
};

function cloneActivity(activity: SuggestedActivity): SuggestedActivity {
  return {
    ...activity,
    recommendedStartWindow: activity.recommendedStartWindow
      ? { ...activity.recommendedStartWindow }
      : null,
    interestTags: [...(activity.interestTags ?? [])],
    routeWaypoints: activity.routeWaypoints ? activity.routeWaypoints.map((waypoint) => ({ ...waypoint })) : undefined,
    routePoints: activity.routePoints ? activity.routePoints.map((point) => ({ ...point })) : undefined,
    coordinates: activity.coordinates ? { ...activity.coordinates } : activity.coordinates,
    startCoordinates: activity.startCoordinates ? { ...activity.startCoordinates } : activity.startCoordinates,
    endCoordinates: activity.endCoordinates ? { ...activity.endCoordinates } : activity.endCoordinates,
    photo_urls: activity.photo_urls ? [...activity.photo_urls] : activity.photo_urls,
  };
}

function cloneActivitiesById(activities: SuggestedActivity[]): Map<string, SuggestedActivity> {
  return new Map(activities.map((activity) => [activity.id, cloneActivity(activity)]));
}


function mapOperationsWithActivityNames(
  operations: DayGroupingRefinementOperation[],
  activityNameById: Map<string, string>
): Array<Record<string, unknown>> {
  return operations.map((operation) => {

    if (operation.type !== "move" && operation.type !== "reorder_activities") {
      return operation as unknown as Record<string, unknown>;
    }
    const activityLabels = operation.activityIds.map((id) => {
      const name = activityNameById.get(id);
      return name ? `${name} (${id})` : id;
    });
    return {
      ...operation,
      activityLabels,
    };
  });
}

function cloneDayGroups(dayGroups: DayGroup[]): DayGroup[] {
  return dayGroups.map((day) => ({
    ...day,
    activityIds: [...day.activityIds],
    nightStay: day.nightStay
      ? {
        ...day.nightStay,
        candidates: day.nightStay.candidates ? day.nightStay.candidates.map((candidate) => ({ ...candidate })) : undefined,
      }
      : null,
  }));
}

function normalizePlan({
  dayGroups,
  unassignedActivityIds,
  selectedActivityIds,
}: {
  dayGroups: DayGroup[];
  unassignedActivityIds: string[];
  selectedActivityIds: string[];
}): NormalizedPlan {
  const valid = new Set(selectedActivityIds);
  const seen = new Set<string>();
  const normalizedDayGroups = cloneDayGroups(dayGroups).map((day) => {
    const activityIds: string[] = [];
    for (const id of day.activityIds) {
      if (!valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      activityIds.push(id);
    }
    return {
      ...day,
      activityIds,
    };
  });

  const normalizedUnassigned: string[] = [];
  for (const id of unassignedActivityIds) {
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    normalizedUnassigned.push(id);
  }

  for (const id of selectedActivityIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    normalizedUnassigned.push(id);
  }

  return {
    dayGroups: normalizedDayGroups,
    unassignedActivityIds: normalizedUnassigned,
  };
}

function evaluatePlan({
  tripInfo,
  dayGroups,
  selectedActivities,
  unassignedActivityIds,
  dayCapacities,
  commuteMinutesByPair,
  preparedMap,
}: {
  tripInfo: TripInfo;
  dayGroups: DayGroup[];
  selectedActivities: SuggestedActivity[];
  unassignedActivityIds: string[];
  dayCapacities: DayCapacityProfile[];
  commuteMinutesByPair: ActivityCommuteMatrix;
  preparedMap: Map<string, PreparedActivity>;
}): EvaluatedPlan {
  const schedule = buildScoredSchedule({
    dayGroups,
    activities: selectedActivities,
    unassignedActivityIds,
    dayCapacities,
    preparedMap,
    commuteMinutesByPair,
    options: { forceSchedule: true, forceSource: "llm", tripInfo },
  });
  const firstDayCost = schedule.dayGroups.find(
    (day) => typeof day.debugCost?.overallTripCost === "number"
  )?.debugCost?.overallTripCost;
  const overallCost = firstDayCost ?? Number.POSITIVE_INFINITY;

  return {
    dayGroups: schedule.dayGroups,
    groupedDays: schedule.groupedDays,
    overallCost,
  };
}

function summarizeOperation(operation: DayGroupingRefinementOperation): string {
  switch (operation.type) {
    case "move":
      return operation.dayNumber === 0
        ? `Move to Unassigned: ${operation.activityIds.join(", ")}`
        : `Move to Day ${operation.dayNumber}: ${operation.activityIds.join(", ")}`;
    case "reorder_activities":
      return `Reorder Day ${operation.dayNumber}: ${operation.activityIds.join(", ")}`;
    case "set_night_stay":
      return `Set night stay Day ${operation.dayNumber}: ${operation.label}`;

    case "no_op":
      return "No refinement changes proposed.";
    default:
      return "Unknown refinement operation.";
  }
}

function removeActivityFromDayGroups(dayGroups: DayGroup[], activityId: string): void {
  for (const day of dayGroups) {
    day.activityIds = day.activityIds.filter((id) => id !== activityId);
  }
}

function removeActivityFromUnassigned(unassignedActivityIds: string[], activityId: string): string[] {
  return unassignedActivityIds.filter((id) => id !== activityId);
}

function applyOperation({
  operation,
  dayGroups,
  unassignedActivityIds,
  selectedActivityIdSet,
  activitiesById,
}: {
  operation: DayGroupingRefinementOperation;
  dayGroups: DayGroup[];
  unassignedActivityIds: string[];
  selectedActivityIdSet: Set<string>;
  activitiesById: Map<string, SuggestedActivity>;
}): {
  ok: boolean;
  dayGroups: DayGroup[];
  unassignedActivityIds: string[];
  rejectionReason: string | null;
} {
  let nextUnassignedActivityIds = [...unassignedActivityIds];
  const nextDayGroups = cloneDayGroups(dayGroups);

  if (operation.type === "no_op") {
    return {
      ok: true,
      dayGroups: nextDayGroups,
      unassignedActivityIds: nextUnassignedActivityIds,
      rejectionReason: null,
    };
  }

  if (operation.type === "move") {
    const isUnassignedMove = operation.dayNumber === 0;
    const targetDay = isUnassignedMove
      ? null
      : nextDayGroups.find((day) => day.dayNumber === operation.dayNumber);
    if (!isUnassignedMove && !targetDay) {
      return {
        ok: false,
        dayGroups,
        unassignedActivityIds,
        rejectionReason: `Target day ${operation.dayNumber} does not exist.`,
      };
    }

    const activityIds = [...new Set(operation.activityIds)].filter((id) => selectedActivityIdSet.has(id));
    if (activityIds.length === 0) {
      return {
        ok: false,
        dayGroups,
        unassignedActivityIds,
        rejectionReason: "Move operation did not include valid activity IDs.",
      };
    }

    for (const activityId of activityIds) {
      removeActivityFromDayGroups(nextDayGroups, activityId);
      nextUnassignedActivityIds = removeActivityFromUnassigned(nextUnassignedActivityIds, activityId);
    }

    if (isUnassignedMove) {
      for (const activityId of activityIds) {
        if (!nextUnassignedActivityIds.includes(activityId)) {
          nextUnassignedActivityIds.push(activityId);
        }
      }
      return {
        ok: true,
        dayGroups: nextDayGroups,
        unassignedActivityIds: nextUnassignedActivityIds,
        rejectionReason: null,
      };
    }

    const insertionBase =
      typeof operation.insertIndex === "number"
        ? Math.min(Math.max(0, operation.insertIndex), targetDay!.activityIds.length)
        : targetDay!.activityIds.length;
    activityIds.forEach((activityId, index) => {
      targetDay!.activityIds.splice(insertionBase + index, 0, activityId);
    });

    return {
      ok: true,
      dayGroups: nextDayGroups,
      unassignedActivityIds: nextUnassignedActivityIds,
      rejectionReason: null,
    };
  }

  if (operation.type === "reorder_activities") {
    const targetDay = nextDayGroups.find((day) => day.dayNumber === operation.dayNumber);
    if (!targetDay) {
      return {
        ok: false,
        dayGroups,
        unassignedActivityIds,
        rejectionReason: `Target day ${operation.dayNumber} does not exist.`,
      };
    }

    const reorderedIds = [...new Set(operation.activityIds)].filter((id) => selectedActivityIdSet.has(id));
    if (reorderedIds.length === 0) {
      return {
        ok: false,
        dayGroups,
        unassignedActivityIds,
        rejectionReason: "Reorder operation did not include valid activity IDs.",
      };
    }

    const currentIds = targetDay.activityIds.filter((id) => selectedActivityIdSet.has(id));
    if (currentIds.length !== reorderedIds.length) {
      return {
        ok: false,
        dayGroups,
        unassignedActivityIds,
        rejectionReason: "Reorder operation must include the full activity list for the target day.",
      };
    }

    const currentIdSet = new Set(currentIds);
    const hasExactMembership = reorderedIds.every((id) => currentIdSet.has(id));
    if (!hasExactMembership) {
      return {
        ok: false,
        dayGroups,
        unassignedActivityIds,
        rejectionReason: "Reorder operation can only reorder activities already scheduled on the target day.",
      };
    }

    targetDay.activityIds = reorderedIds;
    return {
      ok: true,
      dayGroups: nextDayGroups,
      unassignedActivityIds: nextUnassignedActivityIds,
      rejectionReason: null,
    };
  }

  if (operation.type === "set_night_stay") {
    const targetDay = nextDayGroups.find((day) => day.dayNumber === operation.dayNumber);
    if (!targetDay) {
      return {
        ok: false,
        dayGroups,
        unassignedActivityIds,
        rejectionReason: `Target day ${operation.dayNumber} does not exist.`,
      };
    }
    targetDay.nightStay = {
      label: operation.label.trim(),
      notes: operation.notes ?? null,
      coordinates: targetDay.nightStay?.coordinates ?? null,
    };
    return {
      ok: true,
      dayGroups: nextDayGroups,
      unassignedActivityIds: nextUnassignedActivityIds,
      rejectionReason: null,
    };
  }



  return {
    ok: false,
    dayGroups,
    unassignedActivityIds,
    rejectionReason: "Unknown operation type.",
  };
}

function recomputeThemes(dayGroups: DayGroup[], activitiesById: Map<string, SuggestedActivity>): DayGroup[] {
  return dayGroups.map((day) => {
    const activities = day.activityIds
      .map((id) => activitiesById.get(id))
      .filter((activity): activity is SuggestedActivity => activity !== undefined);
    return {
      ...day,
      theme: generateDayTheme(activities),
    };
  });
}

export async function runLlmRefinementIteration({
  tripInfo,
  selectedActivities,
  dayGroups,
  unassignedActivityIds,
  manualLlmResponse,
}: {
  tripInfo: TripInfo;
  selectedActivities: SuggestedActivity[];
  dayGroups: DayGroup[];
  unassignedActivityIds: string[];
  manualLlmResponse?: string | null;
}): Promise<LlmRefinementIterationOutcome> {
  const selectedActivityIds = selectedActivities.map((activity) => activity.id);
  const selectedActivityIdSet = new Set(selectedActivityIds);
  const currentActivitiesById = cloneActivitiesById(selectedActivities);
  const currentSelectedActivities = selectedActivityIds
    .map((activityId) => currentActivitiesById.get(activityId))
    .filter((activity): activity is SuggestedActivity => activity != null);
  const dayCapacities = buildDayCapacityProfiles(tripInfo, dayGroups.length);
  const commuteMinutesByPair = await computeActivityCommuteMatrix(currentSelectedActivities);
  const currentPreparedMap = buildPreparedActivityMap(currentSelectedActivities);
  const normalizedCurrent = normalizePlan({
    dayGroups,
    unassignedActivityIds,
    selectedActivityIds,
  });
  const currentWithThemes = recomputeThemes(normalizedCurrent.dayGroups, currentActivitiesById);
  const currentEvaluation = evaluatePlan({
    tripInfo,
    dayGroups: currentWithThemes,
    selectedActivities: currentSelectedActivities,
    unassignedActivityIds: normalizedCurrent.unassignedActivityIds,
    dayCapacities,
    commuteMinutesByPair,
    preparedMap: currentPreparedMap,
  });
  const currentSnapshot = {
    currentDayGroups: currentEvaluation.dayGroups,
    currentGroupedDays: currentEvaluation.groupedDays,
    currentUnassignedActivityIds: normalizedCurrent.unassignedActivityIds,
  } as const;

  const createOutcome = ({
    dayGroups: appliedDayGroups,
    groupedDays: appliedGroupedDays,
    unassignedActivityIds: appliedUnassignedActivityIds,
    candidateDayGroups,
    candidateGroupedDays,
    candidateUnassignedActivityIds,
    result,
  }: {
    dayGroups: DayGroup[];
    groupedDays: GroupedDay[];
    unassignedActivityIds: string[];
    candidateDayGroups: DayGroup[] | null;
    candidateGroupedDays: GroupedDay[] | null;
    candidateUnassignedActivityIds: string[] | null;
    result: LlmRefinementResult;
  }): LlmRefinementIterationOutcome => ({
    dayGroups: appliedDayGroups,
    groupedDays: appliedGroupedDays,
    unassignedActivityIds: appliedUnassignedActivityIds,
    currentDayGroups: currentSnapshot.currentDayGroups,
    currentGroupedDays: currentSnapshot.currentGroupedDays,
    currentUnassignedActivityIds: currentSnapshot.currentUnassignedActivityIds,
    candidateDayGroups,
    candidateGroupedDays,
    candidateUnassignedActivityIds,
    result,
  });

  const llmClient = getLLMClient();
  const proposal = await llmClient.proposeDayGroupingRefinementStep({
    tripInfo,
    activities: selectedActivities,
    dayGroups: currentEvaluation.dayGroups,
    groupedDays: currentEvaluation.groupedDays,
    unassignedActivityIds: normalizedCurrent.unassignedActivityIds,
    currentCost: currentEvaluation.overallCost,
    allowDurationShrinking: ALLOW_DURATION_SHRINKING,
    manualResponseText: manualLlmResponse,
  });
  const llmDebug = {
    llmRequestMessages: proposal.requestMessages,
    llmRawResponse: proposal.rawResponseText,
    llmResponseSource: proposal.source,
  } as const;
  if (proposal.success && proposal.operations) {
    const activityNameById = new Map(currentSelectedActivities.map((activity) => [activity.id, activity.name]));
    const namedOperations = mapOperationsWithActivityNames(proposal.operations, activityNameById);
    console.debug("[LLM Refine] Suggested operations (named):", JSON.stringify(namedOperations));
  } else {
    console.debug("[LLM Refine] No valid operations returned by LLM.");
  }

  if (!proposal.success || !proposal.operations || proposal.operations.length === 0) {
    return createOutcome({
      dayGroups: currentEvaluation.dayGroups,
      groupedDays: currentEvaluation.groupedDays,
      unassignedActivityIds: normalizedCurrent.unassignedActivityIds,
      candidateDayGroups: null,
      candidateGroupedDays: null,
      candidateUnassignedActivityIds: null,
      result: {
        accepted: false,
        beforeTotalCost: currentEvaluation.overallCost,
        candidateTotalCost: null,
        afterTotalCost: currentEvaluation.overallCost,
        costDelta: null,
        operationType: "error",
        operationCount: 0,
        operationSummary: "LLM proposal unavailable.",
        suggestedOperations: [],
        reason: "LLM did not return a valid refinement operation.",
        ...llmDebug,
      },
    });
  }

  const operations = proposal.operations;
  const nonNoOpOperations = operations.filter((operation) => operation.type !== "no_op");
  const noOpReason = operations.find((operation) => operation.type === "no_op")?.reason ?? null;
  if (nonNoOpOperations.length === 0) {
    return createOutcome({
      dayGroups: currentEvaluation.dayGroups,
      groupedDays: currentEvaluation.groupedDays,
      unassignedActivityIds: normalizedCurrent.unassignedActivityIds,
      candidateDayGroups: null,
      candidateGroupedDays: null,
      candidateUnassignedActivityIds: null,
      result: {
        accepted: false,
        beforeTotalCost: currentEvaluation.overallCost,
        candidateTotalCost: currentEvaluation.overallCost,
        afterTotalCost: currentEvaluation.overallCost,
        costDelta: 0,
        operationType: "no_op",
        operationCount: operations.length,
        operationSummary: "No refinement changes proposed.",
        suggestedOperations: operations,
        reason: noOpReason ?? "No likely improvement identified.",
        ...llmDebug,
      },
    });
  }

  let stagedDayGroups = currentEvaluation.dayGroups;
  let stagedUnassignedActivityIds = normalizedCurrent.unassignedActivityIds;
  const stagedActivitiesById = cloneActivitiesById(currentSelectedActivities);
  const operationSummaries: string[] = [];
  for (let index = 0; index < nonNoOpOperations.length; index += 1) {
    const operation = nonNoOpOperations[index];
    const applied = applyOperation({
      operation,
      dayGroups: stagedDayGroups,
      unassignedActivityIds: stagedUnassignedActivityIds,
      selectedActivityIdSet,
      activitiesById: stagedActivitiesById,
    });
    if (!applied.ok) {
      return createOutcome({
        dayGroups: currentEvaluation.dayGroups,
        groupedDays: currentEvaluation.groupedDays,
        unassignedActivityIds: normalizedCurrent.unassignedActivityIds,
        candidateDayGroups: null,
        candidateGroupedDays: null,
        candidateUnassignedActivityIds: null,
        result: {
          accepted: false,
          beforeTotalCost: currentEvaluation.overallCost,
          candidateTotalCost: null,
          afterTotalCost: currentEvaluation.overallCost,
          costDelta: null,
          operationType: nonNoOpOperations.length > 1 ? "multi" : operation.type,
          operationCount: nonNoOpOperations.length,
          operationSummary: nonNoOpOperations.map((op) => summarizeOperation(op)).join(" | "),
          suggestedOperations: operations,
          reason: `Operation ${index + 1} failed: ${applied.rejectionReason}`,
          ...llmDebug,
        },
      });
    }
    stagedDayGroups = applied.dayGroups;
    stagedUnassignedActivityIds = applied.unassignedActivityIds;
    operationSummaries.push(summarizeOperation(operation));
  }

  const normalizedCandidate = normalizePlan({
    dayGroups: stagedDayGroups,
    unassignedActivityIds: stagedUnassignedActivityIds,
    selectedActivityIds,
  });
  const candidateSelectedActivities = selectedActivityIds
    .map((activityId) => stagedActivitiesById.get(activityId))
    .filter((activity): activity is SuggestedActivity => activity != null);
  const candidatePreparedMap = buildPreparedActivityMap(candidateSelectedActivities);
  const candidateWithThemes = recomputeThemes(normalizedCandidate.dayGroups, stagedActivitiesById);
  const candidateEvaluation = evaluatePlan({
    tripInfo,
    dayGroups: candidateWithThemes,
    selectedActivities: candidateSelectedActivities,
    unassignedActivityIds: normalizedCandidate.unassignedActivityIds,
    dayCapacities,
    commuteMinutesByPair,
    preparedMap: candidatePreparedMap,
  });

  const isImproved = candidateEvaluation.overallCost + IMPROVEMENT_EPSILON < currentEvaluation.overallCost;
  if (!isImproved) {
    return createOutcome({
      dayGroups: currentEvaluation.dayGroups,
      groupedDays: currentEvaluation.groupedDays,
      unassignedActivityIds: normalizedCurrent.unassignedActivityIds,
      candidateDayGroups: candidateEvaluation.dayGroups,
      candidateGroupedDays: candidateEvaluation.groupedDays,
      candidateUnassignedActivityIds: normalizedCandidate.unassignedActivityIds,
      result: {
        accepted: false,
        beforeTotalCost: currentEvaluation.overallCost,
        candidateTotalCost: candidateEvaluation.overallCost,
        afterTotalCost: currentEvaluation.overallCost,
        costDelta: candidateEvaluation.overallCost - currentEvaluation.overallCost,
        operationType: nonNoOpOperations.length > 1 ? "multi" : nonNoOpOperations[0].type,
        operationCount: nonNoOpOperations.length,
        operationSummary: operationSummaries.join(" | "),
        suggestedOperations: operations,
        reason: NO_COST_IMPROVEMENT_REASON,
        ...llmDebug,
      },
    });
  }

  return createOutcome({
    dayGroups: candidateEvaluation.dayGroups,
    groupedDays: candidateEvaluation.groupedDays,
    unassignedActivityIds: normalizedCandidate.unassignedActivityIds,
    candidateDayGroups: candidateEvaluation.dayGroups,
    candidateGroupedDays: candidateEvaluation.groupedDays,
    candidateUnassignedActivityIds: normalizedCandidate.unassignedActivityIds,
    result: {
      accepted: true,
      beforeTotalCost: currentEvaluation.overallCost,
      candidateTotalCost: candidateEvaluation.overallCost,
      afterTotalCost: candidateEvaluation.overallCost,
      costDelta: candidateEvaluation.overallCost - currentEvaluation.overallCost,
      operationType: nonNoOpOperations.length > 1 ? "multi" : nonNoOpOperations[0].type,
      operationCount: nonNoOpOperations.length,
      operationSummary: operationSummaries.join(" | "),
      suggestedOperations: operations,
      reason: noOpReason,
      ...llmDebug,
    },
  });
}
