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
    orderDayActivityIds,
    getLoadDurationHours,
    buildPreparedActivityMap,
    buildScoredSchedule,
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

    it('moves daylight-only activities to unassigned in hard-constraint auto-placement mode', () => {
        const pipiwai = {
            ...mockActivity('pipiwai'),
            name: 'Pipiwai Trail and Waimoku Falls',
            type: 'hiking',
            daylightPreference: 'daylight_only' as const,
            estimatedDuration: '4.5 hours',
            isDurationFlexible: false,
        };
        const activities = [pipiwai];
        const preparedMap = buildPreparedActivityMap(activities);
        const schedule = buildScoredSchedule({
            dayGroups: [{
                dayNumber: 1,
                date: '',
                theme: 'Arrival day',
                activityIds: ['pipiwai'],
                nightStay: null,
                debugCost: null,
            }],
            activities,
            unassignedActivityIds: [],
            dayCapacities: [{
                maxHours: 4,
                slotCapacity: { morning: 0, afternoon: 2, evening: 2 },
                targetWeight: 0.5,
            }],
            preparedMap,
            commuteMinutesByPair: new Map(),
            options: { forceSchedule: false },
        });

        expect(schedule.dayGroups[0].activityIds).toEqual([]);
        expect(schedule.unassignedActivityIds).toEqual(['pipiwai']);
        expect(schedule.activityCostDebugById.pipiwai.kind).toBe('unscheduled');
    });

    it('preserves daylight-only activities when a user or LLM forces placement', () => {
        const kapalua = {
            ...mockActivity('kapalua'),
            name: 'Kapalua Coastal Trail',
            type: 'hiking',
            daylightPreference: 'daylight_only' as const,
            estimatedDuration: '2.5 hours',
            isDurationFlexible: false,
        };
        const activities = [kapalua];
        const preparedMap = buildPreparedActivityMap(activities);
        const schedule = buildScoredSchedule({
            dayGroups: [{
                dayNumber: 1,
                date: '',
                theme: 'Forced day',
                activityIds: ['kapalua'],
                nightStay: null,
                debugCost: null,
            }],
            activities,
            unassignedActivityIds: [],
            dayCapacities: [{
                maxHours: 2,
                slotCapacity: { morning: 0, afternoon: 0, evening: 2 },
                targetWeight: 0.5,
            }],
            preparedMap,
            commuteMinutesByPair: new Map(),
            options: { forceSchedule: true },
        });

        expect(schedule.dayGroups[0].activityIds).toEqual(['kapalua']);
        expect(schedule.unassignedActivityIds).toEqual([]);
        expect(schedule.activityCostDebugById.kapalua.kind).toBe('scheduled');
        expect(schedule.dayGroups[0].debugCost?.overallTripCost).toBeGreaterThan(0);
    });

    it('anchors non-arrival day timelines to an earlier fixed sunrise start', () => {
        const sunriseHike = {
            ...mockActivity('sunrise-hike'),
            name: 'Sunrise Hike',
            type: 'hiking',
            estimatedDuration: '2 hours',
            bestTimeOfDay: 'morning' as const,
            isFixedStartTime: true,
            fixedStartTime: 'sunrise',
        };
        const activities = [sunriseHike];
        const preparedMap = buildPreparedActivityMap(activities);
        const dayCapacities = Array.from({ length: 2 }, () => ({
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1,
        }));

        const schedule = buildScoredSchedule({
            dayGroups: [
                {
                    dayNumber: 1,
                    date: '',
                    theme: 'Arrival',
                    activityIds: [],
                    nightStay: null,
                    debugCost: null,
                },
                {
                    dayNumber: 2,
                    date: '',
                    theme: 'Sunrise',
                    activityIds: ['sunrise-hike'],
                    nightStay: null,
                    debugCost: null,
                },
            ],
            activities,
            unassignedActivityIds: [],
            dayCapacities,
            preparedMap,
            commuteMinutesByPair: new Map(),
        });

        const sunriseTimelineItem = schedule.groupedDays[1]?.timelineItems?.find(
            (item) => item.activityId === 'sunrise-hike'
        );

        expect(sunriseTimelineItem?.timeRange).toBe('6 AM-8 AM');
    });


    it('does not treat non-fixed timing hints as hard schedule anchors', () => {
        const softHint = {
            ...mockActivity('soft-hint'),
            name: 'Soft Hint Activity',
            estimatedDuration: '2 hours',
            isFixedStartTime: false,
            fixedStartTime: '6:00 PM',
            bestTimeOfDay: 'afternoon' as const,
        };
        const activities = [softHint];
        const preparedMap = buildPreparedActivityMap(activities);

        const schedule = buildScoredSchedule({
            dayGroups: [
                {
                    dayNumber: 1,
                    date: '',
                    theme: 'Hints',
                    activityIds: [],
                    nightStay: null,
                    debugCost: null,
                },
                {
                    dayNumber: 2,
                    date: '',
                    theme: 'Hinted Day',
                    activityIds: ['soft-hint'],
                    nightStay: null,
                    debugCost: null,
                },
            ],
            activities,
            unassignedActivityIds: [],
            dayCapacities: [
                {
                    maxHours: 8,
                    slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
                    targetWeight: 1,
                },
                {
                    maxHours: 8,
                    slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
                    targetWeight: 1,
                },
            ],
            preparedMap,
            commuteMinutesByPair: new Map(),
            options: { forceSchedule: true },
        });

        const hintTimelineItem = schedule.groupedDays[1]?.timelineItems?.find(
            (item) => item.activityId === 'soft-hint'
        );

        expect(hintTimelineItem?.timeRange).toBe('9:30 AM-11:30 AM');
    });

    it('uses the previous day night stay as the next day start stay', () => {
        const sunriseHike = {
            ...mockActivity('hana-sunrise'),
            name: 'Haleakala Sunrise Hike',
            type: 'hiking',
            estimatedDuration: '2 hours',
            bestTimeOfDay: 'morning' as const,
            isFixedStartTime: true,
            fixedStartTime: '6:00 AM',
        };
        const activities = [sunriseHike];
        const preparedMap = buildPreparedActivityMap(activities);
        const dayCapacities = Array.from({ length: 2 }, () => ({
            maxHours: 8,
            slotCapacity: { morning: 4, afternoon: 4, evening: 3 },
            targetWeight: 1,
        }));

        const schedule = buildScoredSchedule({
            dayGroups: [
                {
                    dayNumber: 1,
                    date: '',
                    theme: 'Road to Hana',
                    activityIds: [],
                    nightStay: { label: 'Hana' } as any,
                    debugCost: null,
                },
                {
                    dayNumber: 2,
                    date: '',
                    theme: 'Summit Day',
                    activityIds: ['hana-sunrise'],
                    nightStay: { label: 'Kula' } as any,
                    debugCost: null,
                },
            ],
            activities,
            unassignedActivityIds: [],
            dayCapacities,
            preparedMap,
            commuteMinutesByPair: new Map(),
        });

        const stayStartItem = schedule.groupedDays[1]?.timelineItems?.find(
            (item) => item.id === 'stay-start-2'
        );

        expect(stayStartItem).toMatchObject({
            title: 'Start from stay',
            detail: 'Hana',
        });
    });

    it('always includes the fixed departure on an empty final day timeline', () => {
        const activities: SuggestedActivity[] = [];
        const preparedMap = buildPreparedActivityMap(activities);
        const tripInfo = {
            source: null,
            destination: 'Maui',
            startDate: '2026-04-25',
            endDate: '2026-04-26',
            durationDays: 2,
            preferences: [],
            foodPreferences: [],
            visitedDestinations: [],
            activityLevel: 'moderate',
            travelers: 1,
            budget: null,
            transportMode: 'flight',
            arrivalAirport: 'OGG',
            departureAirport: 'OGG',
            arrivalTimePreference: '12:00 PM',
            departureTimePreference: '6:00 PM',
        };
        const dayCapacities = buildDayCapacityProfiles(tripInfo as any, 2);

        const schedule = buildScoredSchedule({
            dayGroups: [
                {
                    dayNumber: 1,
                    date: '2026-04-25',
                    theme: 'Arrival',
                    activityIds: [],
                    nightStay: { label: 'Kula' } as any,
                    debugCost: null,
                },
                {
                    dayNumber: 2,
                    date: '2026-04-26',
                    theme: 'Flexible Exploration Day',
                    activityIds: [],
                    nightStay: { label: 'Haiku' } as any,
                    debugCost: null,
                },
            ],
            activities,
            unassignedActivityIds: [],
            dayCapacities,
            preparedMap,
            commuteMinutesByPair: new Map(),
            options: { tripInfo: tripInfo as any },
        });

        expect(schedule.groupedDays[1]?.timelineItems).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    title: 'Start from stay',
                    detail: 'Kula',
                }),
                expect.objectContaining({
                    title: 'Airport transfer',
                }),
                expect.objectContaining({
                    title: 'Departure prep',
                    detail: expect.stringContaining('OGG'),
                }),
            ])
        );
        expect(schedule.groupedDays[1]?.timelineItems?.some((item) => item.title === 'End at night stay')).toBe(false);
    });

    it('reorders persisted day activity ids to match the timing-aware optimal route', () => {
        const activities = [
            {
                ...mockActivity('ceremony'),
                name: 'Black Rock Cliff Dive Ceremony',
                type: 'culture',
                estimatedDuration: '1 hour',
                bestTimeOfDay: 'evening' as const,
                isFixedStartTime: true,
                fixedStartTime: '6:00 PM',
            },
            {
                ...mockActivity('beach'),
                name: 'Kaanapali Beach',
                type: 'relaxation',
                estimatedDuration: '2 hours',
                bestTimeOfDay: 'afternoon' as const,
                daylightPreference: 'daylight_only' as const,
            },
            {
                ...mockActivity('trail'),
                name: 'Lahaina Historic Trail',
                type: 'culture',
                estimatedDuration: '2.5 hours',
                bestTimeOfDay: 'morning' as const,
                daylightPreference: 'daylight_only' as const,
            },
        ];
        const preparedMap = buildPreparedActivityMap(activities);

        const orderedIds = orderDayActivityIds({
            activityIds: ['ceremony', 'beach', 'trail'],
            preparedMap,
            commuteMinutesByPair: new Map(),
        });

        expect(orderedIds).toEqual(['trail', 'beach', 'ceremony']);
    });

    it('still enforces arrival as a hard constraint for an early fixed start', () => {
        const sunriseHike = {
            ...mockActivity('arrival-sunrise-hike'),
            name: 'Arrival Sunrise Hike',
            type: 'hiking',
            estimatedDuration: '2 hours',
            bestTimeOfDay: 'morning' as const,
            isFixedStartTime: true,
            fixedStartTime: 'sunrise',
        };
        const activities = [sunriseHike];
        const preparedMap = buildPreparedActivityMap(activities);
        const dayCapacities = buildDayCapacityProfiles({
            source: null,
            destination: null,
            startDate: '2026-04-25',
            endDate: '2026-04-25',
            durationDays: 1,
            preferences: [],
            foodPreferences: [],
            visitedDestinations: [],
            activityLevel: 'moderate',
            travelers: 1,
            budget: null,
            transportMode: 'flight',
            arrivalAirport: 'OGG',
            departureAirport: 'OGG',
            arrivalTimePreference: '12:00 PM',
            departureTimePreference: '6:00 PM',
        }, 1);

        const schedule = buildScoredSchedule({
            dayGroups: [
                {
                    dayNumber: 1,
                    date: '2026-04-25',
                    theme: 'Arrival',
                    activityIds: ['arrival-sunrise-hike'],
                    nightStay: null,
                    debugCost: null,
                },
            ],
            activities,
            unassignedActivityIds: [],
            dayCapacities,
            preparedMap,
            commuteMinutesByPair: new Map(),
            options: {
                tripInfo: {
                    source: null,
                    destination: null,
                    startDate: '2026-04-25',
                    endDate: '2026-04-25',
                    durationDays: 1,
                    preferences: [],
                    foodPreferences: [],
                    visitedDestinations: [],
                    activityLevel: 'moderate',
                    travelers: 1,
                    budget: null,
                    transportMode: 'flight',
                    arrivalAirport: 'OGG',
                    departureAirport: 'OGG',
                    arrivalTimePreference: '12:00 PM',
                    departureTimePreference: '6:00 PM',
                },
            },
        });

        const arrivalTimelineItem = schedule.groupedDays[0]?.timelineItems?.find(
            (item) => item.activityId === 'arrival-sunrise-hike'
        );

        expect(arrivalTimelineItem?.timeRange).toBe('2 PM-4 PM');
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

    it('exposes arrival and departure timing constraints for prompt consumers', () => {
        const tripInfo = {
            destination: 'Maui',
            startDate: '2026-03-10',
            endDate: '2026-03-12',
            durationDays: 3,
            arrivalTimePreference: '1:15 PM',
            departureTimePreference: '6:00 PM',
            transportMode: 'flight',
        } as any;

        const capacities = buildDayCapacityProfiles(tripInfo, 3);
        expect(capacities[0].timingConstraints).toContainEqual(expect.objectContaining({
            type: 'arrival',
            sourceTime: '1:15 PM',
            earliestStartMinutes: 15 * 60 + 15,
        }));
        expect(capacities[2].timingConstraints).toContainEqual(expect.objectContaining({
            type: 'departure',
            sourceTime: '6:00 PM',
            latestEndMinutes: 14 * 60 + 10,
            airportArrivalDeadlineMinutes: 16 * 60,
        }));
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
