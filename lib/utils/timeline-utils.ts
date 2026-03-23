/**
 * Pure utility functions for the day-grouping timeline view.
 * No React dependencies — safe to test and import anywhere.
 */

import type { SuggestedActivity } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default day window used for "effective overload" calculations. */
export const REGULAR_DAY_START_MINUTES = 9 * 60 + 30; // 9:30 AM
export const REGULAR_DAY_END_MINUTES = REGULAR_DAY_START_MINUTES + 8 * 60; // 5:30 PM
export const DEFAULT_SUNSET_MINUTES = 18 * 60;          // 6:00 PM
export const AIRPORT_ARRIVAL_LEAD_MINUTES = 120;        // 2 hr before departure
export const COMMUTE_TRANSITION_BUFFER_MINUTES = 20;    // buffer after each commute leg
export const DEPARTURE_TRANSFER_MINUTES = 90;           // airport shuttle/rental return estimate
export const LUNCH_MIN_START_MINUTES = 12 * 60;         // earliest lunch (noon)
export const LUNCH_TARGET_START_MINUTES = 12 * 60 + 30; // preferred lunch start
export const LUNCH_BLOCK_MINUTES = 75;                  // 1 hr 15 min (rounded to quarter)
export const PRE_DAY_BUFFER_MINUTES = 15;               // buffer before first activity
export const MIN_SCHEDULED_DURATION_RATIO = 0.6;        // never schedule below 60% of recommended

/**
 * Weight applied to off-peak activity minutes when computing overload.
 * Activities outside the regular window count at 30 % of their real length.
 */
export const OFF_HOURS_ACTIVITY_DISCOUNT = 0.3;

// ---------------------------------------------------------------------------
// Time-math helpers
// ---------------------------------------------------------------------------

/** Round `value` to the nearest 15-minute increment. */
export const roundToQuarter = (value: number): number => Math.round(value / 15) * 15;

/**
 * Convert a minutes-since-midnight value to a 12-hour clock string.
 * E.g. 570 → "9:30 AM", 780 → "1:00 PM"
 */
export const toClockLabel = (minutes: number): string => {
    const clamped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
};

/** Format a time range as "9:30 AM-11:00 AM". */
export const toRangeLabel = (startMinutes: number, endMinutes: number): string =>
    `${toClockLabel(startMinutes)}-${toClockLabel(endMinutes)}`;

/**
 * Parse a human-readable time string to minutes-since-midnight.
 * Accepts: "9:30 AM", "13:00", "sunrise", "sunset", etc.
 * Returns null if unparseable.
 */
export function parseFixedStartTimeMinutes(value?: string | null): number | null {
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

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

/**
 * Parse an activity's `estimatedDuration` string to decimal hours.
 * Falls back to 2 hours if unparseable.
 * Examples: "2-3 hours" → 2.5, "half day" → 4, "30 min" → 0.5
 */
export function parseEstimatedHours(duration?: string | null): number {
    if (!duration) return 2;
    const text = duration.toLowerCase().trim();
    if (!text) return 2;

    const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) {
        const min = Number(rangeMatch[1]);
        const max = Number(rangeMatch[2]);
        if (Number.isFinite(min) && Number.isFinite(max) && max >= min) return (min + max) / 2;
    }

    const singleHourMatch = text.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)/);
    if (singleHourMatch) {
        const value = Number(singleHourMatch[1]);
        if (Number.isFinite(value)) return value;
    }

    if (/half\s*day/.test(text)) return 4;
    if (/full\s*day|all\s*day/.test(text)) return 7;
    if (/30\s*min/.test(text)) return 0.5;
    if (/45\s*min/.test(text)) return 0.75;
    return 2;
}

/** Format decimal hours as a short human label. E.g. 1 → "1 hr", 2.5 → "2.5 hrs". */
export const formatHourLabel = (hours: number): string => {
    const rounded = Math.round(hours * 10) / 10;
    if (Math.abs(rounded - 1) < 0.01) return "1 hr";
    return `${rounded} hrs`;
};

