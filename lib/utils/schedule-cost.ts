export function chooseScheduleBackedRefinementTotals({
  beforeScheduleTotal,
  candidateScheduleTotal,
  resultBeforeTotal,
  resultCandidateTotal,
}: {
  beforeScheduleTotal: number | null | undefined;
  candidateScheduleTotal: number | null | undefined;
  resultBeforeTotal: number | null | undefined;
  resultCandidateTotal: number | null | undefined;
}): {
  beforeTotal: number | null;
  candidateTotal: number | null;
} {
  return {
    beforeTotal: beforeScheduleTotal ?? resultBeforeTotal ?? null,
    candidateTotal: candidateScheduleTotal ?? resultCandidateTotal ?? null,
  };
}
