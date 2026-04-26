import type {
    SuggestedActivity,
} from "@/lib/models/travel-plan";
import {
    DayStructuralStats,
    DayCostBreakdown,
    TripCostBreakdown,
    PreparedActivity,
    DayCapacityProfile,
    ActivityCommuteMatrix,
    COST_WEIGHTS,
    MAX_DAY_HOURS,
    NEARBY_CLUSTER_MAX_COMMUTE_MINUTES,
    NEARBY_CLUSTER_SQUEEZE_HOURS,
    SOFT_DAY_START_MINUTES,
    DEFAULT_DAYLIGHT_END_MINUTES,
    EARLY_MORNING_AFTER_HOURS_END_MINUTES,
    NIGHT_AFTER_HOURS_START_MINUTES,
    AFTER_HOURS_DRIVE_MULTIPLIER,
    WorkingDay,
} from "./types";
import {
    getLoadDurationHours,
    slotForHour,
    slotDistance,
    recommendedWindowLatestStartMinutes,
    recommendedWindowMidpointMinutes,
    parseFixedStartTimeMinutes,
    cloneDefaultSlotCapacity,
    getPermutations,
    isFullDayDuration,
    parseDurationHours,
} from "./utils";
import {
    activityCommuteMinutes,
    activityDistanceProxy,
} from "./routing";
import { computePlannableDurationHours } from "@/lib/planning-flags";

export interface ActivityCostDebug {
    kind: "scheduled" | "unscheduled";
    total: number;
    details: string[];
    lines: Array<{
        label: string;
        value: number;
    }>;
}

export function buildPreparedActivityMap<T extends {
    id: string;
    estimatedDuration: string;
    isDurationFlexible?: boolean | null;
}>(activities: T[]): Map<string, PreparedActivity> {
    const preparedMap = new Map<string, PreparedActivity>();
    for (const activity of activities) {
        const durationHours = parseDurationHours(activity.estimatedDuration);
        preparedMap.set(activity.id, {
            activity: activity as unknown as SuggestedActivity,
            durationHours,
            loadDurationHours: computePlannableDurationHours(durationHours, activity.isDurationFlexible),
            isFullDay: isFullDayDuration(activity.estimatedDuration, durationHours),
        });
    }
    return preparedMap;
}

function addActivityCostLine(
    debugById: Record<string, ActivityCostDebug>,
    activityId: string,
    kind: ActivityCostDebug["kind"],
    label: string,
    value: number,
    details: string[]
): void {
    if (!Number.isFinite(value) || value === 0) return;
    const current = debugById[activityId] ?? {
        kind,
        total: 0,
        details,
        lines: [],
    };
    current.kind = kind;
    current.total += value;
    const existingLine = current.lines.find((line) => line.label === label);
    if (existingLine) {
        existingLine.value += value;
    } else {
        current.lines.push({ label, value });
    }
    debugById[activityId] = current;
}

