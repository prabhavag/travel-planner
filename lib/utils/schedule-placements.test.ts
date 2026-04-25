import { describe, expect, it } from "vitest";
import type { DayGroup } from "@/lib/models/travel-plan";
import type { ScheduleState } from "@/lib/services/day-grouping";
import { schedulesHaveSamePlacements } from "./schedule-placements";

const makeDay = (
  dayNumber: number,
  activityIds: string[],
  overallTripCost: number
): DayGroup => ({
  dayNumber,
  date: "",
  theme: `Day ${dayNumber}`,
  activityIds,
  nightStay: null,
  debugCost: {
    structuralCost: 0,
    balancePenalty: 0,
    dayCost: 0,
    commuteProxy: 0,
    totalHours: 0,
    overallTripCost,
    baseCost: 0,
    commuteImbalancePenalty: 0,
    nearbySplitPenalty: 0,
    durationMismatchPenalty: 0,
  },
});

const makeSchedule = (dayGroups: DayGroup[], unassignedActivityIds: string[]): ScheduleState => ({
  dayGroups,
  groupedDays: [],
  unassignedActivityIds,
  activityCostDebugById: {},
});

describe("schedulesHaveSamePlacements", () => {
  it("treats identical placements as the same schedule even when debug costs differ", () => {
    const current = makeSchedule([makeDay(1, ["a"], 1037.89)], ["b"]);
    const rebuilt = makeSchedule([makeDay(1, ["a"], 992.06)], ["b"]);

    expect(schedulesHaveSamePlacements(current, rebuilt)).toBe(true);
  });

  it("detects activity placement changes", () => {
    const current = makeSchedule([makeDay(1, ["a"], 1037.89), makeDay(2, [], 1037.89)], ["b"]);
    const candidate = makeSchedule([makeDay(1, [], 992.06), makeDay(2, ["a"], 992.06)], ["b"]);

    expect(schedulesHaveSamePlacements(current, candidate)).toBe(false);
  });
});
