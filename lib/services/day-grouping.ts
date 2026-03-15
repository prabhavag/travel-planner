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
  commuteImbalance: 1.2,
  variety: 3,
  slotOverflow: 8,
  slotMismatch: 5,
  balance: 0.7,
  fullDayNearbyOverflowRelief: 9,
  fullDayFarPenalty: 3,
};

type PreparedActivity = {
  activity: SuggestedActivity;
  durationHours: number;
  isFullDay: boolean;
};

type WorkingDay = {
  activityIds: string[];
};

type DayBucket = {
  activities: SuggestedActivity[];
  originalIndex: number;
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

function isFullDayDuration(estimatedDuration: string | null | undefined, durationHours: number): boolean {
  if (!estimatedDuration) return durationHours >= MAX_DAY_HOURS;
  const text = estimatedDuration.toLowerCase();
  return text.includes("full day") || text.includes("all day") || durationHours >= MAX_DAY_HOURS;
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

function listActivityDistancePoints(activity: SuggestedActivity): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  const seen = new Set<string>();

  const addPoint = (point: { lat: number; lng: number } | null | undefined) => {
    if (!point) return;
    const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push(point);
  };

  addPoint(activity.coordinates);
  addPoint(activity.startCoordinates);
  addPoint(activity.endCoordinates);

  for (const waypoint of activity.routeWaypoints ?? []) {
    addPoint(waypoint.coordinates);
  }

  for (const point of activity.routePoints ?? []) {
    addPoint(point);
  }

  return points;
}

function computeDayCentroid(activities: SuggestedActivity[]): { lat: number; lng: number } | null {
  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  for (const activity of activities) {
    for (const point of listActivityDistancePoints(activity)) {
      sumLat += point.lat;
      sumLng += point.lng;
      count += 1;
    }
  }

  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count };
}

export function computeActivitiesCentroid(
  activities: SuggestedActivity[]
): { lat: number; lng: number } | null {
  return computeDayCentroid(activities);
}

function orderDayBucketsByProximity(buckets: DayBucket[]): DayBucket[] {
  if (buckets.length <= 2) return [...buckets].sort((a, b) => a.originalIndex - b.originalIndex);

  const withCentroids = buckets.map((bucket) => ({
    ...bucket,
    centroid: computeDayCentroid(bucket.activities),
  }));

  const centroidDays = withCentroids.filter((bucket) => bucket.centroid !== null);
  if (centroidDays.length <= 1) {
    return [...withCentroids].sort((a, b) => a.originalIndex - b.originalIndex);
  }

  centroidDays.sort((a, b) => a.originalIndex - b.originalIndex);
  const used = new Set<number>();
  const ordered: typeof centroidDays = [];

  ordered.push(centroidDays[0]);
  used.add(centroidDays[0].originalIndex);

  while (ordered.length < centroidDays.length) {
    const current = ordered[ordered.length - 1];
    let bestCandidate: typeof centroidDays[number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of centroidDays) {
      if (used.has(candidate.originalIndex)) continue;
      const distance = haversineDistanceKm(current.centroid, candidate.centroid);
      if (distance < bestDistance - 1e-6) {
        bestDistance = distance;
        bestCandidate = candidate;
      } else if (Math.abs(distance - bestDistance) <= 1e-6 && bestCandidate) {
        if (candidate.originalIndex < bestCandidate.originalIndex) {
          bestCandidate = candidate;
        }
      }
    }

    if (!bestCandidate) break;
    ordered.push(bestCandidate);
    used.add(bestCandidate.originalIndex);
  }

  if (ordered.length < centroidDays.length) {
    const remaining = centroidDays.filter((bucket) => !used.has(bucket.originalIndex));
    remaining.sort((a, b) => a.originalIndex - b.originalIndex);
    ordered.push(...remaining);
  }

  const slots: Array<typeof withCentroids[number] | null> = Array.from({ length: buckets.length }, () => null);
  for (const bucket of withCentroids) {
    if (bucket.centroid === null) {
      slots[bucket.originalIndex] = bucket;
    }
  }

  let orderedIndex = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (!slots[i]) {
      slots[i] = ordered[orderedIndex] ?? null;
      orderedIndex += 1;
    }
  }

  return slots.filter((bucket): bucket is typeof withCentroids[number] => bucket !== null);
}

