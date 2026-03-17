
// Color palette for different days
export const DAY_COLORS = [
    "#C58F8D", // Muted Red
    "#8EA9C8", // Muted Blue
    "#94B59D", // Muted Green
    "#C8A78A", // Muted Orange
    "#AE9BC4", // Muted Purple
    "#89B8BF", // Muted Cyan
    "#C7BA8A", // Muted Amber
    "#9A97C1", // Muted Violet
    "#C39AAF", // Muted Pink
    "#84B0A5", // Muted Teal
];

// Unselected activity color
export const UNSELECTED_COLOR = "#A8B0BA";
export const SELECTED_COLOR = "#8EA9C8";

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
        1: "bg-red-200 text-red-900",
        2: "bg-blue-200 text-blue-900",
        3: "bg-green-200 text-green-900",
        4: "bg-orange-200 text-orange-900",
        5: "bg-purple-200 text-purple-900",
        6: "bg-cyan-200 text-cyan-900",
        7: "bg-amber-200 text-amber-900",
        8: "bg-violet-200 text-violet-900",
        9: "bg-pink-200 text-pink-900",
        10: "bg-teal-200 text-teal-900",
    };

    const num = ((dayNumber - 1) % 10) + 1;
    return colorMap[num] || "bg-gray-200 text-gray-900";
}
