/**
 * Date utility functions
 */

/**
 * Calculates the date for a specific day of a trip
 * @param startDate The trip's start date (YYYY-MM-DD)
 * @param dayNumber The day number (1-indexed)
 * @returns The date string in YYYY-MM-DD format
 */
export function calculateDateForDay(startDate: string, dayNumber: number): string {
    const [startY, startM, startD] = startDate.split('-').map(Number);
    const date = new Date(startY, startM - 1, startD);

    // dayNumber is 1-indexed, so Day 1 is startDate + 0 days
    date.setDate(date.getDate() + (dayNumber - 1));

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

/**
 * Formats a YYYY-MM-DD date string for display (e.g., "Sun, May 10")
 * Ensures the date is parsed correctly in any timezone by avoiding the UTC trap.
 */
export function formatDisplayDate(dateStr: string, options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    // Use the month - 1 because Date constructor uses 0-indexed months
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-US", options);
}