function slotDistance(
  a: SuggestedActivity["bestTimeOfDay"],
  b: SuggestedActivity["bestTimeOfDay"]
): number {
  if (a === "any" || b === "any") return 0.8;
  return Math.abs(TIME_ORDER[a] - TIME_ORDER[b]);
}

const distanceCache = new Map<string, number>();

function activityDistanceProxy(a: SuggestedActivity, b: SuggestedActivity): number {
  if (a.id === b.id) return 0;
  const cacheKey = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
  const cached = distanceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pointsA = listActivityDistancePoints(a);
  const pointsB = listActivityDistancePoints(b);

  let result: number | undefined;

  if (pointsA.length > 0 && pointsB.length > 0) {
    let minDistance = Number.POSITIVE_INFINITY;
    for (const pointA of pointsA) {
      for (const pointB of pointsB) {
        minDistance = Math.min(minDistance, haversineDistanceKm(pointA, pointB));
      }
    }
    if (Number.isFinite(minDistance)) {
      result = minDistance;
    }
  }

  if (result === undefined) {
    const slotPenalty = slotDistance(a.bestTimeOfDay, b.bestTimeOfDay) * 1.2;
    const typePenalty = a.type.trim().toLowerCase() === b.type.trim().toLowerCase() ? 0.3 : 1;
    result = slotPenalty + typePenalty;
  }

  distanceCache.set(cacheKey, result);
  return result;
}

function getPermutations<T>(array: T[]): T[][] {
  if (array.length <= 1) return [array];
  const result: T[][] = [];
  for (let i = 0; i < array.length; i++) {
    const current = array[i];
    const remaining = [...array.slice(0, i), ...array.slice(i + 1)];
    const perms = getPermutations(remaining);
    for (const perm of perms) {
      result.push([current, ...perm]);
    }
  }
  return result;
}

function buildOptimalDayRoute(
  activities: SuggestedActivity[],
  preparedMap: Map<string, PreparedActivity>
): SuggestedActivity[] {
  if (activities.length <= 1) return [...activities];

  if (activities.length <= 6) {
    const perms = getPermutations(activities);
    let bestCost = Number.POSITIVE_INFINITY;
    let bestRoute = [...activities];

    for (const route of perms) {
      let cost = 0;
      let currentHour = 0;

      for (let i = 0; i < route.length; i++) {
        const activity = route[i];

        if (i > 0) {
          cost += activityDistanceProxy(route[i - 1], activity) * COST_WEIGHTS.commute;
        }

        const duration = preparedMap.get(activity.id)?.durationHours ?? 0;
        const midHour = currentHour + duration / 2;
        const assignedSlot = slotForHour(midHour);
        if (activity.bestTimeOfDay !== "any") {
          cost += slotDistance(activity.bestTimeOfDay, assignedSlot) * duration * COST_WEIGHTS.slotMismatch;
        }

        currentHour += duration;
      }

      let tieBreaker = 0;
      for (let i = 0; i < route.length; i++) {
        tieBreaker += (TIME_ORDER[route[i].bestTimeOfDay] || 0) * 1e-4 * i;
      }

      const totalCost = cost + tieBreaker;

      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestRoute = route;
      }
    }
    return bestRoute;
  }

  let bestOrder: SuggestedActivity[] = [...activities];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let startIndex = 0; startIndex < activities.length; startIndex += 1) {
    const used = new Set<string>();
    const ordered: SuggestedActivity[] = [];
    let current = activities[startIndex];
    ordered.push(current);
    used.add(current.id);

    while (ordered.length < activities.length) {
      let bestNext: SuggestedActivity | null = null;
      let bestNextDistance = Number.POSITIVE_INFINITY;

      for (const candidate of activities) {
        if (used.has(candidate.id)) continue;
        const distance = activityDistanceProxy(current, candidate);
        if (distance < bestNextDistance) {
          bestNextDistance = distance;
          bestNext = candidate;
        }
      }

      if (!bestNext) break;
      ordered.push(bestNext);
      used.add(bestNext.id);
      current = bestNext;
    }

    let totalDistance = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      totalDistance += activityDistanceProxy(ordered[i - 1], ordered[i]);
    }

    if (totalDistance < bestDistance) {
      bestDistance = totalDistance;
      bestOrder = ordered;
    }
  }

  return bestOrder;
}

