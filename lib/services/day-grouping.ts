import type {
  DayGroup,
  GroupedDay,
  SuggestedActivity,
  TripInfo,
} from "@/lib/models/travel-plan";

const TIME_ORDER: Record<SuggestedActivity["bestTimeOfDay"], number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  any: 3,
};

const TYPE_THEME_MAP: Record<string, string> = {
  museum: "Culture",
  landmark: "Landmarks",
  park: "Outdoors",
  viewpoint: "Views",
  market: "Local Life",
  experience: "Adventures",
  neighborhood: "Local Life",
  beach: "Coast",
  temple: "Heritage",
  gallery: "Art",
  hiking: "Outdoors",
  food: "Local Flavors",
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function computeDayCount(tripInfo: TripInfo, activityCount: number): number {
  const directDuration = tripInfo.durationDays;
  if (typeof directDuration === "number" && directDuration > 0) {
    return Math.max(1, Math.min(30, directDuration));
  }

  const start = parseDate(tripInfo.startDate);
  const end = parseDate(tripInfo.endDate);
  if (start && end) {
    const diffMs = end.getTime() - start.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
    if (days > 0) return Math.max(1, Math.min(30, days));
  }

  if (activityCount <= 0) return 1;
  return Math.max(1, Math.min(7, activityCount));
}

function buildTripDates(tripInfo: TripInfo, dayCount: number): string[] {
  const start = parseDate(tripInfo.startDate) ?? new Date();
  const dates: string[] = [];

  for (let i = 0; i < dayCount; i += 1) {
    const next = new Date(start);
    next.setDate(start.getDate() + i);
    dates.push(toIsoDate(next));
  }

  return dates;
}

function normalizeType(type: string): string {
  const normalized = type.trim().toLowerCase();
  return TYPE_THEME_MAP[normalized] ?? "Highlights";
}

export function generateDayTheme(activities: SuggestedActivity[]): string {
  if (!activities.length) return "Flexible Exploration Day";

  const counts = new Map<string, number>();
  for (const activity of activities) {
    const category = normalizeType(activity.type);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const topCategories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([category]) => category);

  if (topCategories.length === 1) {
    return `${topCategories[0]} Highlights`;
  }

  return `${topCategories[0]} & ${topCategories[1]}`;
}

export function groupActivitiesByDay({
  tripInfo,
  activities,
}: {
  tripInfo: TripInfo;
  activities: SuggestedActivity[];
}): DayGroup[] {
  const dayCount = computeDayCount(tripInfo, activities.length);
  const dates = buildTripDates(tripInfo, dayCount);
  const buckets: SuggestedActivity[][] = Array.from({ length: dayCount }, () => []);

  const ordered = [...activities].sort((a, b) => {
    const timeDelta = TIME_ORDER[a.bestTimeOfDay] - TIME_ORDER[b.bestTimeOfDay];
    if (timeDelta !== 0) return timeDelta;
    return a.name.localeCompare(b.name);
  });

  ordered.forEach((activity, index) => {
    buckets[index % dayCount].push(activity);
  });

  for (const bucket of buckets) {
    bucket.sort((a, b) => {
      const timeDelta = TIME_ORDER[a.bestTimeOfDay] - TIME_ORDER[b.bestTimeOfDay];
      if (timeDelta !== 0) return timeDelta;
      return a.name.localeCompare(b.name);
    });
  }

  return buckets.map((bucket, index) => ({
    dayNumber: index + 1,
    date: dates[index],
    theme: generateDayTheme(bucket),
    activityIds: bucket.map((activity) => activity.id),
  }));
}

export function buildGroupedDays({
  dayGroups,
  activities,
}: {
  dayGroups: DayGroup[];
  activities: SuggestedActivity[];
}): GroupedDay[] {
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));

  return dayGroups.map((group) => ({
    dayNumber: group.dayNumber,
    date: group.date,
    theme: group.theme,
    activities: group.activityIds
      .map((activityId) => activityMap.get(activityId))
      .filter((activity): activity is SuggestedActivity => activity !== undefined),
    restaurants: [],
  }));
}
