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
const EARLY_FIXED_ACTIVITY_LOAD_FACTOR = 0.7;
const EARLY_FIXED_ACTIVITY_CUTOFF_MINUTES = 7 * 60;
const SLOT_CAPACITY_HOURS: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> = {
  morning: 4,
  afternoon: 4,
  evening: 3,
};
const SOFT_DAY_START_MINUTES = 9 * 60 + 30;

const COST_WEIGHTS = {
  overflow: 50,
  overflowQuadratic: 8,
  commute: 0.25,
  commuteImbalance: 0.15,
  longLeg: 1.6,
  spread: 0.8,
  variety: 3,
  slotOverflow: 8,
  slotMismatch: 5,
  recommendedStartMiss: 7,
  balance: 0.7,
  fullDayNearbyOverflowRelief: 9,
  fullDayFarPenalty: 3,
  nearbySplit: 6,
};

const NEARBY_CLUSTER_MAX_COMMUTE_MINUTES = 40;
const NEARBY_CLUSTER_SQUEEZE_HOURS = 1.25;

type PreparedActivity = {
  activity: SuggestedActivity;
  durationHours: number;
  loadDurationHours: number;
  isFullDay: boolean;
};

type WorkingDay = {
  activityIds: string[];
};

type DayCapacityProfile = {
  maxHours: number;
  slotCapacity: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number>;
  targetWeight: number;
};

type DayBucket = {
  activities: SuggestedActivity[];
  originalIndex: number;
};

type Coordinate = { lat: number; lng: number };
type ActivityCommuteMatrix = Map<string, number>;

const ROUTE_MATRIX_API_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTE_MATRIX_MAX_LOCATIONS = 25;

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

function cloneDefaultSlotCapacity(): Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> {
  return {
    morning: SLOT_CAPACITY_HOURS.morning,
    afternoon: SLOT_CAPACITY_HOURS.afternoon,
    evening: SLOT_CAPACITY_HOURS.evening,
  };
}

export function parseClockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  const amPmMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]) % 12;
    const minute = Number(amPmMatch[2] || "0");
    if (amPmMatch[3].toUpperCase() === "PM") hour += 12;
    if (minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  const twentyFourMatch = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourMatch) {
    return Number(twentyFourMatch[1]) * 60 + Number(twentyFourMatch[2]);
  }

  return null;
}