export function computeActivityCostDebug({
    days,
    preparedMap,
    commuteMinutesByPair,
    dayCapacities,
    unassignedActivityIds,
    costBreakdown,
    dayStats,
}: {
    days: WorkingDay[];
    preparedMap: Map<string, PreparedActivity>;
    commuteMinutesByPair: ActivityCommuteMatrix;
    dayCapacities: DayCapacityProfile[];
    unassignedActivityIds: string[];
    costBreakdown?: TripCostBreakdown;
    dayStats?: DayStructuralStats[];
}): Record<string, ActivityCostDebug> {
    const debugById: Record<string, ActivityCostDebug> = {};
    const scheduledHoursByActivity = new Map<string, number>();
    const activityDayIndex = new Map<string, number>();

    const breakdown =
        costBreakdown ?? computeTotalCostBreakdown(days, preparedMap, commuteMinutesByPair, dayCapacities, dayStats);
    const computedDayStats = dayStats ?? computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);

    days.forEach((day, dayIndex) => {
        const scheduledIds = day.activityIds.filter((id) => preparedMap.has(id));
        const totalLoad = scheduledIds.reduce((sum, id) => sum + Math.max(0.01, preparedMap.get(id)?.loadDurationHours ?? 0), 0);
        const totalLoadSafe = totalLoad > 0 ? totalLoad : Math.max(1, scheduledIds.length);
        const dayCost = breakdown.dayBreakdowns[dayIndex]?.dayCost ?? 0;

        for (const activityId of scheduledIds) {
            const prepared = preparedMap.get(activityId);
            if (!prepared) continue;
            activityDayIndex.set(activityId, dayIndex);
            scheduledHoursByActivity.set(
                activityId,
                (scheduledHoursByActivity.get(activityId) ?? 0) + Math.min(prepared.loadDurationHours, prepared.durationHours)
            );
            const share = Math.max(0.01, prepared.loadDurationHours) / totalLoadSafe;
            addActivityCostLine(
                debugById,
                activityId,
                "scheduled",
                "Day cost share",
                dayCost * share,
                ["Server cost attribution for the current scheduled plan."]
            );
        }
    });

    if (breakdown.commuteImbalancePenalty > 0 && computedDayStats.length > 0) {
        const maxCommute = Math.max(...computedDayStats.map((stats) => stats.commuteProxy));
        const maxCommuteDayIndexes = computedDayStats
            .map((stats, index) => ({ stats, index }))
            .filter((entry) => entry.stats.commuteProxy === maxCommute)
            .map((entry) => entry.index);
        const maxCommuteActivityIds = maxCommuteDayIndexes.flatMap((dayIndex) =>
            (days[dayIndex]?.activityIds ?? []).filter((id) => preparedMap.has(id))
        );
        const totalLoad = maxCommuteActivityIds.reduce(
            (sum, id) => sum + Math.max(0.01, preparedMap.get(id)?.loadDurationHours ?? 0),
            0
        );
        const totalLoadSafe = totalLoad > 0 ? totalLoad : Math.max(1, maxCommuteActivityIds.length);
        for (const activityId of maxCommuteActivityIds) {
            const prepared = preparedMap.get(activityId);
            if (!prepared) continue;
            addActivityCostLine(
                debugById,
                activityId,
                "scheduled",
                "Commute imbalance",
                breakdown.commuteImbalancePenalty * (Math.max(0.01, prepared.loadDurationHours) / totalLoadSafe),
                ["Server cost attribution for the current scheduled plan."]
            );
        }
    }

    const preparedEntries = Array.from(preparedMap.values());
    for (let i = 0; i < preparedEntries.length; i += 1) {
        for (let j = i + 1; j < preparedEntries.length; j += 1) {
            const left = preparedEntries[i];
            const right = preparedEntries[j];
            const leftDay = activityDayIndex.get(left.activity.id);
            const rightDay = activityDayIndex.get(right.activity.id);
            if (leftDay == null || rightDay == null || leftDay === rightDay) continue;

            const commuteMinutes = activityCommuteMinutes(left.activity, right.activity, commuteMinutesByPair);
            if (commuteMinutes > NEARBY_CLUSTER_MAX_COMMUTE_MINUTES) continue;

            const leftProfile = dayCapacities[leftDay];
            const rightProfile = dayCapacities[rightDay];
            const leftTotalIfMerged = (computedDayStats[leftDay]?.totalHours ?? 0) + right.loadDurationHours;
            const rightTotalIfMerged = (computedDayStats[rightDay]?.totalHours ?? 0) + left.loadDurationHours;
            const squeezableOnEitherDay =
                (leftProfile && leftTotalIfMerged <= leftProfile.maxHours + NEARBY_CLUSTER_SQUEEZE_HOURS) ||
                (rightProfile && rightTotalIfMerged <= rightProfile.maxHours + NEARBY_CLUSTER_SQUEEZE_HOURS);
            if (!squeezableOnEitherDay) continue;

            const proximity = (NEARBY_CLUSTER_MAX_COMMUTE_MINUTES - commuteMinutes) / NEARBY_CLUSTER_MAX_COMMUTE_MINUTES;
            const pairPenalty = proximity * (left.loadDurationHours + right.loadDurationHours) * 0.5 * COST_WEIGHTS.nearbySplit;
            addActivityCostLine(
                debugById,
                left.activity.id,
                "scheduled",
                "Nearby split",
                pairPenalty / 2,
                ["Server cost attribution for the current scheduled plan."]
            );
            addActivityCostLine(
                debugById,
                right.activity.id,
                "scheduled",
                "Nearby split",
                pairPenalty / 2,
                ["Server cost attribution for the current scheduled plan."]
            );
        }
    }

    const unassignedSet = new Set(unassignedActivityIds);
    for (const [activityId, prepared] of preparedMap.entries()) {
        const recommendedHours = Math.max(0, prepared.durationHours);
        const scheduledHours = Math.max(0, scheduledHoursByActivity.get(activityId) ?? 0);
        const underscheduledHours = Math.max(0, recommendedHours - scheduledHours);
        if (underscheduledHours <= 0) continue;
        const durationMismatch =
            underscheduledHours * COST_WEIGHTS.underDurationShortfallLinear +
            underscheduledHours * underscheduledHours * COST_WEIGHTS.underDurationShortfallQuadratic;
        const kind = unassignedSet.has(activityId) ? "unscheduled" : "scheduled";
        addActivityCostLine(
            debugById,
            activityId,
            kind,
            "Duration mismatch",
            durationMismatch,
            kind === "unscheduled"
                ? ["Server cost for an unassigned activity: recommended duration is currently unscheduled."]
                : ["Server cost attribution for the current scheduled plan."]
        );
    }

    for (const activityId of preparedMap.keys()) {
        if (debugById[activityId]) continue;
        const kind = unassignedSet.has(activityId) ? "unscheduled" : "scheduled";
        debugById[activityId] = {
            kind,
            total: 0,
            details:
                kind === "unscheduled"
                    ? ["Server cost for an unassigned activity: no nonzero penalty is currently attributed."]
                    : ["Server cost attribution for the current scheduled plan: no nonzero penalty is currently attributed."],
            lines: [],
        };
    }

    for (const value of Object.values(debugById)) {
        value.total = value.lines.reduce((sum, line) => sum + line.value, 0);
    }

    return debugById;
}

