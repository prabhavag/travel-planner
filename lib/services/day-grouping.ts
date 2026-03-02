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

const MAX_DAY_HOURS = 8;
const MAX_OPTIMIZATION_PASSES = 4;
const SLOT_CAPACITY_HOURS: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> = {
  morning: 4,
  afternoon: 4,
  evening: 3,
};

const COST_WEIGHTS = {
  overflow: 50,
  overflowQuadratic: 8,
  commute: 1.2,
  variety: 3,
  slotOverflow: 8,
  balance: 0.7,
  anchorDistance: 1.5,
};

type PreparedActivity = {
  activity: SuggestedActivity;
  durationHours: number;
};

type WorkingDay = {
  activityIds: string[];
  lockedActivityIds: Set<string>;
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

function parseDurationHours(estimatedDuration: string | null | undefined): number {
  if (!estimatedDuration) return 2;
  const text = estimatedDuration.toLowerCase();

  if (text.includes("full day") || text.includes("all day")) return 8;
  if (text.includes("half day")) return 4;

  const numbers = Array.from(text.matchAll(/(\d+(?:\.\d+)?)/g)).map((match) => Number(match[1]));
  if (numbers.length === 0) return 2;

  const hasMinutes = text.includes("min");
  const hasHours = text.includes("hour") || text.includes("hr");
  const isRange = /-|to/.test(text) && numbers.length >= 2;

  let value = isRange ? (numbers[0] + numbers[1]) / 2 : numbers[0];
  if (hasMinutes && !hasHours) value /= 60;

  return Math.max(0.5, Math.min(10, value));
}

function haversineDistanceKm(
  a: { lat: number; lng: number } | null | undefined,
  b: { lat: number; lng: number } | null | undefined
): number {
  if (!a || !b) return 0;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return r * c;
}

function slotDistance(
  a: SuggestedActivity["bestTimeOfDay"],
  b: SuggestedActivity["bestTimeOfDay"]
): number {
  if (a === "any" || b === "any") return 0.8;
  return Math.abs(TIME_ORDER[a] - TIME_ORDER[b]);
}

function activityDistanceProxy(a: SuggestedActivity, b: SuggestedActivity): number {
  const geoDistance = haversineDistanceKm(a.coordinates, b.coordinates);
  if (geoDistance > 0) return geoDistance;

  const slotPenalty = slotDistance(a.bestTimeOfDay, b.bestTimeOfDay) * 1.2;
  const typePenalty = a.type.trim().toLowerCase() === b.type.trim().toLowerCase() ? 0.3 : 1;
  return slotPenalty + typePenalty;
}

function sortActivitiesForDay(
  activities: SuggestedActivity[],
  preparedMap: Map<string, PreparedActivity>
): SuggestedActivity[] {
  return [...activities].sort((a, b) => {
    const timeDelta = TIME_ORDER[a.bestTimeOfDay] - TIME_ORDER[b.bestTimeOfDay];
    if (timeDelta !== 0) return timeDelta;

    const durationDelta = (preparedMap.get(b.id)?.durationHours ?? 0) - (preparedMap.get(a.id)?.durationHours ?? 0);
    if (durationDelta !== 0) return durationDelta;

    return a.name.localeCompare(b.name);
  });
}

function getDayHours(day: WorkingDay, preparedMap: Map<string, PreparedActivity>): number {
  return day.activityIds.reduce((sum, id) => sum + (preparedMap.get(id)?.durationHours ?? 0), 0);
}

function computeDayBaseCost(
  day: WorkingDay,
  preparedMap: Map<string, PreparedActivity>,
  targetHours: number
): number {
  if (day.activityIds.length === 0) {
    return targetHours * COST_WEIGHTS.balance;
  }

  const activities = sortActivitiesForDay(
    day.activityIds
      .map((id) => preparedMap.get(id)?.activity)
      .filter((activity): activity is SuggestedActivity => activity !== undefined),
    preparedMap
  );

  const totalHours = activities.reduce((sum, activity) => sum + (preparedMap.get(activity.id)?.durationHours ?? 0), 0);
  const overflow = Math.max(0, totalHours - MAX_DAY_HOURS);

  let commuteProxy = 0;
  for (let i = 1; i < activities.length; i += 1) {
    commuteProxy += activityDistanceProxy(activities[i - 1], activities[i]);
  }

  const uniqueTypes = new Set(activities.map((activity) => activity.type.trim().toLowerCase())).size;
  const varietyPenalty = activities.length > 1 ? (activities.length - uniqueTypes) / activities.length : 0;

  const slotHours: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
  };
  for (const activity of activities) {
    if (activity.bestTimeOfDay === "any") continue;
    slotHours[activity.bestTimeOfDay] += preparedMap.get(activity.id)?.durationHours ?? 0;
  }

  const slotOverflowPenalty = Object.entries(slotHours).reduce((sum, [slot, hours]) => {
    const capacity = SLOT_CAPACITY_HOURS[slot as keyof typeof SLOT_CAPACITY_HOURS];
    return sum + Math.max(0, hours - capacity);
  }, 0);

  const balancePenalty = Math.abs(totalHours - targetHours);

  return (
    overflow * COST_WEIGHTS.overflow +
    overflow * overflow * COST_WEIGHTS.overflowQuadratic +
    commuteProxy * COST_WEIGHTS.commute +
    varietyPenalty * COST_WEIGHTS.variety +
    slotOverflowPenalty * COST_WEIGHTS.slotOverflow +
    balancePenalty * COST_WEIGHTS.balance
  );
}

