import { describe, it, expect, beforeEach } from 'vitest'
import { parseDurationHours, getDayStructuralStats, structuralStatsCache } from './day-grouping'

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

        getDayStructuralStats(['a', 'b'], preparedMap, commuteMatrix, capacity);
        expect(structuralStatsCache.size).toBe(1);

        // Different order should still hit cache because we sort keys
        getDayStructuralStats(['b', 'a'], preparedMap, commuteMatrix, capacity);
        expect(structuralStatsCache.size).toBe(1);
    });
});
