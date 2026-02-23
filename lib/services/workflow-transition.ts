import type { WorkflowState } from "@/lib/models/travel-plan";

export type TransitionOwner = "UI" | "SUPERVISOR";

export const WORKFLOW_SEQUENCE: WorkflowState[] = [
  "INFO_GATHERING",
  "INITIAL_RESEARCH",
  "GROUP_DAYS",
  "DAY_ITINERARY",
  "MEAL_PREFERENCES",
  "REVIEW",
  "FINALIZE",
];

export function requiresTravelOfferCompletionForState(state: WorkflowState): boolean {
  void state;
  return false;
}

export function isWorkflowState(value: string): value is WorkflowState {
  return WORKFLOW_SEQUENCE.includes(value as WorkflowState);
}

export function validateWorkflowTransition({
  from,
  to,
  owner,
}: {
  from: WorkflowState;
  to: WorkflowState;
  owner: TransitionOwner;
}): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: true };

  const fromIndex = WORKFLOW_SEQUENCE.indexOf(from);
  const toIndex = WORKFLOW_SEQUENCE.indexOf(to);

  if (fromIndex < 0 || toIndex < 0) {
    return { ok: false, reason: "Unknown workflow state." };
  }

  // Forward transitions are deterministic and one step at a time.
  if (toIndex === fromIndex + 1) {
    return { ok: true };
  }

  // Backward transitions are explicit UI-only.
  if (toIndex < fromIndex && owner === "UI") {
    return { ok: true };
  }

  if (toIndex < fromIndex) {
    return {
      ok: false,
      reason: "Backward transitions are only allowed for explicit UI navigation.",
    };
  }

  return {
    ok: false,
    reason: "Skipping forward stages is not allowed.",
  };
}