function computeAnchorDistancePenalty(
  day: WorkingDay,
  preparedMap: Map<string, PreparedActivity>
): number {
  const anchorIds = day.activityIds.filter((id) => day.lockedActivityIds.has(id));
  if (anchorIds.length === 0) return 0;

  const anchors = anchorIds
    .map((id) => preparedMap.get(id)?.activity)
    .filter((activity): activity is SuggestedActivity => activity !== undefined);

  const nonAnchors = day.activityIds
    .filter((id) => !day.lockedActivityIds.has(id))
    .map((id) => preparedMap.get(id)?.activity)
    .filter((activity): activity is SuggestedActivity => activity !== undefined);

  if (anchors.length === 0 || nonAnchors.length === 0) return 0;

  let penalty = 0;
  for (const nonAnchor of nonAnchors) {
    let minDistance = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      minDistance = Math.min(minDistance, activityDistanceProxy(nonAnchor, anchor));
    }
    penalty += minDistance;
  }
  return penalty * COST_WEIGHTS.anchorDistance;
}

function computeTotalCost(days: WorkingDay[], preparedMap: Map<string, PreparedActivity>): number {
  const allActivityIds = days.flatMap((day) => day.activityIds);
  const totalHours = allActivityIds.reduce((sum, id) => sum + (preparedMap.get(id)?.durationHours ?? 0), 0);
  const targetHours = Math.min(MAX_DAY_HOURS, totalHours / Math.max(1, days.length));

  return days.reduce(
    (sum, day) => sum + computeDayBaseCost(day, preparedMap, targetHours) + computeAnchorDistancePenalty(day, preparedMap),
    0
  );
}

