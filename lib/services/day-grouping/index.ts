import type {
    DayGroup,
    GroupedDay,
    SuggestedActivity,
    TimelineItem,
    TripInfo,
} from "@/lib/models/travel-plan";
import {
    WorkingDay,
    PreparedActivity,
    DayCapacityProfile,
    DayBucket,
    MAX_DAY_HOURS,
    SOFT_DAY_START_MINUTES,
    DEFAULT_DAYLIGHT_END_MINUTES,
    NIGHT_AFTER_HOURS_START_MINUTES,
    ActivityCommuteMatrix,
    TIME_ORDER,
} from "./types";
import {
    buildDayCapacityProfiles,
    computeDayCount,
    buildTripDates,
    normalizeType,
    cloneDefaultSlotCapacity,
    parseFixedStartTimeMinutes,
    recommendedWindowLatestStartMinutes,
} from "./utils";
import {
    activityCommuteMinutes,
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
    buildPreparedActivityMap,
    computeActivityCostDebug,
    type ActivityCostDebug,
} from "./scoring";

export interface ScheduleState {
    dayGroups: DayGroup[];
    groupedDays: GroupedDay[];
    unassignedActivityIds: string[];
    activityCostDebugById: Record<string, ActivityCostDebug>;
}

export interface BuildScoredScheduleOptions {
    forceSchedule?: boolean;
    tripInfo?: TripInfo;
}

function isDaylightOnlyActivity(activity: SuggestedActivity): boolean {
    const flags = activity as SuggestedActivity & {
        daylightOnly?: boolean;
        daytimeOnly?: boolean;
        isDaylightOnly?: boolean;
        isDaytimeOnly?: boolean;
    };
    if (flags.daylightOnly || flags.daytimeOnly || flags.isDaylightOnly || flags.isDaytimeOnly) return true;
    if (activity.daylightPreference === "daylight_only") return true;
    const text = `${activity.name} ${activity.type} ${(activity.interestTags || []).join(" ")}`.toLowerCase();
    return /(snorkel|snorkeling|scuba|dive|surf|kayak|paddle|canoe|boat tour|hike|hiking|trail|outdoor|national park|waterfall|beach)/i.test(text);
}

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
    timelineItemsByDayNumber,
}: {
    dayGroups: DayGroup[];
    activities: SuggestedActivity[];
    timelineItemsByDayNumber?: Record<number, TimelineItem[]>;
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
        timelineItems: timelineItemsByDayNumber?.[group.dayNumber] ?? [],
    }));
}

