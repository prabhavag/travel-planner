import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestedActivity, TripInfo } from "@/lib/models/travel-plan";

const proposeDayGroupingRefinementStep = vi.fn();

vi.mock("@/lib/services/llm-client", () => ({
  getLLMClient: () => ({
    proposeDayGroupingRefinementStep,
  }),
}));

import {
  NO_COST_IMPROVEMENT_REASON,
  reconcileLlmRefinementResult,
  runLlmRefinementIteration,
} from "./day-grouping-refinement";

function mockActivity(
  id: string,
  overrides: Partial<SuggestedActivity> = {}
): SuggestedActivity {
  return {
    id,
    name: `Activity ${id}`,
    type: "museum",
    interestTags: [],
    description: "",
    estimatedDuration: "1 hour",
    isDurationFlexible: false,
    estimatedCost: 10,
    currency: "USD",
    difficultyLevel: "easy",
    bestTimeOfDay: "morning",
    coordinates: { lat: 20.8, lng: -156.3 },
    locationMode: "point",
    status: "selected",
    ...overrides,
  } as SuggestedActivity;
}

const tripInfo: TripInfo = {
  source: null,
  destination: "Maui",
  startDate: "2026-03-10",
  endDate: "2026-03-10",
  durationDays: 1,
  preferences: [],
  foodPreferences: [],
  visitedDestinations: [],
  activityLevel: "moderate",
  travelers: 1,
  budget: null,
  transportMode: "flight",
  arrivalAirport: null,
  departureAirport: null,
  arrivalTimePreference: "12:00 PM",
  departureTimePreference: "6:00 PM",
};

describe("runLlmRefinementIteration reorder_activities", () => {
  beforeEach(() => {
    proposeDayGroupingRefinementStep.mockReset();
  });


  it("builds a reordered candidate for same-day intraday changes", async () => {
    const early = mockActivity("early", {
      bestTimeOfDay: "morning",
      isFixedStartTime: true,
      fixedStartTime: "9:30 AM",
    });
    const late = mockActivity("late", {
      bestTimeOfDay: "afternoon",
      isFixedStartTime: true,
      fixedStartTime: "1:00 PM",
    });

    proposeDayGroupingRefinementStep.mockResolvedValue({
      success: true,
      operations: [{
        type: "reorder_activities",
        dayNumber: 1,
        activityIds: ["early", "late"],
      }],
    });

    const outcome = await runLlmRefinementIteration({
      tripInfo,
      selectedActivities: [early, late],
      dayGroups: [{
        dayNumber: 1,
        date: "2026-03-10",
        theme: "Day 1",
        activityIds: ["late", "early"],
        nightStay: null,
        debugCost: null,
      }],
      unassignedActivityIds: [],
    });

    expect(outcome.candidateDayGroups?.[0].activityIds).toEqual(["early", "late"]);
    expect(outcome.result.operationType).toBe("reorder_activities");
    expect(outcome.result.suggestedOperations).toEqual([{
      type: "reorder_activities",
      dayNumber: 1,
      activityIds: ["early", "late"],
    }]);
  });

  it("rejects reorder payloads that do not include the full day ordering", async () => {
    const first = mockActivity("first");
    const second = mockActivity("second", {
      bestTimeOfDay: "afternoon",
    });

    proposeDayGroupingRefinementStep.mockResolvedValue({
      success: true,
      operations: [{
        type: "reorder_activities",
        dayNumber: 1,
        activityIds: ["second"],
      }],
    });

    const outcome = await runLlmRefinementIteration({
      tripInfo,
      selectedActivities: [first, second],
      dayGroups: [{
        dayNumber: 1,
        date: "2026-03-10",
        theme: "Day 1",
        activityIds: ["first", "second"],
        nightStay: null,
        debugCost: null,
      }],
      unassignedActivityIds: [],
    });

    expect(outcome.result.accepted).toBe(false);
    expect(outcome.result.reason).toContain("full activity list");
    expect(outcome.candidateDayGroups).toBeNull();
  });

  it("applies repeated activities across sequential operations", async () => {
    const moved = mockActivity("moved", {
      bestTimeOfDay: "morning",
    });
    const existing = mockActivity("existing", {
      bestTimeOfDay: "afternoon",
    });
    const source = mockActivity("source", {
      bestTimeOfDay: "evening",
    });

    proposeDayGroupingRefinementStep.mockResolvedValue({
      success: true,
      operations: [
        {
          type: "move",
          dayNumber: 2,
          activityIds: ["moved"],
          insertIndex: 0,
        },
        {
          type: "reorder_activities",
          dayNumber: 2,
          activityIds: ["moved", "existing"],
        },
      ],
    });

    const outcome = await runLlmRefinementIteration({
      tripInfo: {
        ...tripInfo,
        endDate: "2026-03-11",
        durationDays: 2,
      },
      selectedActivities: [moved, existing, source],
      dayGroups: [
        {
          dayNumber: 1,
          date: "2026-03-10",
          theme: "Day 1",
          activityIds: ["source", "moved"],
          nightStay: null,
          debugCost: null,
        },
        {
          dayNumber: 2,
          date: "2026-03-11",
          theme: "Day 2",
          activityIds: ["existing"],
          nightStay: null,
          debugCost: null,
        },
      ],
      unassignedActivityIds: [],
    });

    expect(outcome.candidateDayGroups).not.toBeNull();
    expect(outcome.result.reason).toBeNull();
    expect(outcome.result.operationSummary).toContain("Move to Day 2: moved");
    expect(outcome.result.operationSummary).toContain("Reorder Day 2: moved, existing");
  });
});

describe("reconcileLlmRefinementResult", () => {
  it("clears the generic non-improvement reason when recomputed totals improve", () => {
    const reconciled = reconcileLlmRefinementResult({
      result: {
        accepted: false,
        beforeTotalCost: 874.41,
        candidateTotalCost: 874.41,
        afterTotalCost: 874.41,
        costDelta: 0,
        operationType: "multi",
        operationCount: 2,
        operationSummary: "Move to Unassigned: opt12 | Move to Day 2: opt13",
        suggestedOperations: [],
        reason: NO_COST_IMPROVEMENT_REASON,
      },
      beforeTotalCost: 874.41,
      candidateTotalCost: 742.2,
    });

    expect(reconciled.accepted).toBe(true);
    expect(reconciled.costDelta).toBeCloseTo(-132.21, 6);
    expect(reconciled.reason).toBeNull();
  });

  it("adds the generic non-improvement reason when recomputed totals do not improve", () => {
    const reconciled = reconcileLlmRefinementResult({
      result: {
        accepted: true,
        beforeTotalCost: 500,
        candidateTotalCost: 450,
        afterTotalCost: 450,
        costDelta: -50,
        operationType: "move",
        operationCount: 1,
        operationSummary: "Move to Day 2: opt13",
        suggestedOperations: [],
        reason: null,
      },
      beforeTotalCost: 500,
      candidateTotalCost: 500,
    });

    expect(reconciled.accepted).toBe(false);
    expect(reconciled.reason).toBe(NO_COST_IMPROVEMENT_REASON);
  });
});

