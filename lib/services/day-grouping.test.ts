import { describe, it, expect, beforeEach } from 'vitest'
import {
    parseDurationHours,
    buildDayCapacityProfiles,
    getDayStructuralStats,
    structuralStatsCache,
    computeAllDayStats,
    computeTotalCost,
    activityCommuteMinutes,
    buildOptimalDayRoute,
    getLoadDurationHours,
} from './day-grouping'
import type { SuggestedActivity } from '@/lib/models/travel-plan'
import type { PreparedActivity } from './day-grouping'

const mockActivity = (id: string): SuggestedActivity => ({
    id,
    name: `Activity ${id}`,
    type: 'museum',
    interestTags: [],
    description: '',
    estimatedDuration: '2 hours',
    isDurationFlexible: true,
    estimatedCost: 10,
    currency: 'USD',
    difficultyLevel: 'moderate',
    bestTimeOfDay: 'morning',
    coordinates: { lat: 0, lng: 0 },
    locationMode: 'point',
    status: 'selected'
} as any);

describe('day-grouping duration parsing', () => {
    it('should parse simple hour strings', () => {
        expect(parseDurationHours('2 hours')).toBe(2);
        expect(parseDurationHours('1.5 hrs')).toBe(1.5);
    });

    it('should parse minute strings', () => {
        expect(parseDurationHours('45 mins')).toBe(0.75);
        expect(parseDurationHours('30 minutes')).toBe(0.5);
    });

    it('should parse mixed strings', () => {
        expect(parseDurationHours('1 hour 30 mins')).toBe(1.5);
        expect(parseDurationHours('2 hrs 15 min')).toBe(2.25);
    });

    it('should parse full day strings', () => {
        expect(parseDurationHours('Full day')).toBe(8);
    });

    it('should parse ranges', () => {
        expect(parseDurationHours('2-3 hours')).toBe(2.5);
    });
});