function buildDayCapacityProfiles(tripInfo: TripInfo, dayCount: number): DayCapacityProfile[] {
  const capacities: DayCapacityProfile[] = Array.from({ length: dayCount }, () => ({
    maxHours: MAX_DAY_HOURS,
    slotCapacity: cloneDefaultSlotCapacity(),
    targetWeight: 1,
  }));

  if (dayCount === 0) return capacities;

  const first = capacities[0];
  if (first) {
    const arrivalMinutes = parseClockMinutes(tripInfo.arrivalTimePreference) ?? 12 * 60;
    if (arrivalMinutes < 11 * 60) {
      first.maxHours = Math.min(first.maxHours, 7);
      first.slotCapacity.morning = Math.min(first.slotCapacity.morning, 3);
      first.targetWeight = Math.min(first.targetWeight, 0.9);
    } else if (arrivalMinutes < 15 * 60) {
      first.maxHours = Math.min(first.maxHours, 5.5);
      first.slotCapacity.morning = Math.min(first.slotCapacity.morning, 0.5);
      first.slotCapacity.afternoon = Math.min(first.slotCapacity.afternoon, 3);
      first.targetWeight = Math.min(first.targetWeight, 0.72);
    } else if (arrivalMinutes < 18 * 60) {
      first.maxHours = Math.min(first.maxHours, 4);
      first.slotCapacity.morning = 0;
      first.slotCapacity.afternoon = Math.min(first.slotCapacity.afternoon, 2);
      first.slotCapacity.evening = Math.min(first.slotCapacity.evening, 2.5);
      first.targetWeight = Math.min(first.targetWeight, 0.58);
    } else {
      first.maxHours = Math.min(first.maxHours, 3);
      first.slotCapacity.morning = 0;
      first.slotCapacity.afternoon = Math.min(first.slotCapacity.afternoon, 0.5);
      first.slotCapacity.evening = Math.min(first.slotCapacity.evening, 2.5);
      first.targetWeight = Math.min(first.targetWeight, 0.45);
    }
  }

  const last = capacities[capacities.length - 1];
  if (last) {
    const departureMinutes = parseClockMinutes(tripInfo.departureTimePreference) ?? 18 * 60;
    if (departureMinutes <= 11 * 60) {
      last.maxHours = Math.min(last.maxHours, 3.5);
      last.slotCapacity.morning = Math.min(last.slotCapacity.morning, 1.5);
      last.slotCapacity.afternoon = Math.min(last.slotCapacity.afternoon, 1);
      last.slotCapacity.evening = Math.min(last.slotCapacity.evening, 0.25);
      last.targetWeight = Math.min(last.targetWeight, 0.52);
    } else if (departureMinutes <= 15 * 60) {
      last.maxHours = Math.min(last.maxHours, 5);
      last.slotCapacity.morning = Math.min(last.slotCapacity.morning, 2.5);
      last.slotCapacity.afternoon = Math.min(last.slotCapacity.afternoon, 2.5);
      last.slotCapacity.evening = Math.min(last.slotCapacity.evening, 1);
      last.targetWeight = Math.min(last.targetWeight, 0.7);
    } else if (departureMinutes <= 19 * 60) {
      last.maxHours = Math.min(last.maxHours, 6.5);
      last.slotCapacity.morning = Math.min(last.slotCapacity.morning, 3);
      last.slotCapacity.afternoon = Math.min(last.slotCapacity.afternoon, 3);
      last.slotCapacity.evening = Math.min(last.slotCapacity.evening, 2);
      last.targetWeight = Math.min(last.targetWeight, 0.85);
    } else {
      last.maxHours = Math.min(last.maxHours, 7.25);
      last.slotCapacity.morning = Math.min(last.slotCapacity.morning, 3.5);
      last.slotCapacity.afternoon = Math.min(last.slotCapacity.afternoon, 3.5);
      last.slotCapacity.evening = Math.min(last.slotCapacity.evening, 2.5);
      last.targetWeight = Math.min(last.targetWeight, 0.92);
    }
  }

  return capacities.map((profile) => ({
    ...profile,
    maxHours: Math.max(1.5, Math.min(MAX_DAY_HOURS, profile.maxHours)),
    targetWeight: Math.max(0.2, profile.targetWeight),
    slotCapacity: {
      morning: Math.max(0, profile.slotCapacity.morning),
      afternoon: Math.max(0, profile.slotCapacity.afternoon),
      evening: Math.max(0, profile.slotCapacity.evening),
    },
  }));
}

function normalizeType(type: string): string {
  const normalized = type.trim().toLowerCase();
  return TYPE_THEME_MAP[normalized] ?? "Highlights";
}

export function parseDurationHours(estimatedDuration: string | null | undefined): number {
  if (!estimatedDuration) return 2;
  const text = estimatedDuration.toLowerCase();

  if (text.includes("full day") || text.includes("all day")) return 8;
  if (text.includes("half day")) return 4;

  const numbers = Array.from(text.matchAll(/(\d+(?:\.\d+)?)/g)).map((match) => Number(match[1]));
  if (numbers.length === 0) return 2;

  const hasMinutes = text.includes("min");
  const hasHours = text.includes("hour") || text.includes("hr");
  const isRange = /-|to/.test(text) && numbers.length >= 2;

  if (isRange) {
    let value = (numbers[0] + numbers[1]) / 2;
    if (hasMinutes && !hasHours) value /= 60;
    return Math.max(0.5, Math.min(10, value));
  }

  // Improved: sum hours and minutes if both are present
  // e.g. "1 hour 30 mins"
  if (hasHours && hasMinutes && numbers.length >= 2) {
    return Math.max(0.5, Math.min(10, numbers[0] + numbers[1] / 60));
  }

  let value = numbers[0];
  if (hasMinutes && !hasHours) value /= 60;

  return Math.max(0.5, Math.min(10, value));
}

