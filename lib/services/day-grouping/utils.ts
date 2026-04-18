import type {
    SuggestedActivity,
    TripInfo,
} from "@/lib/models/travel-plan";
import {
    TIME_ORDER,
    TYPE_THEME_MAP,
    MAX_DAY_HOURS,
    SOFT_DAY_START_MINUTES,
    SLOT_CAPACITY_HOURS,
    DayCapacityProfile,
    PreparedActivity,
} from "./types";

const REGULAR_DAY_END_MINUTES = 20 * 60;
const ARRIVAL_RECOVERY_BUFFER_MINUTES = 120;
const DEPARTURE_AIRPORT_LEAD_MINUTES = 120;
const DEPARTURE_TRANSFER_MINUTES_ESTIMATE = 90;
const DEPARTURE_COMMUTE_BUFFER_MINUTES = 20;

function roundToQuarterMinutes(minutes: number): number {
    return Math.round(minutes / 15) * 15;
}

export function parseDate(value: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function computeDayCount(tripInfo: TripInfo, activityCount: number): number {
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

export function buildTripDates(tripInfo: TripInfo, dayCount: number): string[] {
    const start = parseDate(tripInfo.startDate) ?? new Date();
    const dates: string[] = [];

    for (let i = 0; i < dayCount; i += 1) {
        const next = new Date(start);
        next.setDate(start.getDate() + i);
        dates.push(toIsoDate(next));
    }

    return dates;
}

export function cloneDefaultSlotCapacity(): Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> {
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

export function buildDayCapacityProfiles(tripInfo: TripInfo, dayCount: number): DayCapacityProfile[] {
    const capacities: DayCapacityProfile[] = Array.from({ length: dayCount }, () => ({
        maxHours: MAX_DAY_HOURS,
        slotCapacity: cloneDefaultSlotCapacity(),
        targetWeight: 1,
        overflowPenaltyMultiplier: 1,
    }));

    if (dayCount === 0) return capacities;

    const isFlightTrip = (tripInfo.transportMode || "flight") === "flight";
    const first = capacities[0];
    if (first) {
        const arrivalMinutes = parseClockMinutes(tripInfo.arrivalTimePreference) ?? 12 * 60;
        if (isFlightTrip) {
            const earliestUsableMinutes = Math.max(
                SOFT_DAY_START_MINUTES,
                roundToQuarterMinutes(arrivalMinutes + ARRIVAL_RECOVERY_BUFFER_MINUTES)
            );
            const hardArrivalCapacityHours = Math.max(0, (REGULAR_DAY_END_MINUTES - earliestUsableMinutes) / 60);
            first.maxHours = Math.min(first.maxHours, hardArrivalCapacityHours);
            first.overflowPenaltyMultiplier = Math.max(first.overflowPenaltyMultiplier ?? 1, 2.25);
        }
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
        if (isFlightTrip) {
            const airportArrivalDeadlineMinutes = Math.max(10 * 60, departureMinutes - DEPARTURE_AIRPORT_LEAD_MINUTES);
            const latestActivityEndMinutes =
                airportArrivalDeadlineMinutes - DEPARTURE_TRANSFER_MINUTES_ESTIMATE - DEPARTURE_COMMUTE_BUFFER_MINUTES;
            const hardDepartureCapacityHours = Math.max(0, (latestActivityEndMinutes - SOFT_DAY_START_MINUTES) / 60);
            last.maxHours = Math.min(last.maxHours, hardDepartureCapacityHours);
            last.slotCapacity.evening = 0;
            last.targetWeight = Math.min(last.targetWeight, 0.45);
            last.overflowPenaltyMultiplier = Math.max(last.overflowPenaltyMultiplier ?? 1, 5);
        }
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
        maxHours: Math.max(0, Math.min(MAX_DAY_HOURS, profile.maxHours)),
        targetWeight: Math.max(0.2, profile.targetWeight),
        overflowPenaltyMultiplier: Math.max(1, profile.overflowPenaltyMultiplier ?? 1),
        slotCapacity: {
            morning: Math.max(0, profile.slotCapacity.morning),
            afternoon: Math.max(0, profile.slotCapacity.afternoon),
            evening: Math.max(0, profile.slotCapacity.evening),
        },
    }));
}

export function normalizeType(type: string): string {
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

export function recommendedWindowLatestStartMinutes(activity: SuggestedActivity): number | null {
    return parseFixedStartTimeMinutes(activity.recommendedStartWindow?.end || null);
}

export function recommendedWindowMidpointMinutes(activity: SuggestedActivity): number | null {
    const startMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.start || null);
    const endMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.end || null);
    if (startMinutes == null || endMinutes == null) return null;
    if (endMinutes < startMinutes) return null;
    return Math.round((startMinutes + endMinutes) / 2);
}

export function isFullDayDuration(estimatedDuration: string | null | undefined, durationHours: number): boolean {
    if (!estimatedDuration) return durationHours >= MAX_DAY_HOURS;
    const text = estimatedDuration.toLowerCase();
    return text.includes("full day") || text.includes("all day") || durationHours >= MAX_DAY_HOURS;
}

export function getLoadDurationHours(preparedMap: Map<string, PreparedActivity>, activityId: string): number {
    const prepared = preparedMap.get(activityId);
    if (!prepared) return 0;
    return Math.min(prepared.durationHours, prepared.loadDurationHours);
}

export function getPermutations<T>(array: T[]): T[][] {
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

export function slotForHour(hour: number): Exclude<SuggestedActivity["bestTimeOfDay"], "any"> {
    if (hour < 12) return "morning";
    if (hour < 17) return "afternoon";
    return "evening";
}

export function slotDistance(
    a: SuggestedActivity["bestTimeOfDay"],
    b: SuggestedActivity["bestTimeOfDay"]
): number {
    if (a === "any" || b === "any") return 0.8;
    return Math.abs(TIME_ORDER[a] - TIME_ORDER[b]);
}

export function activityPairKey(fromId: string, toId: string): string {
    return `${fromId}->${toId}`;
}