function computeAfterHoursMinutes(startMinutes: number, endMinutes: number): number {
    if (endMinutes <= startMinutes) return 0;

    const earlyMorningMinutes = Math.max(
        0,
        Math.min(endMinutes, EARLY_MORNING_AFTER_HOURS_END_MINUTES) - startMinutes
    );
    const nightMinutes = Math.max(0, endMinutes - Math.max(startMinutes, NIGHT_AFTER_HOURS_START_MINUTES));
    return earlyMorningMinutes + nightMinutes;
}

export function computeDayCommuteProxy(
    activities: SuggestedActivity[],
    commuteMinutesByPair: ActivityCommuteMatrix
): number {
    if (activities.length <= 1) return 0;
    let sum = 0;
    for (let i = 1; i < activities.length; i += 1) {
        sum += activityCommuteMinutes(activities[i - 1], activities[i], commuteMinutesByPair);
    }
    return sum;
}

export function buildOptimalDayRoute(
    activities: SuggestedActivity[],
    preparedMap: Map<string, PreparedActivity>,
    commuteMinutesByPair: ActivityCommuteMatrix
): SuggestedActivity[] {
    if (activities.length <= 1) return [...activities];

    const FIXED_START_MISS_WEIGHT = COST_WEIGHTS.daylightViolation * 2;

    const computeRouteOrderingCost = (route: SuggestedActivity[]): number => {
        const earliestRecommendedMidpointMinutes = route.reduce<number | null>((earliest, activity) => {
            const midpoint = recommendedWindowMidpointMinutes(activity);
            if (midpoint == null) return earliest;
            return earliest == null ? midpoint : Math.min(earliest, midpoint);
        }, null);
        let cursorMinutes =
            earliestRecommendedMidpointMinutes != null
                ? Math.min(SOFT_DAY_START_MINUTES, earliestRecommendedMidpointMinutes)
                : SOFT_DAY_START_MINUTES;
        let cost = 0;

        for (let i = 0; i < route.length; i += 1) {
            const activity = route[i];
            if (i > 0) {
                const commuteMinutes = activityCommuteMinutes(route[i - 1], activity, commuteMinutesByPair);
                cost += commuteMinutes * COST_WEIGHTS.commute;
                cursorMinutes += commuteMinutes;
            }

            const loadDuration = getLoadDurationHours(preparedMap, activity.id);
            const durationMinutes = Math.round(loadDuration * 60);
            const fixedStartMinutes = activity.isFixedStartTime
                ? parseFixedStartTimeMinutes(activity.fixedStartTime || null)
                : null;
            const activityStartMinutes =
                fixedStartMinutes != null
                    ? Math.max(cursorMinutes, fixedStartMinutes)
                    : cursorMinutes;
            const activityEndMinutes = activityStartMinutes + durationMinutes;
            const activityMidpointHour = (activityStartMinutes + durationMinutes / 2) / 60;
            const assignedSlot = slotForHour(activityMidpointHour);

            if (activity.bestTimeOfDay !== "any") {
                cost += slotDistance(activity.bestTimeOfDay, assignedSlot) * loadDuration * COST_WEIGHTS.slotMismatch;
            }

            if (fixedStartMinutes != null && cursorMinutes > fixedStartMinutes) {
                cost += ((cursorMinutes - fixedStartMinutes) / 60) * FIXED_START_MISS_WEIGHT;
            }

            const recommendedWindowStartMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.start || null);
            const recommendedWindowEndMinutes = recommendedWindowLatestStartMinutes(activity);
            if (recommendedWindowStartMinutes != null && activityStartMinutes < recommendedWindowStartMinutes) {
                cost += ((recommendedWindowStartMinutes - activityStartMinutes) / 60) * COST_WEIGHTS.recommendedStartMiss;
            } else if (recommendedWindowEndMinutes != null && activityStartMinutes > recommendedWindowEndMinutes) {
                cost += ((activityStartMinutes - recommendedWindowEndMinutes) / 60) * COST_WEIGHTS.recommendedStartMiss;
            }

            if (activity.daylightPreference === "daylight_only") {
                cost += Math.max(0, (activityEndMinutes - DEFAULT_DAYLIGHT_END_MINUTES) / 60) * COST_WEIGHTS.daylightViolation;
            }

            cursorMinutes = activityEndMinutes;
        }

        return cost;
    };

    if (activities.length <= 6) {
        const perms = getPermutations(activities);
        let bestCost = Number.POSITIVE_INFINITY;
        let bestRoute = [...activities];

        for (const route of perms) {
            const totalCost = computeRouteOrderingCost(route);

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
        ordered.push(activities[startIndex]);
        used.add(activities[startIndex].id);

        while (ordered.length < activities.length) {
            let bestNext: SuggestedActivity | null = null;
            let bestNextCost = Number.POSITIVE_INFINITY;

            for (const candidate of activities) {
                if (used.has(candidate.id)) continue;
                const candidateRoute = [...ordered, candidate];
                const candidateCost = computeRouteOrderingCost(candidateRoute);
                if (candidateCost < bestNextCost) {
                    bestNextCost = candidateCost;
                    bestNext = candidate;
                }
            }

            if (bestNext) {
                ordered.push(bestNext);
                used.add(bestNext.id);
            } else {
                break;
            }
        }

        let totalDist = 0;
        for (let i = 1; i < ordered.length; i += 1) {
            totalDist += activityCommuteMinutes(ordered[i - 1], ordered[i], commuteMinutesByPair);
        }
        if (totalDist < bestDistance) {
            bestDistance = totalDist;
            bestOrder = ordered;
        }
    }

    return bestOrder;
}