export function parseFixedStartTimeMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text === "sunrise") return 6 * 60;
  if (text === "sunset") return 18 * 60;

  const meridiemMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1]) % 12;
    const minute = Number(meridiemMatch[2] || "0");
    if (meridiemMatch[3].toLowerCase() === "pm") hour += 12;
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return hour * 60 + minute;
  }

  const twentyFourMatch = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourMatch) {
    const hour = Number(twentyFourMatch[1]);
    const minute = Number(twentyFourMatch[2]);
    return hour * 60 + minute;
  }

  return null;
}

function recommendedWindowLatestStartMinutes(activity: SuggestedActivity): number | null {
  return parseFixedStartTimeMinutes(activity.recommendedStartWindow?.end || null);
}

function activityLoadFactor(activity: SuggestedActivity): number {
  if (!activity.isFixedStartTime) return 1;
  const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime || null);
  if (fixedStartMinutes != null && fixedStartMinutes <= EARLY_FIXED_ACTIVITY_CUTOFF_MINUTES) {
    return EARLY_FIXED_ACTIVITY_LOAD_FACTOR;
  }
  if ((activity.fixedStartTime || "").toLowerCase() === "sunrise") {
    return EARLY_FIXED_ACTIVITY_LOAD_FACTOR;
  }
  if (fixedStartMinutes == null && activity.bestTimeOfDay === "morning") {
    return EARLY_FIXED_ACTIVITY_LOAD_FACTOR;
  }
  return 1;
}

function isFullDayDuration(estimatedDuration: string | null | undefined, durationHours: number): boolean {
  if (!estimatedDuration) return durationHours >= MAX_DAY_HOURS;
  const text = estimatedDuration.toLowerCase();
  return text.includes("full day") || text.includes("all day") || durationHours >= MAX_DAY_HOURS;
}

function getLoadDurationHours(preparedMap: Map<string, PreparedActivity>, activityId: string): number {
  return preparedMap.get(activityId)?.loadDurationHours ?? 0;
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

function getRoutesApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || null;
}

function parseRouteDurationSeconds(duration?: string): number | null {
  if (!duration) return null;
  const match = duration.match(/^\s*([\d.]+)s\s*$/);
  if (!match) return null;
  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

function estimateDriveMinutesFallback(
  from: Coordinate | null | undefined,
  to: Coordinate | null | undefined
): number {
  if (!from || !to) return 25;
  const distanceKm = haversineDistanceKm(from, to);
  const roadDistanceKm =
    distanceKm < 10
      ? distanceKm * 1.35
      : distanceKm < 30
        ? distanceKm * 1.6
        : distanceKm * 1.75;
  const speedKph =
    distanceKm < 10
      ? 28
      : distanceKm < 30
        ? 20
        : 40;
  return Math.max(10, Math.round((roadDistanceKm / speedKph) * 60));
}

function getActivityRoutingPoint(activity: SuggestedActivity): Coordinate | null {
  if (activity.locationMode === "route") {
    return activity.startCoordinates || activity.coordinates || activity.endCoordinates || null;
  }
  return activity.coordinates || activity.startCoordinates || activity.endCoordinates || null;
}

function activityPairKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

function parseRouteMatrixEntries(rawText: string): Array<Record<string, unknown>> {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const normalized = trimmed.startsWith(")]}'") ? trimmed.slice(4).trim() : trimmed;
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
    }
  } catch {
    // The Route Matrix REST response is often NDJSON.
  }

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

