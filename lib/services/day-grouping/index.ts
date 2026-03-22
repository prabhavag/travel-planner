import type {
    DayGroup,
    GroupedDay,
    SuggestedActivity,
    TripInfo,
} from "@/lib/models/travel-plan";
import {
    WorkingDay,
    PreparedActivity,
    DayCapacityProfile,
    DayBucket,
    MAX_DAY_HOURS,
    ActivityCommuteMatrix,
    TIME_ORDER,
} from "./types";
import {
    parseDurationHours,
    isFullDayDuration,
    getLoadDurationHours,
    activityLoadFactor,
    buildDayCapacityProfiles,
    computeDayCount,
    buildTripDates,
    normalizeType,
    cloneDefaultSlotCapacity,
} from "./utils";
import {
    computeActivityCommuteMatrix,
    orderDayBucketsByProximity,
    computeActivitiesCentroid,
    activityDistanceProxy,
} from "./routing";
import {
    computeAllDayStats,
    getDayStructuralStats,
    computeTotalCost,
    computeTotalCostBreakdown,
} from "./scoring";

export function assignActivityToBestDay({
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
    const initialStats = computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);

    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let index = 0; index < days.length; index += 1) {
        const originalIds = days[index].activityIds;
        const newIds = [...originalIds, activityId];

        const updatedStats = [...initialStats];
        updatedStats[index] = getDayStructuralStats(
            newIds,
            preparedMap,
            commuteMinutesByPair,
            dayCapacities[index] || {
                maxHours: MAX_DAY_HOURS,
                slotCapacity: cloneDefaultSlotCapacity(),
                targetWeight: 1,
            }
        );

        days[index].activityIds = newIds;
        const cost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities, updatedStats);
        days[index].activityIds = originalIds;

        if (cost < bestCost) {
            bestCost = cost;
            bestIndex = index;
        }
    }

    days[bestIndex].activityIds.push(activityId);
}

export function optimizeByMovesAndSwaps(
    days: WorkingDay[],
    preparedMap: Map<string, PreparedActivity>,
    commuteMinutesByPair: ActivityCommuteMatrix,
    dayCapacities: DayCapacityProfile[]
): void {
    const defaultCapacity: DayCapacityProfile = {
        maxHours: MAX_DAY_HOURS,
        slotCapacity: cloneDefaultSlotCapacity(),
        targetWeight: 1,
    };

    let currentStats = computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);
    let currentCost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities, currentStats);

    for (let pass = 0; pass < 4; pass += 1) {
        let improved = false;

        for (let i = 0; i < days.length; i += 1) {
            for (const activityId of [...days[i].activityIds]) {
                if (!days[i].activityIds.includes(activityId)) continue;

                let bestTarget = -1;
                let bestCostForActivity = currentCost;
                let bestStatsForActivity: any[] | null = null;

                const currentDayI = days[i].activityIds;

                for (let j = 0; j < days.length; j += 1) {
                    if (j === i) continue;

                    const currentDayJ = days[j].activityIds;
                    const newDayI = currentDayI.filter((id) => id !== activityId);
                    const newDayJ = [...currentDayJ, activityId];

                    const updatedStats = [...currentStats];
                    updatedStats[i] = getDayStructuralStats(newDayI, preparedMap, commuteMinutesByPair, dayCapacities[i] || defaultCapacity);
                    updatedStats[j] = getDayStructuralStats(newDayJ, preparedMap, commuteMinutesByPair, dayCapacities[j] || defaultCapacity);

                    days[i].activityIds = newDayI;
                    days[j].activityIds = newDayJ;
                    const cost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities, updatedStats);

                    if (cost + 1e-6 < bestCostForActivity) {
                        bestCostForActivity = cost;
                        bestTarget = j;
                        bestStatsForActivity = updatedStats;
                    }

                    days[i].activityIds = currentDayI;
                    days[j].activityIds = currentDayJ;
                }

                if (bestTarget >= 0) {
                    days[i].activityIds = days[i].activityIds.filter((id) => id !== activityId);
                    days[bestTarget].activityIds.push(activityId);
                    currentCost = bestCostForActivity;
                    currentStats = bestStatsForActivity!;
                    improved = true;
                }
            }
        }

        for (let i = 0; i < days.length; i += 1) {
            for (let j = i + 1; j < days.length; j += 1) {
                for (const leftId of [...days[i].activityIds]) {
                    for (const rightId of [...days[j].activityIds]) {
                        const currentDayI = days[i].activityIds;
                        const currentDayJ = days[j].activityIds;

                        const newDayI = currentDayI.map((id) => id === leftId ? rightId : id);
                        const newDayJ = currentDayJ.map((id) => id === rightId ? leftId : id);

                        const updatedStats = [...currentStats];
                        updatedStats[i] = getDayStructuralStats(newDayI, preparedMap, commuteMinutesByPair, dayCapacities[i] || defaultCapacity);
                        updatedStats[j] = getDayStructuralStats(newDayJ, preparedMap, commuteMinutesByPair, dayCapacities[j] || defaultCapacity);

                        days[i].activityIds = newDayI;
                        days[j].activityIds = newDayJ;
                        const cost = computeTotalCost(days, preparedMap, commuteMinutesByPair, dayCapacities, updatedStats);

                        if (cost + 1e-6 < currentCost) {
                            currentCost = cost;
                            currentStats = updatedStats;
                            improved = true;
                        } else {
                            days[i].activityIds = currentDayI;
                            days[j].activityIds = currentDayJ;
                        }
                    }
                }
            }
        }

        if (!improved) break;
    }
}

