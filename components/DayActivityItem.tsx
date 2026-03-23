"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ActivityCard } from "@/components/ActivityCard";
import { ResearchOptionCard } from "@/components/ResearchOptionCard";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DayActivityItemProps {
    activity: SuggestedActivity;
    /** The day this activity is currently displayed in. */
    dayNumber: number;
    /** The original day the activity was assigned to by the grouping algorithm. */
    sourceDayNumber?: number;
    index: number;
    timeSlotLabel?: string;
    affordLabel?: string;

    // State
    isMoving: boolean;
    isCollapsed: boolean;
    debugMode: boolean;
    userPreferences: string[];
    displayGroupedDays: GroupedDay[];
    canMoveUp?: boolean;
    canMoveDown?: boolean;

    // Callbacks
    onToggleCollapse: (activityId: string) => void;
    onMoveStart: (activityId: string, fromDay: number) => void;
    onMoveConfirm: (toDay: number | "unscheduled") => void;
    onMoveCancel: () => void;
    onMoveUp?: (activityId: string) => void;
    onMoveDown?: (activityId: string) => void;
    allowUnscheduledTarget?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a single activity card inside the day-grouping timeline.
 *
 * Extracted from `DayGroupingView` so the parent component stays focused on
 * layout and scheduling logic, while card-level rendering lives here.
 */
export function DayActivityItem({
    activity,
    dayNumber,
    sourceDayNumber,
    index,
    timeSlotLabel,
    affordLabel,
    isMoving,
    isCollapsed,
    debugMode,
    userPreferences,
    displayGroupedDays,
    canMoveUp = false,
    canMoveDown = false,
    onToggleCollapse,
    onMoveStart,
    onMoveCancel,
    onMoveConfirm,
    onMoveUp,
    onMoveDown,
    allowUnscheduledTarget = false,
}: DayActivityItemProps) {
    const sourceDay = sourceDayNumber ?? dayNumber;

    // ── "Change Day" button shown in the card header ────────────────────────
    const cardHeaderActions = (
        <div className="flex items-center gap-1">
            {onMoveUp && onMoveDown ? (
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                            e.stopPropagation();
                            onMoveUp(activity.id);
                        }}
                        disabled={!canMoveUp}
                        className="h-6 px-2 text-[10px] text-gray-500 disabled:opacity-40"
                        title="Move up"
                    >
                        Up
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                            e.stopPropagation();
                            onMoveDown(activity.id);
                        }}
                        disabled={!canMoveDown}
                        className="h-6 px-2 text-[10px] text-gray-500 disabled:opacity-40"
                        title="Move down"
                    >
                        Down
                    </Button>
                </>
            ) : null}
            <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                    e.stopPropagation();
                    onMoveStart(activity.id, sourceDay);
                }}
                className="h-6 px-2 text-[10px] text-gray-500"
            >
                Change Day
            </Button>
        </div>
    );

    // ── Debug attribute dump ─────────────────────────────────────────────────
    const debugAttributes = {
        id: activity.id,
        name: activity.name,
        type: activity.type,
        interestTags: activity.interestTags ?? [],
        description: activity.description ?? null,
        estimatedDuration: activity.estimatedDuration ?? null,
        isDurationFlexible: activity.isDurationFlexible ?? true,
        estimatedCost: activity.estimatedCost ?? null,
        currency: activity.currency ?? null,
        difficultyLevel: activity.difficultyLevel ?? null,
        bestTimeOfDay: activity.bestTimeOfDay ?? null,
        daylightPreference: activity.daylightPreference ?? null,
        isFixedStartTime: activity.isFixedStartTime ?? null,
        fixedStartTime: activity.fixedStartTime ?? null,
        recommendedStartWindow: activity.recommendedStartWindow ?? null,
        timeReason: activity.timeReason ?? null,
        timeSourceLinks: activity.timeSourceLinks ?? [],
        neighborhood: activity.neighborhood ?? null,
        locationMode: activity.locationMode ?? null,
        coordinates: activity.coordinates ?? null,
        startCoordinates: activity.startCoordinates ?? null,
        endCoordinates: activity.endCoordinates ?? null,
        routeWaypoints: activity.routeWaypoints ?? [],
        routePoints: activity.routePoints ?? [],
        place_id: activity.place_id ?? null,
        rating: activity.rating ?? null,
        opening_hours: activity.opening_hours ?? null,
        photo_url: activity.photo_url ?? null,
        photo_urls: activity.photo_urls ?? [],
        researchOptionId: activity.researchOption?.id ?? null,
    };

    // ── Extra content shown at the bottom of the card ───────────────────────
    const showMoveControls = Boolean(affordLabel) || isMoving || debugMode;
    const moveControls = (
        <div className="pt-3 mt-3 border-t border-gray-50">
            {affordLabel ? <p className="mb-2 text-[11px] text-gray-500">{affordLabel}</p> : null}

            {isMoving ? (
                <div className="flex items-center gap-2">
                    <Select
                        onValueChange={(val) =>
                            onMoveConfirm(val === "unscheduled" ? "unscheduled" : parseInt(val, 10))
                        }
                    >
                        <SelectTrigger className="flex-1 h-8 text-[10px]">
                            <SelectValue placeholder="Move to day..." />
                        </SelectTrigger>
                        <SelectContent>
                            {allowUnscheduledTarget ? (
                                <SelectItem value="unscheduled">
                                    unschedule
                                </SelectItem>
                            ) : null}
                            {displayGroupedDays.map((day) => (
                                <SelectItem key={day.dayNumber} value={day.dayNumber.toString()}>
                                    Day {day.dayNumber}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={onMoveCancel} className="h-8 px-2 text-[10px]">
                        Cancel
                    </Button>
                </div>
            ) : null}

            {debugMode && !isCollapsed ? (
                <div className="mt-3 space-y-2 rounded-md border border-slate-300 bg-slate-50 p-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Debug Attributes</p>
                    <pre className="max-h-72 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] leading-4 text-slate-800">
                        {JSON.stringify(debugAttributes, null, 2)}
                    </pre>
                </div>
            ) : null}
        </div>
    );

    // ── Render via ResearchOptionCard or ActivityCard ────────────────────────
    if (activity.researchOption) {
        return (
            <ResearchOptionCard
                option={activity.researchOption}
                isSelected={true}
                readOnly={true}
                activityDuration={activity.estimatedDuration}
                timeSlotLabel={timeSlotLabel}
                showDurationBadge={false}
                collapsed={isCollapsed}
                onToggleCollapse={() => onToggleCollapse(activity.id)}
                headerActions={cardHeaderActions}
                extraContent={showMoveControls ? moveControls : undefined}
            />
        );
    }

    return (
        <ActivityCard
            activity={activity}
            index={index}
            isSelected={true}
            userPreferences={userPreferences}
            timeSlotLabel={timeSlotLabel}
            showDurationBadge={false}
            collapsed={isCollapsed}
            onToggleCollapse={() => onToggleCollapse(activity.id)}
            headerActions={cardHeaderActions}
            extraContent={showMoveControls ? moveControls : undefined}
        />
    );
}
