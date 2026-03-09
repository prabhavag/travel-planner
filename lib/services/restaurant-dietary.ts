function normalizePreferences(preferences: string[]): string[] {
  return (preferences || []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function buildRestaurantQueries(preferences: string[], destination?: string | null): string[] {
  const normalized = normalizePreferences(preferences);
  const preferenceContext = normalized.slice(0, 4).join(", ");
  const destinationSuffix = destination ? ` in ${destination}` : "";

  if (preferenceContext) {
    return [
      `restaurants for ${preferenceContext}${destinationSuffix}`,
      `best restaurants for ${preferenceContext}${destinationSuffix}`,
      `restaurant${destinationSuffix}`,
    ];
  }

  return [`restaurant${destinationSuffix}`];
}