export function getDayStructuralStats(
    activityIds: string[],
    preparedMap: Map<string, PreparedActivity>,
    commuteMinutesByPair: ActivityCommuteMatrix,
    dayCapacity: DayCapacityProfile
): DayStructuralStats {
    if (activityIds.length === 0) {
        return { structuralCost: 0, commuteProxy: 0, totalHours: 0 };
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
    let daylightViolationHours = 0;
    const assignedSlotHours: Record<Exclude<SuggestedActivity["bestTimeOfDay"], "any">, number> = {
        morning: 0,
        afternoon: 0,
        evening: 0,
    };
    const earliestRecommendedMidpointMinutes = activities.reduce<number | null>((earliest, activity) => {
        const midpoint = recommendedWindowMidpointMinutes(activity);
        if (midpoint == null) return earliest;
        return earliest == null ? midpoint : Math.min(earliest, midpoint);
    }, null);
    const softDayStartMinutes =
        earliestRecommendedMidpointMinutes != null
            ? Math.min(SOFT_DAY_START_MINUTES, earliestRecommendedMidpointMinutes)
            : SOFT_DAY_START_MINUTES;
    let afterHoursCommuteMinutes = 0;
    let timelineCursorMinutes = softDayStartMinutes;
    for (let i = 0; i < activities.length; i += 1) {
        const activity = activities[i];
        const durationMinutes = Math.round(getLoadDurationHours(preparedMap, activity.id) * 60);
        const fixedStartMinutes = activity.isFixedStartTime
            ? parseFixedStartTimeMinutes(activity.fixedStartTime || null)
            : null;
        const activityStartMinutes =
            fixedStartMinutes != null
                ? Math.max(timelineCursorMinutes, fixedStartMinutes)
                : timelineCursorMinutes;
        const activityEndMinutes = activityStartMinutes + durationMinutes;

        if (i < activities.length - 1) {
            const commuteMinutes = activityCommuteMinutes(activity, activities[i + 1], commuteMinutesByPair);
            const commuteStartMinutes = activityEndMinutes;
            const commuteEndMinutes = commuteStartMinutes + commuteMinutes;
            afterHoursCommuteMinutes += computeAfterHoursMinutes(commuteStartMinutes, commuteEndMinutes);
            timelineCursorMinutes = commuteEndMinutes;
        } else {
            timelineCursorMinutes = activityEndMinutes;
        }
    }
    let timingCursorMinutes = softDayStartMinutes;
    for (let i = 0; i < activities.length; i += 1) {
        const activity = activities[i];
        const duration = getLoadDurationHours(preparedMap, activity.id);
        const durationMinutes = Math.round(duration * 60);
        const fixedStartMinutes = activity.isFixedStartTime
            ? parseFixedStartTimeMinutes(activity.fixedStartTime || null)
            : null;
        const effectiveStartMinutes =
            fixedStartMinutes != null
                ? Math.max(timingCursorMinutes, fixedStartMinutes)
                : timingCursorMinutes;
        const activityEndMinutes = effectiveStartMinutes + durationMinutes;
        const activityMidpointHour = (effectiveStartMinutes + durationMinutes / 2) / 60;
        const assignedSlot = slotForHour(activityMidpointHour);

        assignedSlotHours[assignedSlot] += duration;
        if (activity.bestTimeOfDay !== "any") {
            slotMismatchPenalty += slotDistance(activity.bestTimeOfDay, assignedSlot) * duration;
        }

        const recommendedWindowStartMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.start || null);
        const recommendedWindowEndMinutes = recommendedWindowLatestStartMinutes(activity);
        if (recommendedWindowStartMinutes != null && effectiveStartMinutes < recommendedWindowStartMinutes) {
            recommendedStartMissPenalty += (recommendedWindowStartMinutes - effectiveStartMinutes) / 60;
        } else if (recommendedWindowEndMinutes != null && effectiveStartMinutes > recommendedWindowEndMinutes) {
            recommendedStartMissPenalty += (effectiveStartMinutes - recommendedWindowEndMinutes) / 60;
        }

        if (activity.daylightPreference === "daylight_only") {
            daylightViolationHours += Math.max(0, (activityEndMinutes - DEFAULT_DAYLIGHT_END_MINUTES) / 60);
        }

        if (i < activities.length - 1) {
            const commuteMinutes = activityCommuteMinutes(activity, activities[i + 1], commuteMinutesByPair);
            timingCursorMinutes = activityEndMinutes + commuteMinutes;
        } else {
            timingCursorMinutes = activityEndMinutes;
        }
    }

    const emptySlotHours = (Object.keys(dayCapacity.slotCapacity) as Array<keyof typeof dayCapacity.slotCapacity>).reduce(
        (sum, slot) => sum + Math.max(0, dayCapacity.slotCapacity[slot] - assignedSlotHours[slot]),
        0
    );

    const overflow = Math.max(0, totalHours - dayCapacity.maxHours);
    const overflowPenaltyMultiplier = dayCapacity.overflowPenaltyMultiplier ?? 1;
    const fullDayActivities = activities.filter((activity) => preparedMap.get(activity.id)?.isFullDay);
    let overflowPenalty =
        (overflow * COST_WEIGHTS.overflow + overflow * overflow * COST_WEIGHTS.overflowQuadratic) *
        overflowPenaltyMultiplier;

    if (fullDayActivities.length > 0) {
        let nearbyWeightedHours = 0;
        for (const activity of activities) {
            if (preparedMap.get(activity.id)?.isFullDay) continue;
            const duration = getLoadDurationHours(preparedMap, activity.id);
            let minDistance = Number.POSITIVE_INFINITY;
            for (const fullDayActivity of fullDayActivities) {
                minDistance = Math.min(minDistance, activityDistanceProxy(activity, fullDayActivity));
            }
            const proximityScore = 1 / (1 + minDistance);
            nearbyWeightedHours += duration * proximityScore;
        }
        overflowPenalty = Math.max(0, overflowPenalty - nearbyWeightedHours * COST_WEIGHTS.fullDayNearbyOverflowRelief);
    }

    const structuralCost =
        overflowPenalty +
        commuteProxy * COST_WEIGHTS.commute +
        afterHoursCommuteMinutes * COST_WEIGHTS.commute * Math.max(0, AFTER_HOURS_DRIVE_MULTIPLIER - 1) +
        longLegPenalty * COST_WEIGHTS.longLeg +
        spreadPenalty * COST_WEIGHTS.spread +
        varietyPenalty * COST_WEIGHTS.variety +
        slotOverflowPenalty * COST_WEIGHTS.slotOverflow +
        slotMismatchPenalty * COST_WEIGHTS.slotMismatch +
        recommendedStartMissPenalty * COST_WEIGHTS.recommendedStartMiss +
        daylightViolationHours * COST_WEIGHTS.daylightViolation +
        emptySlotHours * COST_WEIGHTS.emptySlot;

    return { structuralCost, commuteProxy, totalHours };
}