describe('day-grouping structural stats', () => {
    beforeEach(() => {
        structuralStatsCache.clear();
    });

    it('should calculate stats for an empty day', () => {
        const stats = getDayStructuralStats([], new Map(), new Map(), {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        });
        expect(stats.totalHours).toBe(0);
        expect(stats.structuralCost).toBe(0);
    });

    it('should use cache for identical activity sets', () => {
        const preparedMap = new Map();
        const commuteMatrix = new Map();
        const capacity = {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        };

        const activityA = mockActivity('a');
        const activityB = mockActivity('b');
        preparedMap.set('a', { activity: activityA, durationHours: 2, loadDurationHours: 2, isFullDay: false });
        preparedMap.set('b', { activity: activityB, durationHours: 2, loadDurationHours: 2, isFullDay: false });

        getDayStructuralStats(['a', 'b'], preparedMap, commuteMatrix, capacity);
        expect(structuralStatsCache.size).toBe(1);

        // Different order should still hit cache because we sort keys
        getDayStructuralStats(['b', 'a'], preparedMap, commuteMatrix, capacity);
        expect(structuralStatsCache.size).toBe(1);
    });

    it('does not include duration mismatch in structural cost', () => {
        const commuteMatrix = new Map();
        const capacity = {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        };

        const flexibleActivity = { ...mockActivity('flex'), isDurationFlexible: true };
        const fixedActivity = { ...mockActivity('fixed'), isDurationFlexible: false };

        const flexibleMap = new Map();
        flexibleMap.set('flex', { activity: flexibleActivity, durationHours: 2, loadDurationHours: 1, isFullDay: false });

        const fixedMap = new Map();
        fixedMap.set('fixed', { activity: fixedActivity, durationHours: 2, loadDurationHours: 1, isFullDay: false });

        const flexibleStats = getDayStructuralStats(['flex'], flexibleMap, commuteMatrix, capacity);
        const fixedStats = getDayStructuralStats(['fixed'], fixedMap, commuteMatrix, capacity);

        expect(flexibleStats.structuralCost).toBeCloseTo(fixedStats.structuralCost, 5);
    });

    it('applies a strong penalty when daylight-only activities run past daylight end', () => {
        const commuteMatrix = new Map();
        const capacity = {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        };

        const daylightOnly = {
            ...mockActivity('daylight'),
            daylightPreference: 'daylight_only',
            isFixedStartTime: true,
            fixedStartTime: '5:00 PM',
            estimatedDuration: '3 hours',
            bestTimeOfDay: 'evening' as const,
        };
        const flexible = {
            ...mockActivity('flexible'),
            daylightPreference: 'flexible',
            isFixedStartTime: true,
            fixedStartTime: '5:00 PM',
            estimatedDuration: '3 hours',
            bestTimeOfDay: 'evening' as const,
        };

        const daylightMap = new Map();
        daylightMap.set('daylight', { activity: daylightOnly, durationHours: 3, loadDurationHours: 3, isFullDay: false });
        const flexibleMap = new Map();
        flexibleMap.set('flexible', { activity: flexible, durationHours: 3, loadDurationHours: 3, isFullDay: false });

        const daylightStats = getDayStructuralStats(['daylight'], daylightMap, commuteMatrix, capacity);
        structuralStatsCache.clear();
        const flexibleStats = getDayStructuralStats(['flexible'], flexibleMap, commuteMatrix, capacity);

        expect(daylightStats.structuralCost).toBeGreaterThan(flexibleStats.structuralCost);
    });

    it('penalizes starts outside recommended windows on both early and late sides', () => {
        const commuteMatrix = new Map();
        const capacity = {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        };

        const onWindow = {
            ...mockActivity('on-window'),
            bestTimeOfDay: 'any' as const,
            isFixedStartTime: true,
            fixedStartTime: '11:30 AM',
            recommendedStartWindow: { start: '11:00 AM', end: '1:00 PM', reason: 'Calmest waters' },
        };
        const earlyWindowMiss = {
            ...mockActivity('early-window-miss'),
            bestTimeOfDay: 'any' as const,
            isFixedStartTime: true,
            fixedStartTime: '10:00 AM',
            recommendedStartWindow: { start: '11:00 AM', end: '1:00 PM', reason: 'Calmest waters' },
        };
        const lateWindowMiss = {
            ...mockActivity('late-window-miss'),
            bestTimeOfDay: 'any' as const,
            isFixedStartTime: true,
            fixedStartTime: '2:30 PM',
            recommendedStartWindow: { start: '11:00 AM', end: '1:00 PM', reason: 'Calmest waters' },
        };

        const onWindowMap = new Map();
        onWindowMap.set('on-window', { activity: onWindow, durationHours: 2, loadDurationHours: 2, isFullDay: false });
        const earlyMissMap = new Map();
        earlyMissMap.set('early-window-miss', { activity: earlyWindowMiss, durationHours: 2, loadDurationHours: 2, isFullDay: false });
        const lateMissMap = new Map();
        lateMissMap.set('late-window-miss', { activity: lateWindowMiss, durationHours: 2, loadDurationHours: 2, isFullDay: false });

        const onWindowStats = getDayStructuralStats(['on-window'], onWindowMap, commuteMatrix, capacity);
        structuralStatsCache.clear();
        const earlyMissStats = getDayStructuralStats(['early-window-miss'], earlyMissMap, commuteMatrix, capacity);
        structuralStatsCache.clear();
        const lateMissStats = getDayStructuralStats(['late-window-miss'], lateMissMap, commuteMatrix, capacity);

        expect(earlyMissStats.structuralCost).toBeGreaterThan(onWindowStats.structuralCost);
        expect(lateMissStats.structuralCost).toBeGreaterThan(onWindowStats.structuralCost);
    });

    it('penalizes evening placement for morning-preferred activities', () => {
        const commuteMatrix = new Map();
        const capacity = {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        };

        const morningAligned = {
            ...mockActivity('morning-aligned'),
            bestTimeOfDay: 'morning' as const,
            isFixedStartTime: true,
            fixedStartTime: '9:00 AM',
        };
        const eveningPlaced = {
            ...mockActivity('evening-placed'),
            bestTimeOfDay: 'morning' as const,
            isFixedStartTime: true,
            fixedStartTime: '5:30 PM',
        };

        const alignedMap = new Map();
        alignedMap.set('morning-aligned', { activity: morningAligned, durationHours: 2, loadDurationHours: 2, isFullDay: false });
        const eveningMap = new Map();
        eveningMap.set('evening-placed', { activity: eveningPlaced, durationHours: 2, loadDurationHours: 2, isFullDay: false });

        const alignedStats = getDayStructuralStats(['morning-aligned'], alignedMap, commuteMatrix, capacity);
        structuralStatsCache.clear();
        const eveningStats = getDayStructuralStats(['evening-placed'], eveningMap, commuteMatrix, capacity);

        expect(eveningStats.structuralCost).toBeGreaterThan(alignedStats.structuralCost);
    });

    it('adds a small penalty when slot capacity remains unfilled', () => {
        const commuteMatrix = new Map();
        const activity = {
            ...mockActivity('single'),
            bestTimeOfDay: 'afternoon' as const,
            estimatedDuration: '2 hours',
        };
        const preparedMap = new Map();
        preparedMap.set('single', { activity, durationHours: 2, loadDurationHours: 2, isFullDay: false });

        const roomyCapacity = {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        };
        const tightCapacity = {
            maxHours: 8,
            slotCapacity: { morning: 0, afternoon: 2, evening: 0 },
            targetWeight: 1
        };

        const roomyStats = getDayStructuralStats(['single'], preparedMap, commuteMatrix, roomyCapacity);
        structuralStatsCache.clear();
        const tightStats = getDayStructuralStats(['single'], preparedMap, commuteMatrix, tightCapacity);

        expect(roomyStats.structuralCost).toBeGreaterThan(tightStats.structuralCost);
    });

    it('applies a 2x driving penalty for after-hours commute legs', () => {
        const capacity = {
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1
        };

        const daytimeA = {
            ...mockActivity('daytime-a'),
            bestTimeOfDay: 'any' as const,
            isFixedStartTime: true,
            fixedStartTime: '10:00 AM',
        };
        const daytimeB = {
            ...mockActivity('daytime-b'),
            bestTimeOfDay: 'any' as const,
            isFixedStartTime: true,
            fixedStartTime: '1:30 PM',
        };
        const nightA = {
            ...mockActivity('night-a'),
            bestTimeOfDay: 'any' as const,
            isFixedStartTime: true,
            fixedStartTime: '8:30 PM',
        };
        const nightB = {
            ...mockActivity('night-b'),
            bestTimeOfDay: 'any' as const,
            isFixedStartTime: true,
            fixedStartTime: '11:30 PM',
        };

        const daytimeMap = new Map();
        daytimeMap.set('daytime-a', { activity: daytimeA, durationHours: 1, loadDurationHours: 1, isFullDay: false });
        daytimeMap.set('daytime-b', { activity: daytimeB, durationHours: 1, loadDurationHours: 1, isFullDay: false });
        const nightMap = new Map();
        nightMap.set('night-a', { activity: nightA, durationHours: 1, loadDurationHours: 1, isFullDay: false });
        nightMap.set('night-b', { activity: nightB, durationHours: 1, loadDurationHours: 1, isFullDay: false });

        const daytimeCommuteMatrix = new Map([
            ['daytime-a->daytime-b', 120],
            ['daytime-b->daytime-a', 120],
        ]);
        const nightCommuteMatrix = new Map([
            ['night-a->night-b', 120],
            ['night-b->night-a', 120],
        ]);

        const daytimeStats = getDayStructuralStats(['daytime-a', 'daytime-b'], daytimeMap, daytimeCommuteMatrix, capacity);
        structuralStatsCache.clear();
        const nightStats = getDayStructuralStats(['night-a', 'night-b'], nightMap, nightCommuteMatrix, capacity);

        expect(nightStats.structuralCost).toBeGreaterThan(daytimeStats.structuralCost);
    });
});