// ---------------------------------------------------------------------------
// Geo / commute helpers
// ---------------------------------------------------------------------------

type LatLng = { lat: number; lng: number };

/**
 * Haversine distance between two coordinates in kilometres.
 * Returns null if either point is missing.
 */
export function haversineKm(
    from: LatLng | null | undefined,
    to: LatLng | null | undefined,
): number | null {
    if (!from || !to) return null;
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Conservative road-distance commute estimate in minutes (with a minimum of
 * 10 min). Used as a fallback when the Routing API hasn't returned yet.
 */
export function estimateCommuteMinutes(
    from: LatLng | null | undefined,
    to: LatLng | null | undefined,
): number {
    const distanceKm = haversineKm(from, to);
    if (distanceKm == null) return 25;
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
    const minutes = Math.round((roadDistanceKm / speedKph) * 60);
    return Math.max(10, minutes);
}

/**
 * Same road-distance estimate as `estimateCommuteMinutes` but with a minimum
 * of 0 — used for internal route-length comparisons.
 */
export function estimateDriveMinutesNoFloor(
    from: LatLng | null | undefined,
    to: LatLng | null | undefined,
): number {
    const distanceKm = haversineKm(from, to);
    if (distanceKm == null) return 0;
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
    return Math.max(0, Math.round((roadDistanceKm / speedKph) * 60));
}

/**
 * Estimate the intrinsic drive time for a route-type activity (e.g. a
 * scenic drive). Returns null for point activities.
 */
export function estimateRouteIntrinsicMinutes(activity: SuggestedActivity): number | null {
    if (activity.locationMode !== "route") return null;

    const routePoints = activity.routePoints || [];
    const startPoint = activity.startCoordinates || routePoints[0] || activity.coordinates || null;
    const endPoint =
        activity.endCoordinates ||
        (routePoints.length > 1 ? routePoints[routePoints.length - 1] : null) ||
        activity.coordinates ||
        null;

    if (!startPoint || !endPoint) return null;

    // Collect de-duplicated intermediate candidates
    const candidates: Array<LatLng> = [];
    const addCandidate = (point?: LatLng | null) => {
        if (!point) return;
        const nearExisting = candidates.some((existing) => {
            const deltaKm = haversineKm(existing, point);
            return deltaKm != null && deltaKm < 0.8;
        });
        if (!nearExisting) candidates.push(point);
    };
    (activity.routeWaypoints || []).forEach((waypoint) => addCandidate(waypoint.coordinates));
    routePoints.slice(1, Math.max(1, routePoints.length - 1)).forEach((point) => addCandidate(point));

    // Find the farthest intermediate stop to estimate the round-trip-style route
    let farthestPoint = endPoint;
    let farthestDriveFromStart = estimateDriveMinutesNoFloor(startPoint, endPoint);
    candidates.forEach((candidate) => {
        const driveFromStart = estimateDriveMinutesNoFloor(startPoint, candidate);
        if (driveFromStart > farthestDriveFromStart) {
            farthestDriveFromStart = driveFromStart;
            farthestPoint = candidate;
        }
    });

    const toFarthestMinutes = estimateDriveMinutesNoFloor(startPoint, farthestPoint);
    const farthestToExitMinutes = estimateDriveMinutesNoFloor(farthestPoint, endPoint);
    const baseRouteMinutes = toFarthestMinutes + farthestToExitMinutes;
    if (baseRouteMinutes <= 0) return null;

    const waypointBufferMinutes = Math.min(90, Math.max(20, (activity.routeWaypoints?.length ?? 0) * 15));
    const scenicBufferMinutes = baseRouteMinutes >= 240 ? 60 : baseRouteMinutes >= 150 ? 45 : 30;
    return Math.min(12 * 60, baseRouteMinutes + waypointBufferMinutes + scenicBufferMinutes);
}

// ---------------------------------------------------------------------------
// Commute-mode helpers
// ---------------------------------------------------------------------------

export type CommuteMode = "TRAIN" | "TRANSIT" | "WALK" | "DRIVE";

/**
 * Heuristically pick the most appropriate commute mode based on distance
 * and whether the destination is well-served by rail.
 */
export function pickCommuteMode(
    from: LatLng | null | undefined,
    to: LatLng | null | undefined,
    railFriendlyDestination: boolean,
): CommuteMode {
    const distanceKm = haversineKm(from, to);
    if (distanceKm == null) return railFriendlyDestination ? "TRAIN" : "DRIVE";
    if (distanceKm <= 1.5) return "WALK";
    if (railFriendlyDestination && distanceKm >= 3 && distanceKm <= 250) return "TRAIN";
    return "DRIVE";
}

/** Map `CommuteMode` to the Google Routes API travel mode string. */
export function toTravelMode(mode: CommuteMode): "DRIVE" | "WALK" | "TRANSIT" {
    if (mode === "WALK") return "WALK";
    if (mode === "TRAIN" || mode === "TRANSIT") return "TRANSIT";
    return "DRIVE";
}

/** Human-readable label for a `CommuteMode`. */
export function commuteModeLabel(mode: CommuteMode): string {
    if (mode === "TRAIN") return "Train";
    if (mode === "TRANSIT") return "Transit";
    if (mode === "WALK") return "Walk";
    return "Drive";
}

// ---------------------------------------------------------------------------
// Activity-timing helpers
// ---------------------------------------------------------------------------

/**
 * Return the midpoint of the activity's recommended start window in
 * minutes-since-midnight, or null if no window is defined.
 */
export function recommendedWindowMidpointMinutes(activity: SuggestedActivity): number | null {
    const startMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.start);
    const endMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.end);
    if (startMinutes == null || endMinutes == null || endMinutes < startMinutes) return null;
    return Math.round((startMinutes + endMinutes) / 2);
}