async function computeActivityCommuteMatrix(activities: SuggestedActivity[]): Promise<ActivityCommuteMatrix> {
  const commuteMinutesByPair: ActivityCommuteMatrix = new Map();
  if (activities.length <= 1) {
    return commuteMinutesByPair;
  }

  for (const from of activities) {
    for (const to of activities) {
      if (from.id === to.id) {
        commuteMinutesByPair.set(activityPairKey(from.id, to.id), 0);
      }
    }
  }

  const points = activities.map((activity) => ({
    id: activity.id,
    point: getActivityRoutingPoint(activity),
  }));
  const valid = points.filter((entry): entry is { id: string; point: Coordinate } => entry.point !== null);

  const apiKey = getRoutesApiKey();
  if (apiKey && valid.length > 1) {
    try {
      for (let originStart = 0; originStart < valid.length; originStart += ROUTE_MATRIX_MAX_LOCATIONS) {
        const originChunk = valid.slice(originStart, originStart + ROUTE_MATRIX_MAX_LOCATIONS);
        for (let destinationStart = 0; destinationStart < valid.length; destinationStart += ROUTE_MATRIX_MAX_LOCATIONS) {
          const destinationChunk = valid.slice(destinationStart, destinationStart + ROUTE_MATRIX_MAX_LOCATIONS);
          const body = {
            origins: originChunk.map((origin) => ({
              waypoint: {
                location: {
                  latLng: {
                    latitude: origin.point.lat,
                    longitude: origin.point.lng,
                  },
                },
              },
            })),
            destinations: destinationChunk.map((destination) => ({
              waypoint: {
                location: {
                  latLng: {
                    latitude: destination.point.lat,
                    longitude: destination.point.lng,
                  },
                },
              },
            })),
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_UNAWARE",
            languageCode: "en-US",
          };

          const response = await fetch(ROUTE_MATRIX_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            continue;
          }

          const raw = await response.text();
          const entries = parseRouteMatrixEntries(raw);
          for (const entry of entries) {
            const originIndex = typeof entry.originIndex === "number" ? entry.originIndex : null;
            const destinationIndex = typeof entry.destinationIndex === "number" ? entry.destinationIndex : null;
            if (originIndex == null || destinationIndex == null) continue;
            const origin = originChunk[originIndex];
            const destination = destinationChunk[destinationIndex];
            if (!origin || !destination) continue;

            const durationSeconds = parseRouteDurationSeconds(
              typeof entry.duration === "string" ? entry.duration : undefined
            );
            if (durationSeconds == null) continue;
            commuteMinutesByPair.set(
              activityPairKey(origin.id, destination.id),
              Math.max(5, Math.round(durationSeconds / 60))
            );
          }
        }
      }
    } catch {
      // Ignore matrix errors and fall back to local estimates below.
    }
  }

  for (const from of activities) {
    const fromPoint = getActivityRoutingPoint(from);
    for (const to of activities) {
      if (from.id === to.id) continue;
      const key = activityPairKey(from.id, to.id);
      if (commuteMinutesByPair.has(key)) continue;
      const toPoint = getActivityRoutingPoint(to);
      commuteMinutesByPair.set(key, estimateDriveMinutesFallback(fromPoint, toPoint));
    }
  }

  return commuteMinutesByPair;
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
      sumLat += typeof point.lat === "string" ? parseFloat(point.lat) : point.lat;
      sumLng += typeof point.lng === "string" ? parseFloat(point.lng) : point.lng;
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

  let bestOrdered: typeof centroidDays = [];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let startIdx = 0; startIdx < centroidDays.length; startIdx += 1) {
    const used = new Set<number>();
    const ordered: typeof centroidDays = [];

    ordered.push(centroidDays[startIdx]);
    used.add(centroidDays[startIdx].originalIndex);

    while (ordered.length < centroidDays.length) {
      const current = ordered[ordered.length - 1];
      let bestCandidate: typeof centroidDays[number] | null = null;
      let minDistance = Number.POSITIVE_INFINITY;

      for (const candidate of centroidDays) {
        if (used.has(candidate.originalIndex)) continue;
        const distance = haversineDistanceKm(current.centroid, candidate.centroid);

        if (distance < minDistance - 1e-6) {
          minDistance = distance;
          bestCandidate = candidate;
        } else if (Math.abs(distance - minDistance) <= 1e-6 && bestCandidate) {
          if (candidate.originalIndex < bestCandidate.originalIndex) {
            bestCandidate = candidate;
          }
        }
      }

      if (bestCandidate) {
        ordered.push(bestCandidate);
        used.add(bestCandidate.originalIndex);
      } else {
        break;
      }
    }

    let totalDistance = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      totalDistance += haversineDistanceKm(ordered[i - 1].centroid, ordered[i].centroid);
    }

    // Add small penalty for original index to break ties
    let tieBreaker = 0;
    for (let i = 0; i < ordered.length; i += 1) {
      tieBreaker += ordered[i].originalIndex * Math.pow(0.1, i);
    }
    const finalScore = totalDistance + tieBreaker * 1e-4;

    if (finalScore < bestDistance) {
      bestDistance = finalScore;
      bestOrdered = ordered;
    }
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
      slots[i] = bestOrdered[orderedIndex] ?? null;
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