export function computeAllDayStats(
    days: WorkingDay[],
    preparedMap: Map<string, PreparedActivity>,
    commuteMinutesByPair: ActivityCommuteMatrix,
    dayCapacities: DayCapacityProfile[]
): DayStructuralStats[] {
    return days.map((day, i) =>
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
}

export function computeTotalCost(
    days: WorkingDay[],
    preparedMap: Map<string, PreparedActivity>,
    commuteMinutesByPair: ActivityCommuteMatrix,
    dayCapacities: DayCapacityProfile[],
    existingDayStats?: DayStructuralStats[],
    scheduledHoursByActivityOverride?: Map<string, number>
): number {
    return computeTotalCostBreakdown(
        days,
        preparedMap,
        commuteMinutesByPair,
        dayCapacities,
        existingDayStats,
        scheduledHoursByActivityOverride
    ).overallCost;
}

export function computeTotalCostBreakdown(
    days: WorkingDay[],
    preparedMap: Map<string, PreparedActivity>,
    commuteMinutesByPair: ActivityCommuteMatrix,
    dayCapacities: DayCapacityProfile[],
    existingDayStats?: DayStructuralStats[],
    scheduledHoursByActivityOverride?: Map<string, number>
): TripCostBreakdown {
    const dayStats =
        existingDayStats ?? computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);

    const totalHours = dayStats.reduce((sum, s) => sum + s.totalHours, 0);
    const totalCapacityWeight = Math.max(0.01, dayCapacities.reduce((sum, profile) => sum + profile.targetWeight, 0));

    const dayBreakdowns: DayCostBreakdown[] = dayStats.map((s, i) => {
        const profile = dayCapacities[i] || {
            maxHours: MAX_DAY_HOURS,
            slotCapacity: cloneDefaultSlotCapacity(),
            targetWeight: 1,
        };
        const normalizedWeight =
            totalCapacityWeight > 0 ? profile.targetWeight / totalCapacityWeight : 1 / Math.max(1, days.length);
        const targetHours = Math.min(profile.maxHours, totalHours * normalizedWeight);
        const balancePenalty = Math.abs(s.totalHours - targetHours) * COST_WEIGHTS.balance;
        return {
            structuralCost: s.structuralCost,
            balancePenalty,
            dayCost: s.structuralCost + balancePenalty,
            commuteProxy: s.commuteProxy,
            totalHours: s.totalHours,
        };
    });

    const baseCost = dayBreakdowns.reduce((sum, breakdown) => sum + breakdown.dayCost, 0);

    const totalCommute = dayStats.reduce((sum, s) => sum + s.commuteProxy, 0);
    const avgCommute = totalCommute / Math.max(1, dayStats.length);
    const maxCommute = Math.max(0, ...dayStats.map((s) => s.commuteProxy));
    const commuteImbalancePenalty = Math.max(0, maxCommute - avgCommute) * COST_WEIGHTS.commuteImbalance;

    const activityDayIndex = new Map<string, number>();
    const scheduledHoursByActivity = new Map<string, number>();
    days.forEach((day, dayIndex) => {
        day.activityIds.forEach((id) => {
            activityDayIndex.set(id, dayIndex);
            const prepared = preparedMap.get(id);
            if (!prepared) return;
            const overrideHours = scheduledHoursByActivityOverride?.get(id);
            const scheduledHours = overrideHours != null
                ? Math.max(0, Math.min(overrideHours, prepared.durationHours))
                : Math.min(prepared.loadDurationHours, prepared.durationHours);
            scheduledHoursByActivity.set(id, (scheduledHoursByActivity.get(id) ?? 0) + scheduledHours);
        });
    });

    let durationMismatchPenalty = 0;
    for (const [activityId, prepared] of preparedMap.entries()) {
        const recommendedHours = Math.max(0, prepared.durationHours);
        const scheduledHours = Math.max(0, scheduledHoursByActivity.get(activityId) ?? 0);
        const underscheduledHours = Math.max(0, recommendedHours - scheduledHours);
        durationMismatchPenalty +=
            underscheduledHours * COST_WEIGHTS.underDurationShortfallLinear +
            underscheduledHours * underscheduledHours * COST_WEIGHTS.underDurationShortfallQuadratic;
    }

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

    return {
        overallCost:
        baseCost +
        commuteImbalancePenalty +
        nearbySplitPenalty * COST_WEIGHTS.nearbySplit +
        durationMismatchPenalty,
        baseCost,
        commuteImbalancePenalty,
        nearbySplitPenalty: nearbySplitPenalty * COST_WEIGHTS.nearbySplit,
        durationMismatchPenalty,
        dayBreakdowns,
    };
}
