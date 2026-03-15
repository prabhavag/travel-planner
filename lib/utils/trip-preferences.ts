type TripPreferenceContext = {
  preferences?: string[] | null;
  foodPreferences?: string[] | null;
};

function normalizeUnique(values: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values || []) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

export function getTripPreferences(context: TripPreferenceContext | null | undefined): string[] {
  return normalizeUnique(context?.preferences);
}

export function getTripFoodPreferences(context: TripPreferenceContext | null | undefined): string[] {
  return normalizeUnique(context?.foodPreferences);
}

export function getCombinedTripPreferences(context: TripPreferenceContext | null | undefined): string[] {
  return normalizeUnique([
    ...getTripPreferences(context),
    ...getTripFoodPreferences(context),
  ]);
}

export function formatTripPreferenceSummary(
  context: TripPreferenceContext | null | undefined,
  fallback = "General tourism"
): string {
  const preferences = getTripPreferences(context);
  return preferences.length > 0 ? preferences.join(", ") : fallback;
}

export function hasTripPreferenceContext(context: TripPreferenceContext | null | undefined): boolean {
  return getCombinedTripPreferences(context).length > 0;
}