function activityCommuteMinutes(
  from: SuggestedActivity,
  to: SuggestedActivity,
  commuteMinutesByPair: ActivityCommuteMatrix
): number {
  if (from.id === to.id) return 0;
  const fromMatrix = commuteMinutesByPair.get(activityPairKey(from.id, to.id));
  if (typeof fromMatrix === "number" && Number.isFinite(fromMatrix)) {
    return fromMatrix;
  }
  return estimateDriveMinutesFallback(getActivityRoutingPoint(from), getActivityRoutingPoint(to));
}

function buildOptimalDayRoute(
  activities: SuggestedActivity[],
  preparedMap: Map<string, PreparedActivity>,
  commuteMinutesByPair: ActivityCommuteMatrix
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
          cost += activityCommuteMinutes(route[i - 1], activity, commuteMinutesByPair) * COST_WEIGHTS.commute;
        }

        const loadDuration = getLoadDurationHours(preparedMap, activity.id);
        const midHour = currentHour + loadDuration / 2;
        const assignedSlot = slotForHour(midHour);
        if (activity.bestTimeOfDay !== "any") {
          cost += slotDistance(activity.bestTimeOfDay, assignedSlot) * loadDuration * COST_WEIGHTS.slotMismatch;
        }

        currentHour += loadDuration;
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
        const distance = activityCommuteMinutes(current, candidate, commuteMinutesByPair);
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
      totalDistance += activityCommuteMinutes(ordered[i - 1], ordered[i], commuteMinutesByPair);
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
  activities: SuggestedActivity[],
  commuteMinutesByPair: ActivityCommuteMatrix
): number {
  let commuteProxy = 0;
  for (let i = 1; i < activities.length; i += 1) {
    commuteProxy += activityCommuteMinutes(activities[i - 1], activities[i], commuteMinutesByPair);
  }
  return commuteProxy;
}

export type DayStructuralStats = {
  structuralCost: number;
  commuteProxy: number;
  totalHours: number;
};

export const structuralStatsCache = new Map<string, DayStructuralStats>();

