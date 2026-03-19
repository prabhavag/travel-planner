import type {
    SuggestedActivity,
} from "@/lib/models/travel-plan";

export const TIME_ORDER: Record<SuggestedActivity["bestTimeOfDay"], number> = {
    morning: 0,
    afternoon: 1,
    evening: 2,
    any: 3,
};

export const TYPE_THEME_MAP: Record<string, string> = {
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

export const MAX_DAY_HOURS = 8;
export const MAX_OPTIMIZATION_PASSES = 4;
export const EARLY_FIXED_ACTIVITY_LOAD_FACTOR = 0.7;
export const EARLY_FIXED_ACTIVITY_CUTOFF_MINUTES = 7 * 60;
export const SLOT_CAPACITY_HOURS: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> = {
    morning: 4,
    afternoon: 4,
    evening: 3,
};
export const SOFT_DAY_START_MINUTES = 9 * 60 + 30;
export const DEFAULT_DAYLIGHT_END_MINUTES = 18 * 60;

export const COST_WEIGHTS = {
    overflow: 30, // Penalizes total scheduled hours exceeding daily capacity.
    overflowQuadratic: 8, // Escalates cost nonlinearly for heavy overbooking.
    commute: 0.5, // Penalizes total intra-day travel time.
    commuteImbalance: 0.25, // Penalizes uneven commute burden across days.
    longLeg: 1.6, // Penalizes the single longest travel leg in a day.
    spread: 0.8, // Penalizes high average distance between consecutive stops.
    variety: 3, // Penalizes repeating the same activity type within a day.
    slotOverflow: 8, // Penalizes overfilling morning/afternoon/evening slot capacities.
    slotMismatch: 5, // Penalizes assigning activities outside preferred time-of-day slots.
    recommendedStartMiss: 7, // Penalizes starts later than recommended start-window end.
    underDurationShortfall: 2.5, // Penalizes compressing flexible activities below estimated duration.
    daylightViolation: 40, // Strongly penalizes daylight-only activity hours scheduled past daylight end.
    emptySlot: 2.0, // Lightly penalizes unfilled capacity across time-of-day slots.
    balance: 0.7, // Penalizes per-day load variance from weighted target distribution.
    fullDayNearbyOverflowRelief: 9, // Reduces overflow cost when nearby items pair with a full-day anchor.
    fullDayFarPenalty: 3, // Reserved weight for discouraging distant full-day placements.
    nearbySplit: 6, // Penalizes splitting nearby activities across different days.
};

export const NEARBY_CLUSTER_MAX_COMMUTE_MINUTES = 40;
export const NEARBY_CLUSTER_SQUEEZE_HOURS = 1.25;

export interface PreparedActivity {
    activity: SuggestedActivity;
    durationHours: number;
    loadDurationHours: number;
    isFullDay: boolean;
}

export interface WorkingDay {
    activityIds: string[];
}

export interface DayCapacityProfile {
    maxHours: number;
    slotCapacity: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number>;
    targetWeight: number;
    overflowPenaltyMultiplier?: number;
}

export interface DayBucket {
    activities: SuggestedActivity[];
    originalIndex: number;
}

export interface Coordinate {
    lat: number;
    lng: number;
}

export type ActivityCommuteMatrix = Map<string, number>;

export interface DayStructuralStats {
    structuralCost: number;
    commuteProxy: number;
    totalHours: number;
}
