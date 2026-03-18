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

export const COST_WEIGHTS = {
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
