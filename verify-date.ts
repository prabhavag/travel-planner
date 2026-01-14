
import { calculateDateForDay } from './lib/utils/date.ts';

const testCases = [
    { start: '2026-05-10', day: 1, expected: '2026-05-10' },
    { start: '2026-05-10', day: 2, expected: '2026-05-11' },
    { start: '2026-05-10', day: 4, expected: '2026-05-13' },
    { start: '2026-12-31', day: 2, expected: '2027-01-01' },
];

testCases.forEach(({ start, day, expected }) => {
    const result = calculateDateForDay(start, day);
    console.log(`Start: ${start}, Day: ${day}, Expected: ${expected}, Result: ${result}, Success: ${result === expected}`);
});