function seededActivitySelection(
  candidates: SuggestedActivity[],
  desiredCount: number
): SuggestedActivity[] {
  if (desiredCount <= 0 || candidates.length === 0) return [];

  const selected: SuggestedActivity[] = [];
  const remaining = [...candidates];

  remaining.sort((a, b) => {
    const timeDelta = TIME_ORDER[a.bestTimeOfDay] - TIME_ORDER[b.bestTimeOfDay];
    if (timeDelta !== 0) return timeDelta;
    return a.name.localeCompare(b.name);
  });

  selected.push(remaining.shift() as SuggestedActivity);

  while (selected.length < desiredCount && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      let minDistance = Number.POSITIVE_INFINITY;
      for (const seed of selected) {
        minDistance = Math.min(minDistance, activityDistanceProxy(candidate, seed));
      }
      const score = minDistance;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function assignActivityToBestDay({
  days,
  activityId,
  preparedMap,
  lockAfterAssign,
}: {
  days: WorkingDay[];
  activityId: string;
  preparedMap: Map<string, PreparedActivity>;
  lockAfterAssign: boolean;
}): void {
  const activityHours = preparedMap.get(activityId)?.durationHours ?? 0;
  const feasibleIndices = days
    .map((day, index) => ({ index, nextHours: getDayHours(day, preparedMap) + activityHours }))
    .filter((entry) => entry.nextHours <= MAX_DAY_HOURS)
    .map((entry) => entry.index);
  const candidateIndices = feasibleIndices.length > 0 ? feasibleIndices : days.map((_, index) => index);

  let bestIndex = candidateIndices[0] ?? 0;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const index of candidateIndices) {
    const clone = days.map((day) => ({
      activityIds: [...day.activityIds],
      lockedActivityIds: new Set(day.lockedActivityIds),
    }));
    clone[index].activityIds.push(activityId);
    if (lockAfterAssign) clone[index].lockedActivityIds.add(activityId);

    const cost = computeTotalCost(clone, preparedMap);
    if (cost < bestCost) {
      bestCost = cost;
      bestIndex = index;
    }
  }

  days[bestIndex].activityIds.push(activityId);
  if (lockAfterAssign) days[bestIndex].lockedActivityIds.add(activityId);
}

function optimizeByMovesAndSwaps(days: WorkingDay[], preparedMap: Map<string, PreparedActivity>): void {
  const canMove = (day: WorkingDay, activityId: string) => !day.lockedActivityIds.has(activityId);

  for (let pass = 0; pass < MAX_OPTIMIZATION_PASSES; pass += 1) {
    let improved = false;

    for (let i = 0; i < days.length; i += 1) {
      for (const activityId of [...days[i].activityIds]) {
        if (!canMove(days[i], activityId)) continue;

        let currentBestCost = computeTotalCost(days, preparedMap);
        let bestMoveTarget = -1;

        for (let j = 0; j < days.length; j += 1) {
          if (j === i) continue;

          const candidate = days.map((day) => ({
            activityIds: [...day.activityIds],
            lockedActivityIds: new Set(day.lockedActivityIds),
          }));

          candidate[i].activityIds = candidate[i].activityIds.filter((id) => id !== activityId);
          candidate[j].activityIds.push(activityId);

          const cost = computeTotalCost(candidate, preparedMap);
          if (cost + 1e-6 < currentBestCost) {
            currentBestCost = cost;
            bestMoveTarget = j;
          }
        }

        if (bestMoveTarget >= 0) {
          days[i].activityIds = days[i].activityIds.filter((id) => id !== activityId);
          days[bestMoveTarget].activityIds.push(activityId);
          improved = true;
        }
      }
    }

    for (let i = 0; i < days.length; i += 1) {
      for (let j = i + 1; j < days.length; j += 1) {
        for (const leftId of [...days[i].activityIds]) {
          if (!canMove(days[i], leftId)) continue;

          for (const rightId of [...days[j].activityIds]) {
            if (!canMove(days[j], rightId)) continue;

            const currentCost = computeTotalCost(days, preparedMap);
            const candidate = days.map((day) => ({
              activityIds: [...day.activityIds],
              lockedActivityIds: new Set(day.lockedActivityIds),
            }));

            candidate[i].activityIds = candidate[i].activityIds.filter((id) => id !== leftId);
            candidate[j].activityIds = candidate[j].activityIds.filter((id) => id !== rightId);
            candidate[i].activityIds.push(rightId);
            candidate[j].activityIds.push(leftId);

            const swappedCost = computeTotalCost(candidate, preparedMap);
            if (swappedCost + 1e-6 < currentCost) {
              days[i].activityIds = days[i].activityIds.filter((id) => id !== leftId);
              days[j].activityIds = days[j].activityIds.filter((id) => id !== rightId);
              days[i].activityIds.push(rightId);
              days[j].activityIds.push(leftId);
              improved = true;
            }
          }
        }
      }
    }

    if (!improved) break;
  }
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
  const preparedMap = new Map<string, PreparedActivity>(
    activities.map((activity) => [
      activity.id,
      {
        activity,
        durationHours: parseDurationHours(activity.estimatedDuration),
      },
    ])
  );

  const days: WorkingDay[] = Array.from({ length: dayCount }, () => ({
    activityIds: [],
    lockedActivityIds: new Set<string>(),
  }));

  const anchorActivities = activities.filter((activity) => activity.bestTimeOfDay !== "any");
  const fallbackActivities = anchorActivities.length > 0 ? activities.filter((a) => a.bestTimeOfDay === "any") : activities;

  const anchorSeeds = seededActivitySelection(anchorActivities, Math.min(dayCount, anchorActivities.length));
  const selectedSeedIds = new Set(anchorSeeds.map((activity) => activity.id));

  for (let i = 0; i < anchorSeeds.length; i += 1) {
    const seed = anchorSeeds[i];
    days[i].activityIds.push(seed.id);
    days[i].lockedActivityIds.add(seed.id);
  }

  if (anchorSeeds.length < dayCount) {
    const extraSeeds = seededActivitySelection(
      fallbackActivities.filter((activity) => !selectedSeedIds.has(activity.id)),
      dayCount - anchorSeeds.length
    );
    for (let i = 0; i < extraSeeds.length; i += 1) {
      const seed = extraSeeds[i];
      days[anchorSeeds.length + i].activityIds.push(seed.id);
      selectedSeedIds.add(seed.id);
    }
  }

  const remainingAnchors = anchorActivities
    .filter((activity) => !selectedSeedIds.has(activity.id))
    .sort((a, b) => {
      const durationDelta = (preparedMap.get(b.id)?.durationHours ?? 0) - (preparedMap.get(a.id)?.durationHours ?? 0);
      if (durationDelta !== 0) return durationDelta;
      return a.name.localeCompare(b.name);
    });

  for (const anchor of remainingAnchors) {
    assignActivityToBestDay({
      days,
      activityId: anchor.id,
      preparedMap,
      lockAfterAssign: true,
    });
  }

  const remainingFlex = activities
    .filter((activity) => !selectedSeedIds.has(activity.id) && !days.some((day) => day.activityIds.includes(activity.id)))
    .sort((a, b) => {
      const durationDelta = (preparedMap.get(b.id)?.durationHours ?? 0) - (preparedMap.get(a.id)?.durationHours ?? 0);
      if (durationDelta !== 0) return durationDelta;
      const timeDelta = TIME_ORDER[a.bestTimeOfDay] - TIME_ORDER[b.bestTimeOfDay];
      if (timeDelta !== 0) return timeDelta;
      return a.name.localeCompare(b.name);
    });

  for (const activity of remainingFlex) {
    assignActivityToBestDay({
      days,
      activityId: activity.id,
      preparedMap,
      lockAfterAssign: false,
    });
  }

  optimizeByMovesAndSwaps(days, preparedMap);

  const buckets = days.map((day) =>
    sortActivitiesForDay(
      day.activityIds
        .map((id) => preparedMap.get(id)?.activity)
        .filter((activity): activity is SuggestedActivity => activity !== undefined),
      preparedMap
    )
  );

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