export function getDayStructuralStats(
  activityIds: string[],
  preparedMap: Map<string, PreparedActivity>,
  commuteMinutesByPair: ActivityCommuteMatrix,
  dayCapacity: DayCapacityProfile
): DayStructuralStats {
  const cacheKey = activityIds.slice().sort().join(",");
  const cached = structuralStatsCache.get(cacheKey);
  if (cached) return cached;

  if (activityIds.length === 0) {
    const stats = { structuralCost: 0, commuteProxy: 0, totalHours: 0 };
    structuralStatsCache.set(cacheKey, stats);
    return stats;
  }

  const activities = buildOptimalDayRoute(
    activityIds
      .map((id) => preparedMap.get(id)?.activity)
      .filter((activity): activity is SuggestedActivity => activity !== undefined),
    preparedMap,
    commuteMinutesByPair
  );

  const totalHours = activities.reduce((sum, activity) => sum + getLoadDurationHours(preparedMap, activity.id), 0);

  const commuteProxy = computeDayCommuteProxy(activities, commuteMinutesByPair);
  const legDistances: number[] = [];
  for (let i = 1; i < activities.length; i += 1) {
    legDistances.push(activityCommuteMinutes(activities[i - 1], activities[i], commuteMinutesByPair));
  }
  const longestLeg = legDistances.length > 0 ? Math.max(...legDistances) : 0;
  const averageLeg = legDistances.length > 0 ? legDistances.reduce((sum, d) => sum + d, 0) / legDistances.length : 0;
  const longLegPenalty = Math.max(0, longestLeg - 75);
  const spreadPenalty = Math.max(0, averageLeg - 45);

  const uniqueTypes = new Set(activities.map((activity) => activity.type.trim().toLowerCase())).size;
  const varietyPenalty = activities.length > 1 ? (activities.length - uniqueTypes) / activities.length : 0;

  const slotHours: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
  };
  for (const activity of activities) {
    if (activity.bestTimeOfDay === "any") continue;
    slotHours[activity.bestTimeOfDay] += getLoadDurationHours(preparedMap, activity.id);
  }

  const slotOverflowPenalty = Object.entries(slotHours).reduce((sum, [slot, hours]) => {
    const capacity = dayCapacity.slotCapacity[slot as keyof typeof dayCapacity.slotCapacity];
    return sum + Math.max(0, hours - capacity);
  }, 0);

  let slotMismatchPenalty = 0;
  let recommendedStartMissPenalty = 0;
  let currentHour = 0;
  for (const activity of activities) {
    const duration = getLoadDurationHours(preparedMap, activity.id);
    const midHour = currentHour + duration / 2;
    const assignedSlot = slotForHour(midHour);
    if (activity.bestTimeOfDay !== "any") {
      slotMismatchPenalty += slotDistance(activity.bestTimeOfDay, assignedSlot) * duration;
    }
    const latestRecommendedStartMinutes = recommendedWindowLatestStartMinutes(activity);
    const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime || null);
    const effectiveStartMinutes =
      fixedStartMinutes != null
        ? fixedStartMinutes
        : SOFT_DAY_START_MINUTES + Math.round(currentHour * 60);
    if (latestRecommendedStartMinutes != null && effectiveStartMinutes > latestRecommendedStartMinutes) {
      recommendedStartMissPenalty += (effectiveStartMinutes - latestRecommendedStartMinutes) / 60;
    }
    currentHour += duration;
  }

  const overflow = Math.max(0, totalHours - dayCapacity.maxHours);
  const fullDayActivities = activities.filter((activity) => preparedMap.get(activity.id)?.isFullDay);
  let overflowPenalty = overflow * COST_WEIGHTS.overflow + overflow * overflow * COST_WEIGHTS.overflowQuadratic;
  let fullDayFitPenalty = 0;

  if (fullDayActivities.length > 0) {
    let nearbyWeightedHours = 0;
    let farWeightedHours = 0;

    for (const activity of activities) {
      if (preparedMap.get(activity.id)?.isFullDay) continue;

      const duration = getLoadDurationHours(preparedMap, activity.id);
      let minDistance = Number.POSITIVE_INFINITY;
      for (const fullDayActivity of fullDayActivities) {
        minDistance = Math.min(minDistance, activityDistanceProxy(activity, fullDayActivity));
      }

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

  const structuralCost =
    overflowPenalty +
    commuteProxy * COST_WEIGHTS.commute +
    longLegPenalty * COST_WEIGHTS.longLeg +
    spreadPenalty * COST_WEIGHTS.spread +
    varietyPenalty * COST_WEIGHTS.variety +
    slotOverflowPenalty * COST_WEIGHTS.slotOverflow +
    slotMismatchPenalty * COST_WEIGHTS.slotMismatch +
    recommendedStartMissPenalty * COST_WEIGHTS.recommendedStartMiss +
    fullDayFitPenalty;

  const stats = { structuralCost, commuteProxy, totalHours };
  structuralStatsCache.set(cacheKey, stats);
  return stats;
}

function computeTotalCost(
  days: WorkingDay[],
  preparedMap: Map<string, PreparedActivity>,
  commuteMinutesByPair: ActivityCommuteMatrix,
  dayCapacities: DayCapacityProfile[]
): number {
  const dayStats = days.map((day, i) =>
    getDayStructuralStats(
      day.activityIds,
      preparedMap,
      commuteMinutesByPair,
      dayCapacities[i] || {
        maxHours: MAX_DAY_HOURS,
        slotCapacity: cloneDefaultSlotCapacity(),
        targetWeight: 1,
      }
    )
  );

  const totalHours = dayStats.reduce((sum, s) => sum + s.totalHours, 0);
  const totalCapacityWeight = dayCapacities.reduce((sum, profile) => sum + profile.targetWeight, 0);

  const baseCost = dayStats.reduce((sum, s, i) => {
    const profile = dayCapacities[i] || {
      maxHours: MAX_DAY_HOURS,
      slotCapacity: cloneDefaultSlotCapacity(),
      targetWeight: 1,
    };
    const normalizedWeight =
      totalCapacityWeight > 0 ? profile.targetWeight / totalCapacityWeight : 1 / Math.max(1, days.length);
    const targetHours = Math.min(profile.maxHours, totalHours * normalizedWeight);
    const balancePenalty = Math.abs(s.totalHours - targetHours) * COST_WEIGHTS.balance;
    return sum + s.structuralCost + balancePenalty;
  }, 0);

  const totalCommute = dayStats.reduce((sum, s) => sum + s.commuteProxy, 0);
  const avgCommute = totalCommute / Math.max(1, dayStats.length);
  const maxCommute = Math.max(...dayStats.map((s) => s.commuteProxy));
  const commuteImbalancePenalty = Math.max(0, maxCommute - avgCommute) * COST_WEIGHTS.commuteImbalance;
  const activityDayIndex = new Map<string, number>();
  days.forEach((day, dayIndex) => {
    day.activityIds.forEach((id) => activityDayIndex.set(id, dayIndex));
  });
  const prepared = Array.from(preparedMap.values());
  let nearbySplitPenalty = 0;
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const left = prepared[i].activity;
      const right = prepared[j].activity;
      const leftDay = activityDayIndex.get(left.id);
      const rightDay = activityDayIndex.get(right.id);
      if (leftDay == null || rightDay == null || leftDay === rightDay) continue;

      const commuteMinutes = activityCommuteMinutes(left, right, commuteMinutesByPair);
      if (commuteMinutes > NEARBY_CLUSTER_MAX_COMMUTE_MINUTES) continue;

      const leftLoad = prepared[i].loadDurationHours;
      const rightLoad = prepared[j].loadDurationHours;
      const leftProfile = dayCapacities[leftDay];
      const rightProfile = dayCapacities[rightDay];
      const leftTotalIfMerged = (dayStats[leftDay]?.totalHours ?? 0) + rightLoad;
      const rightTotalIfMerged = (dayStats[rightDay]?.totalHours ?? 0) + leftLoad;
      const squeezableOnEitherDay =
        (leftProfile && leftTotalIfMerged <= leftProfile.maxHours + NEARBY_CLUSTER_SQUEEZE_HOURS) ||
        (rightProfile && rightTotalIfMerged <= rightProfile.maxHours + NEARBY_CLUSTER_SQUEEZE_HOURS);
      if (!squeezableOnEitherDay) continue;

      const proximity = (NEARBY_CLUSTER_MAX_COMMUTE_MINUTES - commuteMinutes) / NEARBY_CLUSTER_MAX_COMMUTE_MINUTES;
      nearbySplitPenalty += proximity * (leftLoad + rightLoad) * 0.5;
    }
  }

  return baseCost + commuteImbalancePenalty + nearbySplitPenalty * COST_WEIGHTS.nearbySplit;
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
  commuteMinutesByPair,
  dayCapacities,
}: {
  days: WorkingDay[];
  activityId: string;
  preparedMap: Map<string, PreparedActivity>;
  commuteMinutesByPair: ActivityCommuteMatrix;
  dayCapacities: DayCapacityProfile[];
}): void {
  const candidateIndices = days.map((_, index) => index);

  let bestIndex = candidateIndices[0] ?? 0;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const index of candidateIndices) {
    const clone = days.map((day) => ({
      activityIds: [...day.activityIds],
    }));
    clone[index].activityIds.push(activityId);

    const cost = computeTotalCost(clone, preparedMap, commuteMinutesByPair, dayCapacities);
    if (cost < bestCost) {
      bestCost = cost;
      bestIndex = index;
    }
  }

  days[bestIndex].activityIds.push(activityId);
}

