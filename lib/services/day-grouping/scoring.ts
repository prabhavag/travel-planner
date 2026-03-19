import type {
    SuggestedActivity,
} from "@/lib/models/travel-plan";
import {
    DayStructuralStats,
    PreparedActivity,
    DayCapacityProfile,
    ActivityCommuteMatrix,
    COST_WEIGHTS,
    MAX_DAY_HOURS,
    NEARBY_CLUSTER_MAX_COMMUTE_MINUTES,
    NEARBY_CLUSTER_SQUEEZE_HOURS,
    SOFT_DAY_START_MINUTES,
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
} from "./utils";
import {
    activityCommuteMinutes,
    activityDistanceProxy,
} from "./routing";

export const structuralStatsCache = new Map<string, DayStructuralStats>();

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
                const orderValue = 0; // Simplified for this context
                tieBreaker += orderValue * 1e-4 * i;
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

            if (bestNext) {
                ordered.push(bestNext);
                used.add(bestNext.id);
                current = bestNext;
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
    let underDurationShortfallPenalty = 0;
    const earliestRecommendedMidpointMinutes = activities.reduce<number | null>((earliest, activity) => {
        const midpoint = recommendedWindowMidpointMinutes(activity);
        if (midpoint == null) return earliest;
        return earliest == null ? midpoint : Math.min(earliest, midpoint);
    }, null);
    const softDayStartMinutes =
        earliestRecommendedMidpointMinutes != null
            ? Math.min(SOFT_DAY_START_MINUTES, earliestRecommendedMidpointMinutes)
            : SOFT_DAY_START_MINUTES;
    let currentHour = 0;
    for (const activity of activities) {
        const prepared = preparedMap.get(activity.id);
        if (prepared && activity.isDurationFlexible !== false) {
            const shortfallHours = Math.max(0, prepared.durationHours - prepared.loadDurationHours);
            underDurationShortfallPenalty += shortfallHours * shortfallHours;
        }
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
                : softDayStartMinutes + Math.round(currentHour * 60);
        if (latestRecommendedStartMinutes != null && effectiveStartMinutes > latestRecommendedStartMinutes) {
            recommendedStartMissPenalty += (effectiveStartMinutes - latestRecommendedStartMinutes) / 60;
        }
        currentHour += duration;
    }

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
        longLegPenalty * COST_WEIGHTS.longLeg +
        spreadPenalty * COST_WEIGHTS.spread +
        varietyPenalty * COST_WEIGHTS.variety +
        slotOverflowPenalty * COST_WEIGHTS.slotOverflow +
        slotMismatchPenalty * COST_WEIGHTS.slotMismatch +
        recommendedStartMissPenalty * COST_WEIGHTS.recommendedStartMiss +
        underDurationShortfallPenalty * COST_WEIGHTS.underDurationShortfall;

    const stats = { structuralCost, commuteProxy, totalHours };
    structuralStatsCache.set(cacheKey, stats);
    return stats;
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
    existingDayStats?: DayStructuralStats[]
): number {
    const dayStats =
        existingDayStats ?? computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);

    const totalHours = dayStats.reduce((sum, s) => sum + s.totalHours, 0);
    const totalCapacityWeight = Math.max(0.01, dayCapacities.reduce((sum, profile) => sum + profile.targetWeight, 0));

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
    const maxCommute = Math.max(0, ...dayStats.map((s) => s.commuteProxy));
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
