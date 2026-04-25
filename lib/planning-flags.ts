export const ALLOW_DURATION_SHRINKING = false;

const FLEXIBLE_ACTIVITY_DURATION_RETAIN_RATIO = 0.75;

export function canShrinkDuration(isDurationFlexible: boolean | null | undefined): boolean {
  return ALLOW_DURATION_SHRINKING && isDurationFlexible !== false;
}

export function computePlannableDurationHours(
  recommendedHours: number,
  isDurationFlexible: boolean | null | undefined
): number {
  const safeRecommendedHours = Math.max(0, Number.isFinite(recommendedHours) ? recommendedHours : 0);
  if (!canShrinkDuration(isDurationFlexible)) {
    return safeRecommendedHours;
  }
  const retainedHours = Math.min(
    safeRecommendedHours,
    Math.max(1, safeRecommendedHours * FLEXIBLE_ACTIVITY_DURATION_RETAIN_RATIO)
  );
  return Math.max(0.25, retainedHours);
}