function optimizeByMovesAndSwaps(
  days: WorkingDay[],
  preparedMap: Map<string, PreparedActivity>,
  commuteMinutesByPair: ActivityCommuteMatrix,
  dayCapacities: DayCapacityProfile[]
): void {
  for (let pass = 0; pass < MAX_OPTIMIZATION_PASSES; pass += 1) {
    let improved = false;

    for (let i = 0; i < days.length; i += 1) {
      for (const activityId of [...days[i].activityIds]) {
        let currentBestCost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities);
        let bestMoveTarget = -1;

        for (let j = 0; j < days.length; j += 1) {
          if (j === i) continue;

          // Instead of full map clone, only create a shallow clone of the affected days
          const originalDayI = days[i].activityIds;
          const originalDayJ = days[j].activityIds;

          days[i].activityIds = originalDayI.filter((id) => id !== activityId);
          days[j].activityIds = [...originalDayJ, activityId];

          const cost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities);

          if (cost + 1e-6 < currentBestCost) {
            currentBestCost = cost;
            bestMoveTarget = j;
          }

          // Restore
          days[i].activityIds = originalDayI;
          days[j].activityIds = originalDayJ;
        }

        if (bestMoveTarget >= 0) {
          days[bestMoveTarget].activityIds.push(activityId);
          days[i].activityIds = days[i].activityIds.filter((id) => id !== activityId);
          improved = true;
        }
      }
    }

    for (let i = 0; i < days.length; i += 1) {
      for (let j = i + 1; j < days.length; j += 1) {
        for (const leftId of [...days[i].activityIds]) {
          for (const rightId of [...days[j].activityIds]) {
            const currentCost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities);

            const originalDayI = days[i].activityIds;
            const originalDayJ = days[j].activityIds;

            days[i].activityIds = originalDayI.map(id => id === leftId ? rightId : id);
            days[j].activityIds = originalDayJ.map(id => id === rightId ? leftId : id);

            const swappedCost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities);
            if (swappedCost + 1e-6 < currentCost) {
              improved = true;
              // Keep the swap
            } else {
              // Restore
              days[i].activityIds = originalDayI;
              days[j].activityIds = originalDayJ;
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

export async function groupActivitiesByDay({
  tripInfo,
  activities,
}: {
  tripInfo: TripInfo;
  activities: SuggestedActivity[];
}): Promise<DayGroup[]> {
  distanceCache.clear();
  structuralStatsCache.clear();
  const commuteMinutesByPair = await computeActivityCommuteMatrix(activities);
  const dayCount = computeDayCount(tripInfo, activities.length);
  const dayCapacities = buildDayCapacityProfiles(tripInfo, dayCount);
  const dates = buildTripDates(tripInfo, dayCount);
  const preparedMap = new Map<string, PreparedActivity>(
    activities.map((activity) => {
      const durationHours = parseDurationHours(activity.estimatedDuration);
      return [
        activity.id,
        {
          activity,
          durationHours,
          loadDurationHours: durationHours * activityLoadFactor(activity),
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
      const durationDelta = getLoadDurationHours(preparedMap, b.id) - getLoadDurationHours(preparedMap, a.id);
      if (durationDelta !== 0) return durationDelta;
      return a.name.localeCompare(b.name);
    });

  for (const anchor of remainingAnchors) {
    assignActivityToBestDay({
      days,
      activityId: anchor.id,
      preparedMap,
      commuteMinutesByPair,
      dayCapacities,
    });
  }

  const remainingFlex = activities
    .filter((activity) => !selectedSeedIds.has(activity.id) && !days.some((day) => day.activityIds.includes(activity.id)))
    .sort((a, b) => {
      const durationDelta = getLoadDurationHours(preparedMap, b.id) - getLoadDurationHours(preparedMap, a.id);
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
      commuteMinutesByPair,
      dayCapacities,
    });
  }

  optimizeByMovesAndSwaps(days, preparedMap, commuteMinutesByPair, dayCapacities);

  const buckets = days.map((day) =>
    buildOptimalDayRoute(
      day.activityIds
        .map((id) => preparedMap.get(id)?.activity)
        .filter((activity): activity is SuggestedActivity => activity !== undefined),
      preparedMap,
      commuteMinutesByPair
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