function formatClockLabel(minutes: number): string {
    const normalized = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    return minute === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(startMinutes: number, endMinutes: number): string {
    return `${formatClockLabel(startMinutes)}-${formatClockLabel(endMinutes)}`;
}

function formatHoursLabel(hours: number): string {
    const roundedMinutes = Math.round(hours * 60);
    if (roundedMinutes % 60 === 0) return `${roundedMinutes / 60} hr`;
    if (roundedMinutes > 60) return `${Math.floor(roundedMinutes / 60)} hr ${roundedMinutes % 60} min`;
    return `${roundedMinutes} min`;
}

function buildScheduleTimelineItems({
    dayGroups,
    preparedMap,
    commuteMinutesByPair,
    dayCapacities,
    tripInfo,
}: {
    dayGroups: DayGroup[];
    preparedMap: Map<string, PreparedActivity>;
    commuteMinutesByPair: ActivityCommuteMatrix;
    dayCapacities: DayCapacityProfile[];
    tripInfo?: TripInfo;
}): Record<number, TimelineItem[]> {
    const timelineItemsByDayNumber: Record<number, TimelineItem[]> = {};

    dayGroups.forEach((day, dayIndex) => {
        const capacity = dayCapacities[dayIndex] ?? {
            maxHours: MAX_DAY_HOURS,
            slotCapacity: cloneDefaultSlotCapacity(),
            targetWeight: 1,
        };
        const dayStartMinutes =
            capacity.maxHours < MAX_DAY_HOURS
                ? Math.max(SOFT_DAY_START_MINUTES, DEFAULT_DAYLIGHT_END_MINUTES - Math.round(capacity.maxHours * 60))
                : SOFT_DAY_START_MINUTES;
        let cursorMinutes = dayStartMinutes;
        let lunchInserted = false;
        let scheduledMinutes = 0;
        const items: TimelineItem[] = [];

        if (dayIndex === 0) {
            const arrivalTime = tripInfo?.arrivalTimePreference || "12:00 PM";
            const arrivalAirport = tripInfo?.arrivalAirport || "airport";
            const arrivalMinutes = parseFixedStartTimeMinutes(arrivalTime) ?? 12 * 60;
            const transferMinutes = 45;
            items.push({
                type: "stay",
                id: `arrival-${day.dayNumber}`,
                title: `Arrive at airport (${arrivalTime})`,
                detail: arrivalAirport,
            });
            items.push({
                type: "commute",
                id: `airport-transfer-${day.dayNumber}`,
                title: "Airport transfer",
                detail: `Estimated transfer ~${transferMinutes} min`,
                timeRange: formatTimeRange(arrivalMinutes, arrivalMinutes + transferMinutes),
            });
            items.push({
                type: "stay",
                id: `checkin-${day.dayNumber}`,
                title: "Hotel check-in",
                detail: day.nightStay?.label || "At your stay",
            });
            cursorMinutes = Math.max(cursorMinutes, arrivalMinutes + transferMinutes);
        } else if (day.nightStay?.label) {
            items.push({
                type: "stay",
                id: `stay-start-${day.dayNumber}`,
                title: "Start from stay",
                detail: day.nightStay.label,
            });
        }

        day.activityIds.forEach((activityId, index) => {
            const prepared = preparedMap.get(activityId);
            const activity = prepared?.activity;
            if (!prepared || !activity) return;

            if (!lunchInserted && cursorMinutes >= 12 * 60) {
                const lunchStart = cursorMinutes;
                const lunchEnd = lunchStart + 60;
                items.push({
                    type: "lunch",
                    id: `lunch-${day.dayNumber}`,
                    title: "Lunch break",
                    detail: "About 1 hr",
                    timeRange: formatTimeRange(lunchStart, lunchEnd),
                });
                cursorMinutes = lunchEnd;
                lunchInserted = true;
            }

            const fixedStart = parseFixedStartTimeMinutes(activity.fixedStartTime || null);
            const startMinutes = fixedStart != null ? Math.max(cursorMinutes, fixedStart) : cursorMinutes;
            const durationMinutes = Math.round(prepared.loadDurationHours * 60);
            const endMinutes = startMinutes + durationMinutes;
            const warnings: string[] = [];
            if (fixedStart != null && cursorMinutes > fixedStart) {
                warnings.push(`Fixed start conflict: earliest available start is ${formatClockLabel(cursorMinutes)}.`);
            }
            const latestRecommendedStart = recommendedWindowLatestStartMinutes(activity);
            if (latestRecommendedStart != null && startMinutes > latestRecommendedStart) {
                warnings.push(`Late-start risk: recommended by ${formatClockLabel(latestRecommendedStart)}.`);
            }
            if (activity.daylightPreference === "daylight_only" && endMinutes > DEFAULT_DAYLIGHT_END_MINUTES) {
                warnings.push(`Daylight warning: finishes after ${formatClockLabel(DEFAULT_DAYLIGHT_END_MINUTES)}.`);
            }
            const dayEndMinutes = dayStartMinutes + Math.round(capacity.maxHours * 60);
            if (endMinutes > dayEndMinutes) {
                warnings.push(`Over capacity: scheduled past ${formatClockLabel(dayEndMinutes)}.`);
            }

            items.push({
                type: "activity",
                id: `activity-${activity.id}`,
                activityId: activity.id,
                title: activity.name,
                detail: warnings.join(" "),
                timeRange: formatTimeRange(startMinutes, endMinutes),
                affordLabel: `Spend up to ${formatHoursLabel(prepared.loadDurationHours)} here${warnings.length > 0 ? ` • ${warnings.join(" ")}` : ""}`,
            });
            scheduledMinutes += Math.max(0, endMinutes - startMinutes);
            cursorMinutes = endMinutes;

            const nextPrepared = day.activityIds[index + 1] ? preparedMap.get(day.activityIds[index + 1]) : null;
            if (nextPrepared) {
                const commuteMinutes = activityCommuteMinutes(activity, nextPrepared.activity, commuteMinutesByPair);
                const commuteStart = cursorMinutes;
                const commuteEnd = commuteStart + Math.round(commuteMinutes);
                items.push({
                    type: "commute",
                    id: `commute-${activity.id}-${nextPrepared.activity.id}`,
                    title: "Commute",
                    detail: `Estimated travel ~${Math.round(commuteMinutes)} min`,
                    timeRange: formatTimeRange(commuteStart, commuteEnd),
                });
                cursorMinutes = commuteEnd;
            }
        });

        const capacityMinutes = Math.round(capacity.maxHours * 60);
        if (scheduledMinutes > capacityMinutes) {
            items.unshift({
                type: "warning",
                id: `overload-${day.dayNumber}`,
                title: "Schedule warning",
                detail: `Server scored this as overloaded: ${formatHoursLabel(scheduledMinutes / 60)} scheduled vs ${formatHoursLabel(capacity.maxHours)} capacity.`,
                timeRange: "Warning",
            });
        }
        if (!lunchInserted && day.activityIds.length > 0) {
            const lunchStart = Math.max(cursorMinutes, 12 * 60);
            items.push({
                type: "lunch",
                id: `lunch-${day.dayNumber}`,
                title: "Lunch break",
                detail: "About 1 hr",
                timeRange: formatTimeRange(lunchStart, lunchStart + 60),
            });
        }
        if (day.nightStay?.label) {
            items.push({
                type: "stay",
                id: `stay-end-${day.dayNumber}`,
                title: "End at night stay",
                detail: day.nightStay.label,
            });
        }

        timelineItemsByDayNumber[day.dayNumber] = items;
    });

    return timelineItemsByDayNumber;
}

export function annotateDayGroupsWithCostDebug({
    dayGroups,
    dayCapacities,
    preparedMap,
    commuteMinutesByPair,
    scheduledHoursByActivityOverride,
}: {
    dayGroups: DayGroup[];
    dayCapacities: DayCapacityProfile[];
    preparedMap: Map<string, PreparedActivity>;
    commuteMinutesByPair: ActivityCommuteMatrix;
    scheduledHoursByActivityOverride?: Map<string, number>;
}): DayGroup[] {
    if (dayGroups.length === 0) return dayGroups.map((dayGroup) => ({ ...dayGroup, debugCost: null }));

    const days: WorkingDay[] = dayGroups.map((group) => ({
        activityIds: [...group.activityIds],
    }));
    const dayStats = computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);
    const costBreakdown = computeTotalCostBreakdown(
        days,
        preparedMap,
        commuteMinutesByPair,
        dayCapacities,
        dayStats,
        scheduledHoursByActivityOverride
    );

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

export function buildScoredSchedule({
    dayGroups,
    activities,
    unassignedActivityIds,
    dayCapacities,
    preparedMap,
    commuteMinutesByPair,
    options,
}: {
    dayGroups: DayGroup[];
    activities: SuggestedActivity[];
    unassignedActivityIds: string[];
    dayCapacities: DayCapacityProfile[];
    preparedMap: Map<string, PreparedActivity>;
    commuteMinutesByPair: ActivityCommuteMatrix;
    options?: BuildScoredScheduleOptions;
}): ScheduleState {
    const forceSchedule = options?.forceSchedule ?? false;
    const tripInfo = options?.tripInfo;
    const validActivityIds = new Set(activities.map((activity) => activity.id));
    const activityById = new Map(activities.map((activity) => [activity.id, activity]));
    const explicitUnassignedIds = new Set(
        unassignedActivityIds.filter((id) => validActivityIds.has(id))
    );
    const seenScheduledIds = new Set<string>();
    const normalizedDayGroups = dayGroups.map((group) => ({
        ...group,
        activityIds: group.activityIds.filter((id) => {
            if (!validActivityIds.has(id) || explicitUnassignedIds.has(id) || seenScheduledIds.has(id)) return false;
            seenScheduledIds.add(id);
            return true;
        }),
    }));
    const normalizedUnassignedActivityIds: string[] = [];
    const seenUnassignedIds = new Set<string>();
    for (const id of unassignedActivityIds) {
        if (!validActivityIds.has(id) || seenUnassignedIds.has(id)) continue;
        seenUnassignedIds.add(id);
        normalizedUnassignedActivityIds.push(id);
    }
    for (const activity of activities) {
        if (seenScheduledIds.has(activity.id) || seenUnassignedIds.has(activity.id)) continue;
        seenUnassignedIds.add(activity.id);
        normalizedUnassignedActivityIds.push(activity.id);
    }

    if (!forceSchedule) {
        normalizedDayGroups.forEach((day, dayIndex) => {
            const capacity = dayCapacities[dayIndex];
            const dayStartMinutes =
                capacity && capacity.maxHours < MAX_DAY_HOURS
                    ? Math.max(SOFT_DAY_START_MINUTES, NIGHT_AFTER_HOURS_START_MINUTES - Math.round(capacity.maxHours * 60))
                    : SOFT_DAY_START_MINUTES;
            let cursorMinutes = dayStartMinutes;
            const keptActivityIds: string[] = [];
            for (const activityId of day.activityIds) {
                const activity = activityById.get(activityId);
                const prepared = preparedMap.get(activityId);
                if (!activity || !prepared) continue;
                const durationMinutes = Math.round(prepared.loadDurationHours * 60);
                const endMinutes = cursorMinutes + durationMinutes;
                if (isDaylightOnlyActivity(activity) && endMinutes > DEFAULT_DAYLIGHT_END_MINUTES) {
                    if (!seenUnassignedIds.has(activityId)) {
                        seenUnassignedIds.add(activityId);
                        normalizedUnassignedActivityIds.push(activityId);
                    }
                    seenScheduledIds.delete(activityId);
                    continue;
                }
                keptActivityIds.push(activityId);
                cursorMinutes = endMinutes;
            }
            day.activityIds = keptActivityIds;
        });
    }

    const days: WorkingDay[] = normalizedDayGroups.map((group) => ({ activityIds: [...group.activityIds] }));
    const dayStats = computeAllDayStats(days, preparedMap, commuteMinutesByPair, dayCapacities);
    const costBreakdown = computeTotalCostBreakdown(
        days,
        preparedMap,
        commuteMinutesByPair,
        dayCapacities,
        dayStats
    );
    const scoredDayGroups = normalizedDayGroups.map((group, index) => {
        const dayBreakdown = costBreakdown.dayBreakdowns[index];
        return {
            ...group,
            debugCost: dayBreakdown
                ? {
                    ...dayBreakdown,
                    overallTripCost: costBreakdown.overallCost,
                    baseCost: costBreakdown.baseCost,
                    commuteImbalancePenalty: costBreakdown.commuteImbalancePenalty,
                    nearbySplitPenalty: costBreakdown.nearbySplitPenalty,
                    durationMismatchPenalty: costBreakdown.durationMismatchPenalty,
                }
                : null,
        };
    });

    const timelineItemsByDayNumber = buildScheduleTimelineItems({
        dayGroups: scoredDayGroups,
        preparedMap,
        commuteMinutesByPair,
        dayCapacities,
        tripInfo,
    });

    return {
        dayGroups: scoredDayGroups,
        groupedDays: buildGroupedDays({
            dayGroups: scoredDayGroups,
            activities,
            timelineItemsByDayNumber,
        }),
        unassignedActivityIds: normalizedUnassignedActivityIds,
        activityCostDebugById: computeActivityCostDebug({
            days,
            preparedMap,
            commuteMinutesByPair,
            dayCapacities,
            unassignedActivityIds: normalizedUnassignedActivityIds,
            costBreakdown,
            dayStats,
        }),
    };
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

    const preparedMap = buildPreparedActivityMap(activities);

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