function slotForHour(hour: number): Exclude<SuggestedActivity["bestTimeOfDay"], "any"> {
  if (hour < 4) return "morning";
  if (hour < 8) return "afternoon";
  return "evening";
}

function computeDayCommuteProxy(
  day: WorkingDay,
  preparedMap: Map<string, PreparedActivity>
): number {
  const activities = buildOptimalDayRoute(
    day.activityIds
      .map((id) => preparedMap.get(id)?.activity)
      .filter((activity): activity is SuggestedActivity => activity !== undefined),
    preparedMap
  );

  let commuteProxy = 0;
  for (let i = 1; i < activities.length; i += 1) {
    commuteProxy += activityDistanceProxy(activities[i - 1], activities[i]);
  }
  return commuteProxy;
}

function computeDayBaseCost(
  day: WorkingDay,
  preparedMap: Map<string, PreparedActivity>,
  targetHours: number
): number {
  if (day.activityIds.length === 0) {
    return targetHours * COST_WEIGHTS.balance;
  }

  const activities = buildOptimalDayRoute(
    day.activityIds
      .map((id) => preparedMap.get(id)?.activity)
      .filter((activity): activity is SuggestedActivity => activity !== undefined),
    preparedMap
  );

  const totalHours = activities.reduce((sum, activity) => sum + (preparedMap.get(activity.id)?.durationHours ?? 0), 0);
  const overflow = Math.max(0, totalHours - MAX_DAY_HOURS);

  const commuteProxy = computeDayCommuteProxy(day, preparedMap);

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

  let slotMismatchPenalty = 0;
  let currentHour = 0;
  for (const activity of activities) {
    const duration = preparedMap.get(activity.id)?.durationHours ?? 0;
    const midHour = currentHour + duration / 2;
    const assignedSlot = slotForHour(midHour);
    if (activity.bestTimeOfDay !== "any") {
      slotMismatchPenalty += slotDistance(activity.bestTimeOfDay, assignedSlot) * duration;
    }
    currentHour += duration;
  }

  const balancePenalty = Math.abs(totalHours - targetHours);

  const fullDayActivities = activities.filter((activity) => preparedMap.get(activity.id)?.isFullDay);
  let overflowPenalty = overflow * COST_WEIGHTS.overflow + overflow * overflow * COST_WEIGHTS.overflowQuadratic;
  let fullDayFitPenalty = 0;

  if (fullDayActivities.length > 0) {
    let nearbyWeightedHours = 0;
    let farWeightedHours = 0;

    for (const activity of activities) {
      if (preparedMap.get(activity.id)?.isFullDay) continue;

      const duration = preparedMap.get(activity.id)?.durationHours ?? 0;
      let minDistance = Number.POSITIVE_INFINITY;
      for (const fullDayActivity of fullDayActivities) {
        minDistance = Math.min(minDistance, activityDistanceProxy(activity, fullDayActivity));
      }

      // Smooth proximity score in [0, 1]: closer activities get more "same full-day cluster" credit.
      const proximityScore = 1 / (1 + minDistance);
      nearbyWeightedHours += duration * proximityScore;
      farWeightedHours += duration * (1 - proximityScore);
    }

    overflowPenalty = Math.max(
      0,
      overflowPenalty - nearbyWeightedHours * COST_WEIGHTS.fullDayNearbyOverflowRelief
    );
    fullDayFitPenalty = farWeightedHours * COST_WEIGHTS.fullDayFarPenalty;
  }

  return (
    overflowPenalty +
    commuteProxy * COST_WEIGHTS.commute +
    varietyPenalty * COST_WEIGHTS.variety +
    slotOverflowPenalty * COST_WEIGHTS.slotOverflow +
    slotMismatchPenalty * COST_WEIGHTS.slotMismatch +
    balancePenalty * COST_WEIGHTS.balance +
    fullDayFitPenalty
  );
}