/**
 * A scale factor applied to an activity's duration when it has a very early
 * fixed start time (e.g. sunrise). Reduces the effective hours to avoid
 * over-filling the rest of the day.
 */
export function activityLoadFactor(activity: SuggestedActivity): number {
    if (activity.isDurationFlexible === false) return 1;
    if (!activity.isFixedStartTime) return 1;
    const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime);
    if (fixedStartMinutes != null && fixedStartMinutes <= 7 * 60) return 0.7;
    if ((activity.fixedStartTime || "").toLowerCase() === "sunrise") return 0.7;
    if (fixedStartMinutes == null && activity.bestTimeOfDay === "morning") return 0.7;
    return 1;
}

/**
 * Format the recommended start window as a clock range string,
 * e.g. "8:00 AM-10:00 AM". Returns null if the window is not defined.
 */
export function formatRecommendedStartWindowLabel(activity: SuggestedActivity): string | null {
    const window = activity.recommendedStartWindow;
    if (!window?.start || !window?.end) return null;
    const start = parseFixedStartTimeMinutes(window.start);
    const end = parseFixedStartTimeMinutes(window.end);
    if (start == null || end == null) return null;
    return `${toClockLabel(start)}-${toClockLabel(end)}`;
}

// ---------------------------------------------------------------------------
// Additional Helpers (Extracted from DayGroupingView)
// ---------------------------------------------------------------------------

export const buildLegId = (dayNumber: number, fromId: string, toId: string) =>
    `${dayNumber}:${fromId}->${toId}`;
export const buildStayStartLegId = (dayNumber: number, toId: string) => `${dayNumber}:stay-start->${toId}`;
export const buildStayEndLegId = (dayNumber: number, fromId: string) => `${dayNumber}:${fromId}->stay-end`;

