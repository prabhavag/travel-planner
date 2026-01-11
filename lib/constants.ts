
// Color palette for different days
export const DAY_COLORS = [
    "#E53935", // Red
    "#1E88E5", // Blue
    "#43A047", // Green
    "#FB8C00", // Orange
    "#8E24AA", // Purple
    "#00ACC1", // Cyan
    "#FFB300", // Amber
    "#5E35B1", // Deep Purple
    "#D81B60", // Pink
    "#00897B", // Teal
];

// Unselected activity color
export const UNSELECTED_COLOR = "#9CA3AF";
export const SELECTED_COLOR = "#3B82F6";

/**
 * Get color for a specific day number
 */
export function getDayColor(dayNumber: number): string {
    const num = Number(dayNumber);
    if (isNaN(num) || num < 1) return DAY_COLORS[0];
    return DAY_COLORS[(num - 1) % DAY_COLORS.length];
}

/**
 * Get Tailwind background and text color classes for a day badge
 */
export function getDayBadgeColors(dayNumber: number): string {
    const colorMap: Record<number, string> = {
        1: "bg-red-500 text-white",
        2: "bg-blue-500 text-white",
        3: "bg-green-600 text-white",
        4: "bg-orange-500 text-white",
        5: "bg-purple-600 text-white",
        6: "bg-cyan-600 text-white",
        7: "bg-amber-500 text-white",
        8: "bg-violet-700 text-white",
        9: "bg-pink-600 text-white",
        10: "bg-teal-600 text-white",
    };

    const num = ((dayNumber - 1) % 10) + 1;
    return colorMap[num] || "bg-gray-500 text-white";
}