export function seededActivitySelection(
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

    if (topCategories.length === 1) return `Discovering ${topCategories[0]}`;
    if (topCategories.length === 2) return `${topCategories[0]} & ${topCategories[1]}`;
    return "City Highlights";
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
            .map((id) => activityMap.get(id))
            .filter((activity): activity is SuggestedActivity => activity !== undefined),
        restaurants: [],
        nightStay: group.nightStay ?? null,
        debugCost: group.debugCost ?? null,
    }));
}

export function annotateDayGroupsWithCostDebug({
    dayGroups,
    dayCapacities,
    preparedMap,
    commuteMinutesByPair,
}: {
    dayGroups: DayGroup[];
    dayCapacities: DayCapacityProfile[];
    preparedMap: Map<string, PreparedActivity>;
    commuteMinutesByPair: ActivityCommuteMatrix;
}): DayGroup[] {
    if (dayGroups.length === 0) return dayGroups.map((dayGroup) => ({ ...dayGroup, debugCost: null }));

    const days: WorkingDay[] = dayGroups.map((group) => ({
        activityIds: [...group.activityIds],
    }));
    const dayStats = computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);
    const costBreakdown = computeTotalCostBreakdown(days, preparedMap, commuteMinutesByPair, dayCapacities, dayStats);

    return dayGroups.map((group, index) => {
        const dayBreakdown = costBreakdown.dayBreakdowns[index];
        if (!dayBreakdown) {
            return {
                ...group,
                debugCost: null,
            };
        }

        return {
            ...group,
            debugCost: {
                ...dayBreakdown,
                overallTripCost: costBreakdown.overallCost,
                baseCost: costBreakdown.baseCost,
                commuteImbalancePenalty: costBreakdown.commuteImbalancePenalty,
                nearbySplitPenalty: costBreakdown.nearbySplitPenalty,
                durationMismatchPenalty: costBreakdown.durationMismatchPenalty,
            },
        };
    });
}

export async function groupActivitiesByDay(
    params: { activities: SuggestedActivity[]; tripInfo: TripInfo } | SuggestedActivity[],
    tripInfoArg?: TripInfo
): Promise<DayGroup[]> {
    const activities = Array.isArray(params) ? params : params.activities;
    const tripInfo = Array.isArray(params) ? tripInfoArg : params.tripInfo;
    if (!tripInfo) {
        throw new Error("tripInfo is required for groupActivitiesByDay");
    }

    const dayCount = computeDayCount(tripInfo, activities.length);
    const dates = buildTripDates(tripInfo, dayCount);
    const dayCapacities = buildDayCapacityProfiles(tripInfo, dayCount);
    const commuteMinutesByPair = await computeActivityCommuteMatrix(activities);

    const preparedMap = new Map<string, PreparedActivity>();
    for (const activity of activities) {
        const durationHours = parseDurationHours(activity.estimatedDuration);
        preparedMap.set(activity.id, {
            activity,
            durationHours,
            loadDurationHours: Math.min(durationHours, durationHours * activityLoadFactor(activity)),
            isFullDay: isFullDayDuration(activity.estimatedDuration, durationHours),
        });
    }

    const days: WorkingDay[] = Array.from({ length: dayCount }, () => ({ activityIds: [] }));

    const fixed = activities.filter((a) => a.isFixedStartTime).sort((a, b) => {
        const timeA = a.fixedStartTime || "";
        const timeB = b.fixedStartTime || "";
        return timeA.localeCompare(timeB);
    });

    for (const activity of fixed) {
        assignActivityToBestDay({ days, activityId: activity.id, preparedMap, commuteMinutesByPair, dayCapacities });
    }

    const others = activities.filter((a) => !a.isFixedStartTime);
    for (const activity of others) {
        assignActivityToBestDay({ days, activityId: activity.id, preparedMap, commuteMinutesByPair, dayCapacities });
    }

    optimizeByMovesAndSwaps(days, preparedMap, commuteMinutesByPair, dayCapacities);

    const result: DayGroup[] = days.map((day, i) => {
        const dayActivities = day.activityIds
            .map((id) => preparedMap.get(id)?.activity)
            .filter((a): a is SuggestedActivity => a !== undefined);

        const centroid = computeActivitiesCentroid(dayActivities);

        return {
            dayNumber: i + 1,
            date: dates[i],
            theme: generateDayTheme(dayActivities),
            activityIds: day.activityIds,
            nightStay: {
                label: "Nearby Accommodation",
                coordinates: centroid,
            },
        };
    });

    const buckets: DayBucket[] = result.map((group, i) => ({
        activities: group.activityIds.map(id => preparedMap.get(id)!.activity),
        originalIndex: i
    }));

    const orderedBuckets = orderDayBucketsByProximity(buckets);

    const reorderedDayGroups = orderedBuckets.map((bucket, i) => {
        const group = result[bucket.originalIndex];
        return {
            ...group,
            dayNumber: i + 1,
            date: dates[i]
        };
    });

    return annotateDayGroupsWithCostDebug({
        dayGroups: reorderedDayGroups,
        dayCapacities,
        preparedMap,
        commuteMinutesByPair,
    });
}