describe('day-grouping load duration', () => {
    it('caps scheduled load duration at recommended duration', () => {
        const activity = mockActivity('capped');
        const preparedMap = new Map();
        preparedMap.set('capped', {
            activity,
            durationHours: 2,
            loadDurationHours: 3,
            isFullDay: false,
        });

        expect(getLoadDurationHours(preparedMap, 'capped')).toBe(2);
    });
});

describe('day-grouping total cost', () => {
    it('should give same result with and without precomputed stats', () => {
        const days = [{ activityIds: ['a'] }, { activityIds: ['b'] }];
        const activityA = mockActivity('a');
        const activityB = mockActivity('b');
        const preparedMap = new Map();
        preparedMap.set('a', { activity: activityA, durationHours: 2, loadDurationHours: 2, isFullDay: false });
        preparedMap.set('b', { activity: activityB, durationHours: 2, loadDurationHours: 2, isFullDay: false });

        const commuteMatrix = new Map();
        const capacities = [
            { maxHours: 8, slotCapacity: { morning: 4, afternoon: 4, evening: 3 }, targetWeight: 1 },
            { maxHours: 8, slotCapacity: { morning: 4, afternoon: 4, evening: 3 }, targetWeight: 1 }
        ];

        const costFull = computeTotalCost(days, preparedMap, commuteMatrix, capacities);
        const stats = computeAllDayStats(days, preparedMap, commuteMatrix, capacities);
        const costWithStats = computeTotalCost(days, preparedMap, commuteMatrix, capacities, stats);

        expect(costWithStats).toBeCloseTo(costFull, 5);
    });

    it('penalizes duration mismatch for unscheduled activities', () => {
        structuralStatsCache.clear();
        const activity = { ...mockActivity('duration-mismatch'), bestTimeOfDay: 'morning' as const, estimatedDuration: '2 hours' };
        const preparedMap = new Map();
        preparedMap.set('duration-mismatch', { activity, durationHours: 2, loadDurationHours: 2, isFullDay: false });

        const capacities = [
            { maxHours: 8, slotCapacity: { morning: 2, afternoon: 0, evening: 0 }, targetWeight: 1 }
        ];
        const unscheduledCost = computeTotalCost([{ activityIds: [] }], preparedMap, new Map(), capacities);
        const scheduledCost = computeTotalCost([{ activityIds: ['duration-mismatch'] }], preparedMap, new Map(), capacities);

        expect(unscheduledCost).toBeGreaterThan(scheduledCost);
    });
});