export const inferDaylightPreference = (activity: SuggestedActivity): "daylight_only" | "night_only" | "flexible" => {
    if (activity.daylightPreference) return activity.daylightPreference as "daylight_only" | "night_only" | "flexible";
    const tags = (activity.interestTags || []).join(" ");
    const category = activity.researchOption?.category || "";
    const text = `${activity.name} ${activity.type} ${tags} ${category}`.toLowerCase();
    if (/(night snorkel|night snorkeling|night dive|moonlight|stargaz|astronomy|night tour|after dark|biolumines|sunset cruise)/i.test(text)) {
        return "night_only";
    }
    if (/(snorkel|snorkeling|scuba|dive|surf|kayak|paddle|canoe|boat tour|hike|trail|outdoor|national park|waterfall|beach)/i.test(text)) {
        return "daylight_only";
    }
    return "flexible";
};

export const getActivityTimingPolicy = (activity: SuggestedActivity): { settleBufferMinutes: number } => {
    const tags = (activity.interestTags || []).join(" ");
    const category = activity.researchOption?.category || "";
    const text = `${activity.name} ${activity.type} ${tags} ${category}`.toLowerCase();
    const settleBufferMinutes = /(snorkel|snorkeling|scuba|dive|surf|kayak|paddle|canoe|hike|hiking|trail)/i.test(text) ? 15 : 10;
    return { settleBufferMinutes };
};

export const daylightEndCapMinutes = (activity: SuggestedActivity, dayCutoffMinutes: number, sunsetMinutes: number): number | null => {
    const preference = inferDaylightPreference(activity);
    if (preference !== "daylight_only") return null;
    return Math.min(dayCutoffMinutes, sunsetMinutes);
};

export const nightOnlyStartFloorMinutes = (activity: SuggestedActivity, sunsetMinutes: number): number | null => {
    return inferDaylightPreference(activity) === "night_only" ? sunsetMinutes : null;
};

export const getActivityStartPoint = (activity: SuggestedActivity) => {
    if (activity.locationMode === "route") return activity.startCoordinates || activity.coordinates || activity.endCoordinates || null;
    return activity.coordinates || activity.startCoordinates || activity.endCoordinates || null;
};

export const getActivityEndPoint = (activity: SuggestedActivity) => {
    if (activity.locationMode === "route") return activity.endCoordinates || activity.coordinates || activity.startCoordinates || null;
    return activity.coordinates || activity.endCoordinates || activity.startCoordinates || null;
};

function listActivityExitCandidates(activity: SuggestedActivity): Array<{ lat: number; lng: number }> {
    if (activity.locationMode !== "route") {
        const point = getActivityEndPoint(activity);
        return point ? [point] : [];
    }

    const points: Array<{ lat: number; lng: number }> = [];
    const seen = new Set<string>();
    const addPoint = (point: { lat: number; lng: number } | null | undefined) => {
        if (!point) return;
        const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
        if (seen.has(key)) return;
        seen.add(key);
        points.push(point);
    };

    for (const point of activity.routePoints || []) addPoint(point);
    for (const waypoint of activity.routeWaypoints || []) addPoint(waypoint.coordinates);
    addPoint(activity.endCoordinates);
    addPoint(activity.startCoordinates);
    addPoint(activity.coordinates);

    return points;
}

export const getActivityExitPointToward = (
    activity: SuggestedActivity,
    destination: { lat: number; lng: number } | null | undefined
) => {
    const fallback = getActivityEndPoint(activity);
    if (!destination) return fallback;

    const candidates = listActivityExitCandidates(activity);
    if (candidates.length === 0) return fallback;

    let best = candidates[0];
    let bestMinutes = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const minutes = estimateDriveMinutesNoFloor(candidate, destination);
        if (minutes < bestMinutes) {
            bestMinutes = minutes;
            best = candidate;
        }
    }
    return best;
};

export const checkRailFriendlyDestination = (destination?: string | null) => {
    const normalized = destination?.toLowerCase().trim();
    if (!normalized) return false;
    return /(switzerland|swiss|europe|europa|austria|germany|france|italy|spain|netherlands|belgium|portugal|czech|hungary|poland|denmark|norway|sweden|finland)/.test(normalized);
};