function computeTotalCost(days: WorkingDay[], preparedMap: Map<string, PreparedActivity>): number {
  const allActivityIds = days.flatMap((day) => day.activityIds);
  const totalHours = allActivityIds.reduce((sum, id) => sum + (preparedMap.get(id)?.durationHours ?? 0), 0);
  const targetHours = Math.min(MAX_DAY_HOURS, totalHours / Math.max(1, days.length));

  const baseCost = days.reduce(
    (sum, day) => sum + computeDayBaseCost(day, preparedMap, targetHours),
    0
  );

  const dayCommutes = days.map((day) => computeDayCommuteProxy(day, preparedMap));
  const totalCommute = dayCommutes.reduce((sum, value) => sum + value, 0);
  const avgCommute = totalCommute / Math.max(1, dayCommutes.length);
  const maxCommute = dayCommutes.reduce((max, value) => Math.max(max, value), 0);
  const commuteImbalancePenalty = Math.max(0, maxCommute - avgCommute) * COST_WEIGHTS.commuteImbalance;

  return baseCost + commuteImbalancePenalty;
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
}: {
  days: WorkingDay[];
  activityId: string;
  preparedMap: Map<string, PreparedActivity>;
}): void {
  const candidateIndices = days.map((_, index) => index);

  let bestIndex = candidateIndices[0] ?? 0;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const index of candidateIndices) {
    const clone = days.map((day) => ({
      activityIds: [...day.activityIds],
    }));
    clone[index].activityIds.push(activityId);

    const cost = computeTotalCost(clone, preparedMap);
    if (cost < bestCost) {
      bestCost = cost;
      bestIndex = index;
    }
  }

  days[bestIndex].activityIds.push(activityId);
}

function optimizeByMovesAndSwaps(days: WorkingDay[], preparedMap: Map<string, PreparedActivity>): void {
  for (let pass = 0; pass < MAX_OPTIMIZATION_PASSES; pass += 1) {
    let improved = false;

    for (let i = 0; i < days.length; i += 1) {
      for (const activityId of [...days[i].activityIds]) {
        let currentBestCost = computeTotalCost(days, preparedMap);
        let bestMoveTarget = -1;

        for (let j = 0; j < days.length; j += 1) {
          if (j === i) continue;

          const candidate = days.map((day) => ({
            activityIds: [...day.activityIds],
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
          for (const rightId of [...days[j].activityIds]) {
            const currentCost = computeTotalCost(days, preparedMap);
            const candidate = days.map((day) => ({
              activityIds: [...day.activityIds],
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
  distanceCache.clear();
  const dayCount = computeDayCount(tripInfo, activities.length);
  const dates = buildTripDates(tripInfo, dayCount);
  const preparedMap = new Map<string, PreparedActivity>(
    activities.map((activity) => {
      const durationHours = parseDurationHours(activity.estimatedDuration);
      return [
        activity.id,
        {
          activity,
          durationHours,
          isFullDay: isFullDayDuration(activity.estimatedDuration, durationHours),
        },
      ];
    })
  );

  const days: WorkingDay[] = Array.from({ length: dayCount }, () => ({
    activityIds: [],
  }));

  const anchorActivities = activities.filter((activity) => activity.bestTimeOfDay !== "any");
  const fallbackActivities = anchorActivities.length > 0 ? activities.filter((a) => a.bestTimeOfDay === "any") : activities;

  const anchorSeeds = seededActivitySelection(anchorActivities, Math.min(dayCount, anchorActivities.length));
  const selectedSeedIds = new Set(anchorSeeds.map((activity) => activity.id));

  for (let i = 0; i < anchorSeeds.length; i += 1) {
    const seed = anchorSeeds[i];
    days[i].activityIds.push(seed.id);
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
    });
  }

  optimizeByMovesAndSwaps(days, preparedMap);

  const buckets = days.map((day) =>
    buildOptimalDayRoute(
      day.activityIds
        .map((id) => preparedMap.get(id)?.activity)
        .filter((activity): activity is SuggestedActivity => activity !== undefined),
      preparedMap
    )
  );

  const orderedBuckets = orderDayBucketsByProximity(
    buckets.map((bucket, index) => ({
      activities: bucket,
      originalIndex: index,
    }))
  );

  return orderedBuckets.map((bucket, index) => ({
    dayNumber: index + 1,
    date: dates[index],
    theme: generateDayTheme(bucket.activities),
    activityIds: bucket.activities.map((activity) => activity.id),
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
    nightStay: group.nightStay ?? null,
  }));
}
