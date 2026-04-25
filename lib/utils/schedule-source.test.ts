import { describe, expect, it } from "vitest";
import type { DayGroup } from "@/lib/models/travel-plan";
import type { ScheduleState } from "@/lib/services/day-grouping";
import { chooseAuthoritativeScheduleBase } from "./schedule-source";

const makeDay = (dayNumber: number, activityIds: string[]): DayGroup => ({
  dayNumber,
  date: "",
  theme: `Day ${dayNumber}`,
  activityIds,
  nightStay: null,
  debugCost: null,
});

describe("chooseAuthoritativeScheduleBase", () => {
  it("uses currentSchedule instead of stale legacy mirrors", () => {
    const currentSchedule: ScheduleState = {
      dayGroups: [makeDay(1, ["current-a"])],
      groupedDays: [],
      unassignedActivityIds: ["current-unassigned"],
      activityCostDebugById: {},
    };

    const base = chooseAuthoritativeScheduleBase({
      currentSchedule,
      legacyDayGroups: [makeDay(1, ["legacy-a"])],
      legacyUnassignedActivityIds: ["legacy-unassigned"],
    });

    expect(base.source).toBe("currentSchedule");
    expect(base.dayGroups[0]?.activityIds).toEqual(["current-a"]);
    expect(base.unassignedActivityIds).toEqual(["current-unassigned"]);
  });

  it("falls back to legacy mirrors for sessions without a current schedule", () => {
    const base = chooseAuthoritativeScheduleBase({
      currentSchedule: {
        dayGroups: [],
        groupedDays: [],
        unassignedActivityIds: [],
        activityCostDebugById: {},
      },
      legacyDayGroups: [makeDay(1, ["legacy-a"])],
      legacyUnassignedActivityIds: ["legacy-unassigned"],
    });

    expect(base.source).toBe("legacy");
    expect(base.dayGroups[0]?.activityIds).toEqual(["legacy-a"]);
    expect(base.unassignedActivityIds).toEqual(["legacy-unassigned"]);
  });
});
