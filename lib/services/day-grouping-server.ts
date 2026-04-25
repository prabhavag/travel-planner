import type { DayGroup, SuggestedActivity, TripInfo } from "@/lib/models/travel-plan";
import {
  buildDayCapacityProfiles,
  buildTripDates,
  buildPreparedActivityMap,
  buildScoredSchedule,
  computeActivityCommuteMatrix,
  computeDayCount,
  groupActivitiesByDay,
  type ScheduleState,
} from "@/lib/services/day-grouping";
import type { ActivityGroupingStrategy } from "@/lib/services/day-grouping/types";
import { getLLMClient } from "@/lib/services/llm-client";

export type GroupActivitiesByDayStrategyResult = {
  schedule: ScheduleState;
  unassignedActivityIds: string[];
  appliedStrategy: ActivityGroupingStrategy;
};

async function groupActivitiesByDayLlm({
  tripInfo,
  activities,
}: {
  tripInfo: TripInfo;
  activities: SuggestedActivity[];
}): Promise<GroupActivitiesByDayStrategyResult | null> {
  const dayCount = computeDayCount(tripInfo, activities.length);
  const dates = buildTripDates(tripInfo, dayCount);
  const dayCapacities = buildDayCapacityProfiles(tripInfo, dayCount);
  const commuteMinutesByPair = await computeActivityCommuteMatrix(activities);
  const preparedMap = buildPreparedActivityMap(activities);

  const llmClient = getLLMClient();
  const response = await llmClient.groupActivitiesIntoDays({
    tripInfo,
    activities,
    dayCount,
    dates,
  });
  if (!response.success || response.dayGroups.length === 0) {
    return null;
  }

  const schedule = buildScoredSchedule({
    dayGroups: response.dayGroups,
    activities,
    unassignedActivityIds: response.unassignedActivityIds,
    dayCapacities,
    preparedMap,
    commuteMinutesByPair,
    options: { forceSchedule: true, tripInfo },
  });

  return {
    schedule,
    unassignedActivityIds: schedule.unassignedActivityIds,
    appliedStrategy: "llm",
  };
}

export async function groupActivitiesByDayWithStrategy({
  tripInfo,
  activities,
  strategy = "heuristic",
}: {
  tripInfo: TripInfo;
  activities: SuggestedActivity[];
  strategy?: ActivityGroupingStrategy;
}): Promise<GroupActivitiesByDayStrategyResult> {
  const requestedStrategy: ActivityGroupingStrategy = strategy === "llm" ? "llm" : "heuristic";

  if (requestedStrategy === "llm") {
    try {
      const llmResult = await groupActivitiesByDayLlm({ tripInfo, activities });
      if (llmResult) return llmResult;
      console.warn("LLM day grouping returned no usable result; falling back to heuristic grouping.");
    } catch (error) {
      console.error("LLM day grouping failed; falling back to heuristic grouping.", error);
    }
  }

  const dayGroups = await groupActivitiesByDay({ tripInfo, activities });
  const dayCapacities = buildDayCapacityProfiles(tripInfo, dayGroups.length);
  const commuteMinutesByPair = await computeActivityCommuteMatrix(activities);
  const preparedMap = buildPreparedActivityMap(activities);

  const schedule = buildScoredSchedule({
    dayGroups,
    activities,
    unassignedActivityIds: [],
    dayCapacities,
    preparedMap,
    commuteMinutesByPair,
    options: { forceSchedule: false, tripInfo },
  });

  return {
    schedule,
    unassignedActivityIds: schedule.unassignedActivityIds,
    appliedStrategy: "heuristic",
  };
}
