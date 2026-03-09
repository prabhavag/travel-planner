"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MapPin, ListChecks } from "lucide-react";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";
import { ActivityCard } from "@/components/ActivityCard";
import { ResearchOptionCard } from "@/components/ResearchOptionCard";

interface DayGroupingViewProps {
  groupedDays: GroupedDay[];
  userPreferences?: string[];
  onMoveActivity: (activityId: string, fromDay: number, toDay: number) => void;
  onConfirm: () => void;
  onDayChange?: (dayNumber: number) => void;
  isLoading?: boolean;
}

export function DayGroupingView({
  groupedDays,
  userPreferences = [],
  onMoveActivity,
  onConfirm,
  onDayChange,
  isLoading = false,
}: DayGroupingViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [movingActivity, setMovingActivity] = useState<{
    id: string;
    fromDay: number;
  } | null>(null);
  const [collapsedActivityCards, setCollapsedActivityCards] = useState<Record<string, boolean>>({});
  const [activeDayNumber, setActiveDayNumber] = useState<number | null>(groupedDays[0]?.dayNumber ?? null);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current && onDayChange) {
      const container = scrollContainerRef.current;
      const index = Math.round(container.scrollLeft / container.clientWidth);
      const activeDay = groupedDays[index]?.dayNumber;
      if (activeDay) {
        setActiveDayNumber(activeDay);
        onDayChange(activeDay);
      }
    }
  }, [groupedDays, onDayChange]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  useEffect(() => {
    if (groupedDays.length === 0) {
      setActiveDayNumber(null);
      return;
    }
    if (!activeDayNumber || !groupedDays.some((day) => day.dayNumber === activeDayNumber)) {
      setActiveDayNumber(groupedDays[0].dayNumber);
    }
  }, [groupedDays, activeDayNumber]);

  useEffect(() => {
    const nextCollapsed: Record<string, boolean> = {};
    for (const day of groupedDays) {
      for (const activity of day.activities) {
        nextCollapsed[activity.id] = true;
      }
    }
    setCollapsedActivityCards(nextCollapsed);
  }, [groupedDays]);

  const scrollToDay = (dayNumber: number) => {
    if (scrollContainerRef.current) {
      const index = groupedDays.findIndex((day) => day.dayNumber === dayNumber);
      if (index === -1) return;
      const scrollAmount = scrollContainerRef.current.clientWidth * index;
      scrollContainerRef.current.scrollTo({
        left: scrollAmount,
        behavior: "smooth",
      });
      setActiveDayNumber(dayNumber);
      onDayChange?.(dayNumber);
    }
  };

  const handleMoveStart = (activityId: string, fromDay: number) => {
    setMovingActivity({ id: activityId, fromDay });
  };

  const handleMoveConfirm = (toDay: number) => {
    if (movingActivity && movingActivity.fromDay !== toDay) {
      onMoveActivity(movingActivity.id, movingActivity.fromDay, toDay);
    }
    setMovingActivity(null);
  };

  const handleMoveCancel = () => {
    setMovingActivity(null);
  };

  const toggleActivityCollapse = (activityId: string) => {
    setCollapsedActivityCards((prev) => ({
      ...prev,
      [activityId]: !prev[activityId],
    }));
  };

  const ActivityItem = ({
    activity,
    dayNumber,
    index,
    timeSlotLabel,
    affordLabel,
  }: {
    activity: SuggestedActivity;
    dayNumber: number;
    index: number;
    timeSlotLabel?: string;
    affordLabel?: string;
  }) => {
    const isMoving = movingActivity?.id === activity.id;
    const isCollapsed = collapsedActivityCards[activity.id] ?? true;
    const moveControls = (
      <div className="pt-3 mt-3 border-t border-gray-50">
        {affordLabel ? <p className="mb-2 text-[11px] text-gray-500">{affordLabel}</p> : null}
        {isMoving ? (
          <div className="flex items-center gap-2">
            <Select onValueChange={(val) => handleMoveConfirm(parseInt(val, 10))}>
              <SelectTrigger className="flex-1 h-8 text-[10px]">
                <SelectValue placeholder="Move to day..." />
              </SelectTrigger>
              <SelectContent>
                {groupedDays.map((day) => (
                  <SelectItem key={day.dayNumber} value={day.dayNumber.toString()}>
                    Day {day.dayNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleMoveCancel} className="h-8 px-2 text-[10px]">
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleMoveStart(activity.id, dayNumber)}
            className="w-full h-8 text-[10px] font-medium text-gray-500 hover:text-primary hover:border-primary transition-colors"
          >
            Change Day
          </Button>
        )}
      </div>
    );

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
          onToggleCollapse={() => toggleActivityCollapse(activity.id)}
          extraContent={moveControls}
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
        onToggleCollapse={() => toggleActivityCollapse(activity.id)}
        extraContent={moveControls}
      />
    );
  };

  const parseEstimatedHours = (duration?: string | null): number => {
    if (!duration) return 2;
    const text = duration.toLowerCase().trim();
    if (!text) return 2;

    const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      const min = Number(rangeMatch[1]);
      const max = Number(rangeMatch[2]);
      if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
        return (min + max) / 2;
      }
    }

    const singleHourMatch = text.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)/);
    if (singleHourMatch) {
      const value = Number(singleHourMatch[1]);
      if (Number.isFinite(value)) return value;
    }

    if (/half\s*day/.test(text)) return 4;
    if (/full\s*day|all\s*day/.test(text)) return 7;
    if (/30\s*min/.test(text)) return 0.5;
    if (/45\s*min/.test(text)) return 0.75;
    return 2;
  };

  const haversineKm = (
    from: { lat: number; lng: number } | null | undefined,
    to: { lat: number; lng: number } | null | undefined,
  ): number | null => {
    if (!from || !to) return null;
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const estimateCommuteMinutes = (
    from: { lat: number; lng: number } | null | undefined,
    to: { lat: number; lng: number } | null | undefined,
  ): number => {
    const distanceKm = haversineKm(from, to);
    if (distanceKm == null) return 25;
    const minutes = Math.round((distanceKm / 22) * 60);
    return Math.max(10, Math.min(50, minutes));
  };

  const formatHourLabel = (hours: number): string => {
    const rounded = Math.round(hours * 10) / 10;
    if (Math.abs(rounded - 1) < 0.01) return "1 hr";
    return `${rounded} hrs`;
  };

  const toClockLabel = (minutes: number): string => {
    const clamped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
  };

  const toRangeLabel = (startMinutes: number, endMinutes: number): string =>
    `${toClockLabel(startMinutes)}-${toClockLabel(endMinutes)}`;

  const roundToQuarter = (value: number): number => Math.round(value / 15) * 15;

  const DayTimelineRows = ({ day }: { day: GroupedDay }) => {
    const availableVisitHours = 8;
    const lunchHours = 1;
    const totalCommuteHoursEstimate = Math.max(day.activities.length - 1, 0) * (25 / 60);
    const remainingForActivities = Math.max(availableVisitHours - lunchHours - totalCommuteHoursEstimate, 2);
    const totalRequestedHours = day.activities.reduce((sum, activity) => sum + parseEstimatedHours(activity.estimatedDuration), 0);

    const sortedActivities = [...day.activities].sort((a, b) => {
      const score: Record<SuggestedActivity["bestTimeOfDay"], number> = {
        morning: 0,
        afternoon: 1,
        evening: 2,
        any: 3,
      };
      return score[a.bestTimeOfDay] - score[b.bestTimeOfDay];
    });

    if (sortedActivities.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-sky-200 bg-sky-50/40 p-3 text-xs text-sky-800">
          No activities yet. Reserve about 1 hr for lunch and keep 2-3 flexible hours.
        </div>
      );
    }

    type TimelineItem =
      | {
          type: "activity";
          id: string;
          activity: SuggestedActivity;
          timeRange: string;
          affordLabel: string;
        }
      | {
          type: "lunch" | "commute" | "continue";
          id: string;
          title: string;
          detail: string;
          timeRange: string;
        };

    const timelineItems: TimelineItem[] = [];
    let cursorMinutes = 9 * 60 + 30;
    const lunchMinStart = 12 * 60;
    const lunchTargetStart = 12 * 60 + 30;
    let lunchInserted = false;

    sortedActivities.forEach((activity, index) => {
      const requestedHours = parseEstimatedHours(activity.estimatedDuration);
      const allocatedHours =
        totalRequestedHours > 0 ? Math.max(0.75, (requestedHours / totalRequestedHours) * remainingForActivities) : 1.5;
      const activityMinutes = Math.max(45, roundToQuarter(allocatedHours * 60 + 15));
      const activityStart = roundToQuarter(cursorMinutes);
      const activityEnd = activityStart + activityMinutes;
      const lunchMinutes = roundToQuarter(60 + 15);

      // If a long activity crosses lunch, split it into before-lunch and continue-after-lunch.
      const crossesLunchWindow = !lunchInserted && activityStart < lunchTargetStart && activityEnd > lunchTargetStart;
      if (crossesLunchWindow) {
        const lunchStart = roundToQuarter(Math.max(lunchTargetStart, lunchMinStart));
        const lunchEnd = lunchStart + lunchMinutes;
        const beforeLunchEnd = Math.max(activityStart + 30, lunchStart);
        const afterLunchStart = lunchEnd;
        const afterLunchEnd = afterLunchStart + Math.max(30, activityEnd - beforeLunchEnd);

        timelineItems.push({
          type: "activity",
          id: `activity-${activity.id}`,
          activity,
          timeRange: toRangeLabel(activityStart, beforeLunchEnd),
          affordLabel: `Spend up to ${formatHourLabel(allocatedHours)} here`,
        });
        timelineItems.push({
          type: "lunch",
          id: `lunch-${day.dayNumber}`,
          title: "Lunch break",
          detail: "Includes a small buffer before/after lunch",
          timeRange: toRangeLabel(lunchStart, lunchEnd),
        });
        timelineItems.push({
          type: "continue",
          id: `continue-${activity.id}`,
          title: `Continue with ${activity.name}`,
          detail: "Resume after lunch",
          timeRange: toRangeLabel(afterLunchStart, afterLunchEnd),
        });

        lunchInserted = true;
        cursorMinutes = afterLunchEnd;
      } else {
        // If it's already afternoon and lunch isn't inserted yet, place lunch before this activity.
        if (!lunchInserted && activityStart >= lunchMinStart) {
          const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
          const lunchEnd = lunchStart + lunchMinutes;
          timelineItems.push({
            type: "lunch",
            id: `lunch-${day.dayNumber}`,
            title: "Lunch break",
            detail: "Includes a small buffer before/after lunch",
            timeRange: toRangeLabel(lunchStart, lunchEnd),
          });
          cursorMinutes = lunchEnd;
        }

        const nextActivityStart = roundToQuarter(cursorMinutes);
        const nextActivityEnd = nextActivityStart + activityMinutes;
        timelineItems.push({
          type: "activity",
          id: `activity-${activity.id}`,
          activity,
          timeRange: toRangeLabel(nextActivityStart, nextActivityEnd),
          affordLabel: `Spend up to ${formatHourLabel(allocatedHours)} here`,
        });
        cursorMinutes = nextActivityEnd;
      }

      if (!lunchInserted && timelineItems.some((item) => item.type === "lunch")) {
        lunchInserted = true;
      }

      const next = sortedActivities[index + 1];
      if (next) {
        const commuteMinutes = estimateCommuteMinutes(activity.coordinates, next.coordinates);
        const bufferedCommuteMinutes = roundToQuarter(commuteMinutes + 15);
        const commuteStart = roundToQuarter(cursorMinutes);
        const commuteEnd = commuteStart + bufferedCommuteMinutes;
        timelineItems.push({
          type: "commute",
          id: `commute-${activity.id}-${next.id}`,
          title: "Commute",
          detail: `Approx ${commuteMinutes} min travel + buffer`,
          timeRange: toRangeLabel(commuteStart, commuteEnd),
        });
        cursorMinutes = commuteEnd;
      }
    });

    // Ensure lunch is always present in the afternoon even if all activities finished early.
    if (!lunchInserted) {
      const lunchMinutes = roundToQuarter(60 + 15);
      const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
      const lunchEnd = lunchStart + lunchMinutes;
      timelineItems.push({
        type: "lunch",
        id: `lunch-${day.dayNumber}`,
        title: "Lunch break",
        detail: "Includes a small buffer before/after lunch",
        timeRange: toRangeLabel(lunchStart, lunchEnd),
      });
    }

    return (
      <>
        <div className="rounded-lg border border-sky-100 bg-sky-50/40 p-2 text-[11px] text-sky-800">
          Timeline is approximate. Daily budget: {formatHourLabel(availableVisitHours)}
        </div>
        <div className="space-y-2">
          {timelineItems.map((item, index) => {
            const isLast = index === timelineItems.length - 1;
            const dotClass =
              item.type === "activity"
                ? "bg-sky-500 border-sky-600"
                : item.type === "lunch"
                  ? "bg-amber-400 border-amber-500"
                  : item.type === "continue"
                    ? "bg-sky-300 border-sky-400"
                    : "bg-gray-300 border-gray-400";

            return (
              <div key={item.id} className="flex gap-3">
                <div className="w-10 shrink-0 relative flex flex-col items-center">
                  <div className={`mt-2 h-3 w-3 rounded-full border-2 ${dotClass}`} />
                  {!isLast ? <div className="w-px flex-1 bg-gray-200 my-1" /> : null}
                </div>
                <div className="flex-1 pb-2">
                  {item.type === "activity" ? (
                    <ActivityItem
                      activity={item.activity}
                      dayNumber={day.dayNumber}
                      index={sortedActivities.findIndex((a) => a.id === item.activity.id)}
                      timeSlotLabel={item.timeRange}
                      affordLabel={item.affordLabel}
                    />
                  ) : (
                    <div
                      className={`rounded-md border p-2 text-xs ${
                        item.type === "lunch"
                          ? "border-amber-200 bg-amber-50/60"
                          : item.type === "continue"
                            ? "border-sky-200 bg-sky-50/60"
                            : "border-gray-200 bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-800">{item.title}</p>
                          <p className="text-gray-600">{item.detail}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`h-5 ${
                            item.type === "lunch"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : item.type === "continue"
                                ? "bg-sky-50 text-sky-700 border-sky-200"
                                : "bg-gray-50 text-gray-600 border-gray-200"
                          }`}
                        >
                          {item.timeRange}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-primary" />
            Organize Your Days
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Review the daily flow or shuffle activities to perfect your trip
          </p>
        </div>
        <Button onClick={onConfirm} disabled={isLoading} className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 h-11 shrink-0">
          {isLoading ? "Confirming..." : "Confirm Grouping"}
        </Button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* Day tabs */}
        <div className="flex items-center justify-between mb-4 shrink-0 px-2">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest px-1">Planned Highlights</h3>
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            {groupedDays.map((day) => (
              <Button
                key={day.dayNumber}
                type="button"
                variant={activeDayNumber === day.dayNumber ? "default" : "outline"}
                size="sm"
                onClick={() => scrollToDay(day.dayNumber)}
                className="h-8 px-3 whitespace-nowrap"
              >
                Day {day.dayNumber}
              </Button>
            ))}
          </div>
        </div>

        {/* Day-based horizontal carousel */}
        <div
          ref={scrollContainerRef}
          className="flex-1 flex overflow-x-auto snap-x snap-mandatory scrollbar-none"
          style={{ scrollBehavior: 'smooth' }}
        >
          {groupedDays.map((day) => (
            <div key={day.dayNumber} className="w-full flex-shrink-0 snap-center px-2">
              <Card className="h-full border-t-4 flex flex-col" style={{ borderTopColor: getDayColor(day.dayNumber) }}>
                <CardHeader className="pb-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge className={`${getDayBadgeColors(day.dayNumber)} h-6 px-2`}>
                          Day {day.dayNumber}
                        </Badge>
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                          {day.activities.length} Activities
                        </span>
                      </div>
                      <CardTitle className="text-xl">{day.theme}</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full px-4 pb-6">
                    <div className="space-y-3">
                      <DayTimelineRows day={day} />
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          ))}
          {groupedDays.length === 0 && (
            <div className="w-full py-12 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed mx-2">
              <MapPin className="w-8 h-8 mb-2 opacity-20" />
              <p>No activities planned yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
