import type {
    SuggestedActivity,
} from "@/lib/models/travel-plan";
import {
    Coordinate,
    ActivityCommuteMatrix,
    DayBucket,
} from "./types";
import {
    activityPairKey,
    slotDistance,
} from "./utils";

const ROUTE_MATRIX_API_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTE_MATRIX_MAX_LOCATIONS = 25;

export function haversineDistanceKm(
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

export function getRoutesApiKey(): string | null {
    return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || null;
}

export function parseRouteDurationSeconds(duration?: string): number | null {
    if (!duration) return null;
    const match = duration.match(/^\s*([\d.]+)s\s*$/);
    if (!match) return null;
    const seconds = Number.parseFloat(match[1]);
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

export function estimateDriveMinutesFallback(
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

export function getActivityRoutingPoint(activity: SuggestedActivity): Coordinate | null {
    if (activity.locationMode === "route") {
        return activity.startCoordinates || activity.coordinates || activity.endCoordinates || null;
    }
    return activity.coordinates || activity.startCoordinates || activity.endCoordinates || null;
}

function getActivityRouteEntryPoint(activity: SuggestedActivity): Coordinate | null {
    if (activity.locationMode !== "route") {
        return activity.coordinates || activity.startCoordinates || activity.endCoordinates || null;
    }
    const routeStart = activity.routePoints?.[0] || null;
    return activity.startCoordinates || routeStart || activity.coordinates || activity.endCoordinates || null;
}

function getActivityRouteExitPoint(activity: SuggestedActivity): Coordinate | null {
    if (activity.locationMode !== "route") {
        return activity.coordinates || activity.endCoordinates || activity.startCoordinates || null;
    }
    const routeEnd = activity.routePoints && activity.routePoints.length > 0
        ? activity.routePoints[activity.routePoints.length - 1]
        : null;
    return activity.endCoordinates || routeEnd || activity.coordinates || activity.startCoordinates || null;
}

function isReversibleRoadActivity(activity: SuggestedActivity): boolean {
    if (activity.locationMode !== "route") return false;
    const type = (activity.type || "").trim().toLowerCase();
    return type === "road" || type.includes("road");
}

function coordinateKey(point: Coordinate): string {
    return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

function pushUniquePoint(points: Coordinate[], seen: Set<string>, point: Coordinate | null): void {
    if (!point) return;
    const key = coordinateKey(point);
    if (seen.has(key)) return;
    seen.add(key);
    points.push(point);
}

function getActivityRoutingVariants(activity: SuggestedActivity): {
    entryPoints: Coordinate[];
    exitPoints: Coordinate[];
} {
    const entryPoint = getActivityRouteEntryPoint(activity);
    const exitPoint = getActivityRouteExitPoint(activity);

    if (!isReversibleRoadActivity(activity)) {
        return {
            entryPoints: entryPoint ? [entryPoint] : [],
            exitPoints: exitPoint ? [exitPoint] : [],
        };
    }

    const entryPoints: Coordinate[] = [];
    const exitPoints: Coordinate[] = [];
    const seenEntry = new Set<string>();
    const seenExit = new Set<string>();

    pushUniquePoint(entryPoints, seenEntry, entryPoint);
    pushUniquePoint(entryPoints, seenEntry, exitPoint);
    pushUniquePoint(exitPoints, seenExit, exitPoint);
    pushUniquePoint(exitPoints, seenExit, entryPoint);

    return { entryPoints, exitPoints };
}

export function parseRouteMatrixEntries(rawText: string): Array<Record<string, unknown>> {
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

export async function computeActivityCommuteMatrix(activities: SuggestedActivity[]): Promise<ActivityCommuteMatrix> {
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

    const routingVariantsById = new Map<string, { entryPoints: Coordinate[]; exitPoints: Coordinate[] }>();
    for (const activity of activities) {
        routingVariantsById.set(activity.id, getActivityRoutingVariants(activity));
    }

    const pointByKey = new Map<string, Coordinate>();
    for (const activity of activities) {
        const variants = routingVariantsById.get(activity.id);
        for (const point of variants?.entryPoints ?? []) {
            pointByKey.set(coordinateKey(point), point);
        }
        for (const point of variants?.exitPoints ?? []) {
            pointByKey.set(coordinateKey(point), point);
        }
    }
    const valid = Array.from(pointByKey.entries()).map(([id, point]) => ({ id, point }));
    const routeMinutesByPointPair = new Map<string, number>();

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
                        routeMinutesByPointPair.set(
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
        const fromVariants = routingVariantsById.get(from.id) ?? getActivityRoutingVariants(from);
        const fromPoints = fromVariants.exitPoints.length > 0
            ? fromVariants.exitPoints
            : [getActivityRouteExitPoint(from)].filter((point): point is Coordinate => point !== null);

        for (const to of activities) {
            if (from.id === to.id) continue;
            const key = activityPairKey(from.id, to.id);
            if (commuteMinutesByPair.has(key)) continue;
            const toVariants = routingVariantsById.get(to.id) ?? getActivityRoutingVariants(to);
            const toPoints = toVariants.entryPoints.length > 0
                ? toVariants.entryPoints
                : [getActivityRouteEntryPoint(to)].filter((point): point is Coordinate => point !== null);

            let bestMinutes = Number.POSITIVE_INFINITY;
            const safeFromPoints = fromPoints.length > 0 ? fromPoints : [null];
            const safeToPoints = toPoints.length > 0 ? toPoints : [null];

            for (const fromPoint of safeFromPoints) {
                for (const toPoint of safeToPoints) {
                    let minutes: number;
                    if (fromPoint && toPoint) {
                        const matrixMinutes = routeMinutesByPointPair.get(activityPairKey(coordinateKey(fromPoint), coordinateKey(toPoint)));
                        minutes = typeof matrixMinutes === "number"
                            ? matrixMinutes
                            : estimateDriveMinutesFallback(fromPoint, toPoint);
                    } else {
                        minutes = estimateDriveMinutesFallback(fromPoint, toPoint);
                    }
                    bestMinutes = Math.min(bestMinutes, minutes);
                }
            }

            commuteMinutesByPair.set(
                key,
                Number.isFinite(bestMinutes) ? bestMinutes : estimateDriveMinutesFallback(null, null)
            );
        }
    }

    return commuteMinutesByPair;
}

export function activityCommuteMinutes(
    from: SuggestedActivity,
    to: SuggestedActivity,
    commuteMinutesByPair: ActivityCommuteMatrix
): number {
    if (from.id === to.id) return 0;
    const fromMatrix = commuteMinutesByPair.get(activityPairKey(from.id, to.id));
    if (typeof fromMatrix === "number" && Number.isFinite(fromMatrix)) {
        return fromMatrix;
    }
    const fromVariants = getActivityRoutingVariants(from);
    const toVariants = getActivityRoutingVariants(to);
    const fromPoints = fromVariants.exitPoints.length > 0
        ? fromVariants.exitPoints
        : [getActivityRouteExitPoint(from)].filter((point): point is Coordinate => point !== null);
    const toPoints = toVariants.entryPoints.length > 0
        ? toVariants.entryPoints
        : [getActivityRouteEntryPoint(to)].filter((point): point is Coordinate => point !== null);

    const safeFromPoints = fromPoints.length > 0 ? fromPoints : [null];
    const safeToPoints = toPoints.length > 0 ? toPoints : [null];
    let bestMinutes = Number.POSITIVE_INFINITY;

    for (const fromPoint of safeFromPoints) {
        for (const toPoint of safeToPoints) {
            bestMinutes = Math.min(bestMinutes, estimateDriveMinutesFallback(fromPoint, toPoint));
        }
    }

    return Number.isFinite(bestMinutes) ? bestMinutes : estimateDriveMinutesFallback(null, null);
}

export function listActivityDistancePoints(activity: SuggestedActivity): Array<{ lat: number; lng: number }> {
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

export function computeDayCentroid(activities: SuggestedActivity[]): { lat: number; lng: number } | null {
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

export function orderDayBucketsByProximity(buckets: DayBucket[]): DayBucket[] {
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

export const distanceCache = new Map<string, number>();

export function activityDistanceProxy(a: SuggestedActivity, b: SuggestedActivity): number {
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
        const penalty = slotDistance(a.bestTimeOfDay, b.bestTimeOfDay) * 1.2;
        const typePenalty = a.type.trim().toLowerCase() === b.type.trim().toLowerCase() ? 0.3 : 1;
        result = penalty + typePenalty;
    }

    distanceCache.set(cacheKey, result);
    return result;
}
