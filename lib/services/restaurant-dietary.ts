function normalizePreferences(preferences: string[]): string[] {
  return (preferences || []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function getRestaurantPreferenceContext(preferences: string[], foodPreferences: string[]): string[] {
  const normalizedFood = normalizePreferences(foodPreferences);
  const normalizedPreferences = normalizePreferences(preferences).filter((value) =>
    /vegetarian|vegan|no meat|no seafood|halal|kosher|gluten|spicy|seafood|street food|dessert|coffee|brunch|market/i.test(
      value
    )
  );

  return Array.from(new Set([...normalizedFood, ...normalizedPreferences])).slice(0, 4);
}

export function buildRestaurantQueries(
  preferences: string[],
  foodPreferences: string[] = [],
  destination?: string | null
): string[] {
  const preferenceContext = getRestaurantPreferenceContext(preferences, foodPreferences).join(", ");
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