describe('day-grouping road route direction swaps', () => {
    it('uses the nearer route endpoint for road activities when computing commute', () => {
        const road = {
            ...mockActivity('road'),
            type: 'road',
            locationMode: 'route' as const,
            startCoordinates: { lat: 0, lng: 0 },
            endCoordinates: { lat: 0, lng: 10 },
            coordinates: null,
        };
        const point = {
            ...mockActivity('point'),
            coordinates: { lat: 0, lng: 9.95 },
            locationMode: 'point' as const,
        };

        const minutes = activityCommuteMinutes(point, road, new Map());
        expect(minutes).toBeLessThan(60);
    });

    it('applies route endpoint swapping inside day route optimization', () => {
        const startPoint = {
            ...mockActivity('start'),
            bestTimeOfDay: 'any' as const,
            coordinates: { lat: 0, lng: 0.05 },
            locationMode: 'point' as const,
        };
        const endPoint = {
            ...mockActivity('end'),
            bestTimeOfDay: 'any' as const,
            coordinates: { lat: 0, lng: 9.95 },
            locationMode: 'point' as const,
        };
        const road = {
            ...mockActivity('road'),
            bestTimeOfDay: 'any' as const,
            type: 'road',
            locationMode: 'route' as const,
            startCoordinates: { lat: 0, lng: 0 },
            endCoordinates: { lat: 0, lng: 10 },
            coordinates: null,
        };

        const activities = [startPoint, endPoint, road];
        const preparedMap = new Map<string, PreparedActivity>(activities.map((activity) => [
            activity.id,
            { activity, durationHours: 1, loadDurationHours: 1, isFullDay: false }
        ]));

        const ordered = buildOptimalDayRoute(activities, preparedMap, new Map());
        expect(ordered[1]?.id).toBe('road');
    });

    it('allows route activities to exit from covered interior waypoints', () => {
        const road = {
            ...mockActivity('road-mid-exit'),
            type: 'road',
            locationMode: 'route' as const,
            startCoordinates: { lat: 0, lng: 0 },
            endCoordinates: { lat: 0, lng: 10 },
            routeWaypoints: [
                { name: 'Scenic midpoint', coordinates: { lat: 0, lng: 5 } },
            ],
            routePoints: [
                { lat: 0, lng: 0 },
                { lat: 0, lng: 5 },
                { lat: 0, lng: 10 },
            ],
            coordinates: null,
        };
        const point = {
            ...mockActivity('point-near-mid'),
            coordinates: { lat: 0, lng: 5.05 },
            locationMode: 'point' as const,
        };

        const minutes = activityCommuteMinutes(road, point, new Map());
        expect(minutes).toBeLessThan(30);
    });
});

describe('day-grouping flight timing constraints', () => {
    it('reserves at least 2 hours before departure plus transfer buffer on final day', () => {
        const tripInfo = {
            destination: 'Maui',
            startDate: '2026-03-10',
            endDate: '2026-03-12',
            durationDays: 3,
            arrivalTimePreference: '12:00 PM',
            departureTimePreference: '6:00 PM',
            transportMode: 'flight',
        } as any;

        const capacities = buildDayCapacityProfiles(tripInfo, 3);
        const finalDay = capacities[2];
        expect(finalDay.maxHours).toBeCloseTo(4.67, 1);
        expect(finalDay.slotCapacity.evening).toBe(0);
        expect(finalDay.overflowPenaltyMultiplier).toBeGreaterThanOrEqual(5);
    });

    it('applies stricter overflow cost when overflow multiplier increases', () => {
        const commuteMatrix = new Map();
        const preparedMap = new Map();
        const longActivity = { ...mockActivity('long'), estimatedDuration: '8 hours' };
        preparedMap.set('long', { activity: longActivity, durationHours: 8, loadDurationHours: 8, isFullDay: true });

        const normalStats = getDayStructuralStats(['long'], preparedMap, commuteMatrix, {
            maxHours: 4,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1,
            overflowPenaltyMultiplier: 1,
        });
        structuralStatsCache.clear();
        const strictStats = getDayStructuralStats(['long'], preparedMap, commuteMatrix, {
            maxHours: 4,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1,
            overflowPenaltyMultiplier: 5,
        });

        expect(strictStats.structuralCost).toBeGreaterThan(normalStats.structuralCost);
    });
});
