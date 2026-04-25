import { describe, expect, it } from "vitest";
import { chooseScheduleBackedRefinementTotals } from "./schedule-cost";

describe("chooseScheduleBackedRefinementTotals", () => {
  it("prefers schedule debug totals over refinement result totals", () => {
    const totals = chooseScheduleBackedRefinementTotals({
      beforeScheduleTotal: 931.67,
      candidateScheduleTotal: 1296.58,
      resultBeforeTotal: 82.67,
      resultCandidateTotal: 296.58,
    });

    expect(totals.beforeTotal).toBe(931.67);
    expect(totals.candidateTotal).toBe(1296.58);
  });

  it("falls back to refinement result totals when schedule totals are unavailable", () => {
    const totals = chooseScheduleBackedRefinementTotals({
      beforeScheduleTotal: null,
      candidateScheduleTotal: undefined,
      resultBeforeTotal: 82.67,
      resultCandidateTotal: 296.58,
    });

    expect(totals.beforeTotal).toBe(82.67);
    expect(totals.candidateTotal).toBe(296.58);
  });
});
