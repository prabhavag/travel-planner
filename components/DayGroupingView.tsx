"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
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
import { MapPin, ListChecks, Home, AlertTriangle, Utensils } from "lucide-react";
import { computeRoutes } from "@/lib/api-client";
import type { GroupedDay, SuggestedActivity, TripInfo } from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";
import { ActivityCard } from "@/components/ActivityCard";
import { ResearchOptionCard } from "@/components/ResearchOptionCard";

interface DayGroupingViewProps {
  groupedDays: GroupedDay[];
  userPreferences?: string[];
  destination?: string | null;
  tripInfo?: Pick<
    TripInfo,
    "arrivalAirport" | "departureAirport" | "arrivalTimePreference" | "departureTimePreference" | "transportMode"
  >;
  onMoveActivity: (activityId: string, fromDay: number, toDay: number) => void;
  onConfirm: () => void;
  onDayChange?: (dayNumber: number) => void;
  isLoading?: boolean;
  headerActions?: ReactNode;
}

export function DayGroupingView({
  groupedDays,
  userPreferences = [],
  destination = null,
  tripInfo,
  onMoveActivity,
  onConfirm,
  onDayChange,
  isLoading = false,
  headerActions = null,
}: DayGroupingViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [movingActivity, setMovingActivity] = useState<{
    id: string;
    fromDay: number;
  } | null>(null);
  const [collapsedActivityCards, setCollapsedActivityCards] = useState<Record<string, boolean>>({});
  const [activeDayNumber, setActiveDayNumber] = useState<number | null>(groupedDays[0]?.dayNumber ?? null);
  const [commuteByLeg, setCommuteByLeg] = useState<Record<string, { minutes: number; mode: CommuteMode }>>({});

  type CommuteMode = "TRAIN" | "TRANSIT" | "WALK" | "DRIVE";

  const buildLegId = (dayNumber: number, fromId: string, toId: string) =>
    `${dayNumber}:${fromId}->${toId}`;
  const buildStayStartLegId = (dayNumber: number, toId: string) => `${dayNumber}:stay-start->${toId}`;
  const buildStayEndLegId = (dayNumber: number, fromId: string) => `${dayNumber}:${fromId}->stay-end`;

  const getStartStayCoordinates = useCallback((day: GroupedDay, dayIndex: number): { lat: number; lng: number } | null => {
    if (dayIndex > 0) {
      return groupedDays[dayIndex - 1]?.nightStay?.coordinates ?? null;
    }

    // Day 1 should not inherit night-stay coordinates as start; that creates unrealistic first-leg commutes.
    const routeLike = day.activities.find((activity) => activity.locationMode === "route");
    if (routeLike) {
      return routeLike.startCoordinates || routeLike.coordinates || null;
    }
    return null;
  }, [groupedDays]);

  const parseClockMinutes = useCallback((value?: string | null): number | null => {
    if (!value) return null;
    const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = Number(match[1]) % 12;
    const minute = Number(match[2] || "0");
    if (match[3].toUpperCase() === "PM") hour += 12;
    if (minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }, []);

  const sunsetMinutes = useMemo(() => {
    // Default to 6:00 PM; later this can be set from destination/date-aware sunset data.
    const configuredSunset = (tripInfo as TripInfo & { sunsetTime?: string | null } | undefined)?.sunsetTime;
    return parseClockMinutes(configuredSunset) ?? 18 * 60;
  }, [parseClockMinutes, tripInfo]);

  const inferDaylightPreference = useCallback((activity: SuggestedActivity): "daylight_only" | "night_only" | "flexible" => {
    if (activity.daylightPreference) return activity.daylightPreference;
    const tags = (activity.interestTags || []).join(" ");
    const category = activity.researchOption?.category || "";
    const text = `${activity.name} ${activity.type} ${tags} ${category}`.toLowerCase();
    if (/(night snorkel|night snorkeling|night dive|moonlight|stargaz|astronomy|night tour|after dark|biolumines|sunset cruise)/i.test(text)) {
      return "night_only";
    }
    if (/(snorkel|snorkeling|scuba|dive|surf|kayak|paddle|canoe|boat tour|hike|trail|outdoor|national park|waterfall|beach)/i.test(text)) {
      return "daylight_only";
    }
    return "flexible";
  }, []);

  const timingPriorityRank = useCallback((activity: SuggestedActivity): number => {
    const preference = inferDaylightPreference(activity);
    if (preference === "daylight_only") return 0;
    if (preference === "flexible") return 1;
    return 2;
  }, [inferDaylightPreference]);

  const daylightEndCapMinutes = useCallback((activity: SuggestedActivity, dayCutoffMinutes: number): number | null => {
    const preference = inferDaylightPreference(activity);
    if (preference !== "daylight_only") return null;
    return Math.min(dayCutoffMinutes, sunsetMinutes);
  }, [inferDaylightPreference, sunsetMinutes]);

  const nightOnlyStartFloorMinutes = useCallback((activity: SuggestedActivity): number | null => {
    return inferDaylightPreference(activity) === "night_only" ? sunsetMinutes : null;
  }, [inferDaylightPreference, sunsetMinutes]);

  const sortActivitiesForTimeline = useCallback((activities: SuggestedActivity[]) => {
    const score: Record<SuggestedActivity["bestTimeOfDay"], number> = {
      morning: 0,
      afternoon: 1,
      evening: 2,
      any: 3,
    };
    const fixedRank = (activity: SuggestedActivity): number => (activity.isFixedStartTime ? 0 : 1);
    const fixedMinutes = (activity: SuggestedActivity): number | null => parseFixedStartTimeMinutes(activity.fixedStartTime);

    return [...activities].sort((a, b) => {
      const fixedRankDelta = fixedRank(a) - fixedRank(b);
      if (fixedRankDelta !== 0) return fixedRankDelta;

      if (a.isFixedStartTime && b.isFixedStartTime) {
        const aMinutes = fixedMinutes(a);
        const bMinutes = fixedMinutes(b);
        if (aMinutes != null && bMinutes != null && aMinutes !== bMinutes) {
          return aMinutes - bMinutes;
        }
        if (aMinutes != null && bMinutes == null) return -1;
        if (aMinutes == null && bMinutes != null) return 1;
      }

      const timingPriorityDelta = timingPriorityRank(a) - timingPriorityRank(b);
      if (timingPriorityDelta !== 0) return timingPriorityDelta;

      return score[a.bestTimeOfDay] - score[b.bestTimeOfDay];
    });
  }, [timingPriorityRank]);

  const getCommutePoint = useCallback((activity: SuggestedActivity) => {
    if (activity.locationMode === "route") {
      return activity.startCoordinates || activity.endCoordinates || activity.coordinates || null;
    }
    return activity.coordinates || activity.startCoordinates || activity.endCoordinates || null;
  }, []);

  const isRailFriendlyDestination = useMemo(() => {
    const normalized = destination?.toLowerCase().trim();
    if (!normalized) return false;
    return /(switzerland|swiss|europe|europa|austria|germany|france|italy|spain|netherlands|belgium|portugal|czech|hungary|poland|denmark|norway|sweden|finland)/.test(
      normalized
    );
  }, [destination]);

  const commuteLegs = useMemo(() => {
    const legs: Array<{
      id: string;
      origin: { lat: number; lng: number };
      destination: { lat: number; lng: number };
      mode: CommuteMode;
      travelMode: "DRIVE" | "WALK" | "TRANSIT";
    }> = [];
    groupedDays.forEach((day, dayIndex) => {
      const sorted = sortActivitiesForTimeline(day.activities);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const startStayCoordinates = getStartStayCoordinates(day, dayIndex);
      const endStayCoordinates = day.nightStay?.coordinates;

      if (first && startStayCoordinates) {
        const firstPoint = getCommutePoint(first);
        if (firstPoint) {
          const mode = pickCommuteMode(startStayCoordinates, firstPoint, isRailFriendlyDestination);
          legs.push({
            id: buildStayStartLegId(day.dayNumber, first.id),
            origin: startStayCoordinates,
            destination: firstPoint,
            mode,
            travelMode: toTravelMode(mode),
          });
        }
      }

      sorted.forEach((activity, index) => {
        const next = sorted[index + 1];
        if (!next) return;
        const fromPoint = getCommutePoint(activity);
        const toPoint = getCommutePoint(next);
        if (!fromPoint || !toPoint) return;
        const mode = pickCommuteMode(fromPoint, toPoint, isRailFriendlyDestination);
        legs.push({
          id: buildLegId(day.dayNumber, activity.id, next.id),
          origin: fromPoint,
          destination: toPoint,
          mode,
          travelMode: toTravelMode(mode),
        });
      });

      if (last && endStayCoordinates) {
        const lastPoint = getCommutePoint(last);
        if (lastPoint) {
          const mode = pickCommuteMode(lastPoint, endStayCoordinates, isRailFriendlyDestination);
          legs.push({
            id: buildStayEndLegId(day.dayNumber, last.id),
            origin: lastPoint,
            destination: endStayCoordinates,
            mode,
            travelMode: toTravelMode(mode),
          });
        }
      }
    });
    return legs;
  }, [groupedDays, sortActivitiesForTimeline, isRailFriendlyDestination, getCommutePoint, getStartStayCoordinates]);

  const commuteLegById = useMemo(() => {
    const next: Record<string, { mode: CommuteMode; origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }> =
      {};
    commuteLegs.forEach((leg) => {
      next[leg.id] = { mode: leg.mode, origin: leg.origin, destination: leg.destination };
    });
    return next;
  }, [commuteLegs]);

  const commuteLegsToFetch = useMemo(
    () => commuteLegs.filter((leg) => commuteByLeg[leg.id] == null),
    [commuteLegs, commuteByLeg]
  );

  useEffect(() => {
    if (commuteLegsToFetch.length === 0) return;
    let isActive = true;
    computeRoutes(commuteLegsToFetch)
      .then((result) => {
        if (!isActive || !result?.legs) return;
        const updates: Record<string, { minutes: number; mode: CommuteMode }> = {};
        result.legs.forEach((leg) => {
          const sourceLeg = commuteLegById[leg.id];
          if (!sourceLeg) return;
          if (leg.durationSeconds != null) {
            updates[leg.id] = {
              minutes: Math.max(5, Math.round(leg.durationSeconds / 60)),
              mode: sourceLeg.mode,
            };
          }
        });
        if (Object.keys(updates).length > 0) {
          setCommuteByLeg((prev) => ({ ...prev, ...updates }));
        }
      })
      .catch(() => {
        // Ignore route API failures and fall back to local estimates.
      });

    return () => {
      isActive = false;
    };
  }, [commuteLegById, commuteLegsToFetch]);

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

  function haversineKm(
    from: { lat: number; lng: number } | null | undefined,
    to: { lat: number; lng: number } | null | undefined,
  ): number | null {
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
  }

  function estimateCommuteMinutes(
    from: { lat: number; lng: number } | null | undefined,
    to: { lat: number; lng: number } | null | undefined,
  ): number {
    const distanceKm = haversineKm(from, to);
    if (distanceKm == null) return 25;
    // Fallback only: inflate straight-line distance into road distance and use conservative speeds.
    const roadDistanceKm =
      distanceKm < 10
        ? distanceKm * 1.35
        : distanceKm < 30
          ? distanceKm * 1.6
          : distanceKm * 1.75;
    const speedKph =
      distanceKm < 10
        ? 28
        : distanceKm < 30
          ? 20
          : 40;
    const minutes = Math.round((roadDistanceKm / speedKph) * 60);
    return Math.max(10, minutes);
  }

  function pickCommuteMode(
    from: { lat: number; lng: number } | null | undefined,
    to: { lat: number; lng: number } | null | undefined,
    railFriendlyDestination: boolean
  ): CommuteMode {
    const distanceKm = haversineKm(from, to);
    if (distanceKm == null) return railFriendlyDestination ? "TRAIN" : "DRIVE";
    if (distanceKm <= 1.5) return "WALK";
    if (railFriendlyDestination && distanceKm >= 3 && distanceKm <= 250) return "TRAIN";
    // Default to driving for non-rail destinations; transit heuristics produce unrealistic legs.
    return "DRIVE";
  }

  function toTravelMode(mode: CommuteMode): "DRIVE" | "WALK" | "TRANSIT" {
    if (mode === "WALK") return "WALK";
    if (mode === "TRAIN" || mode === "TRANSIT") return "TRANSIT";
    return "DRIVE";
  }

  function commuteModeLabel(mode: CommuteMode): string {
    if (mode === "TRAIN") return "Train";
    if (mode === "TRANSIT") return "Transit";
    if (mode === "WALK") return "Walk";
    return "Drive";
  }

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

  const formatRecommendedStartWindowLabel = (activity: SuggestedActivity): string | null => {
    const window = activity.recommendedStartWindow;
    if (!window?.start || !window?.end) return null;
    const start = parseFixedStartTimeMinutes(window.start);
    const end = parseFixedStartTimeMinutes(window.end);
    if (start == null || end == null) return null;
    return `${toClockLabel(start)}-${toClockLabel(end)}`;
  };

  const roundToQuarter = (value: number): number => Math.round(value / 15) * 15;
  const REGULAR_DAY_START_MINUTES = 9 * 60 + 30; // 9:30 AM
  const REGULAR_DAY_END_MINUTES = REGULAR_DAY_START_MINUTES + 8 * 60; // 5:30 PM
  const OFF_HOURS_ACTIVITY_DISCOUNT = 0.3;

  function parseFixedStartTimeMinutes(value?: string | null): number | null {
    if (!value) return null;
    const text = value.trim().toLowerCase();
    if (!text) return null;
    if (text === "sunrise") return 6 * 60;
    if (text === "sunset") return 18 * 60;

    const meridiemMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (meridiemMatch) {
      let hour = Number(meridiemMatch[1]) % 12;
      const minute = Number(meridiemMatch[2] || "0");
      if (meridiemMatch[3].toLowerCase() === "pm") hour += 12;
      if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return hour * 60 + minute;
    }

    const twentyFourMatch = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (twentyFourMatch) {
      const hour = Number(twentyFourMatch[1]);
      const minute = Number(twentyFourMatch[2]);
      return hour * 60 + minute;
    }

    return null;
  }

  function activityLoadFactor(activity: SuggestedActivity): number {
    if (!activity.isFixedStartTime) return 1;
    const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime);
    if (fixedStartMinutes != null && fixedStartMinutes <= 7 * 60) return 0.7;
    if ((activity.fixedStartTime || "").toLowerCase() === "sunrise") return 0.7;
    if (fixedStartMinutes == null && activity.bestTimeOfDay === "morning") return 0.7;
    return 1;
  }

  const getDayStartContext = useCallback(
    (dayIndex: number, fallbackStayLabel?: string | null) => {
      if (dayIndex !== 0) {
        return {
          startTitle: "Start from stay",
          startLabel: fallbackStayLabel || null,
          dayStartMinutes: 9 * 60 + 30,
          availableVisitHours: 8,
        };
      }

      const arrivalTiming = tripInfo?.arrivalTimePreference || "12:00 PM";
      const arrivalAirport = tripInfo?.arrivalAirport || "arrival airport";
      const arrivalMinutes = parseClockMinutes(arrivalTiming) ?? 12 * 60;
      const isMorningArrival = arrivalMinutes < 12 * 60;
      const startAfterArrival = Math.max(8 * 60 + 30, Math.min(19 * 60, arrivalMinutes + 120));
      const availableVisitHours = Math.max(2.5, Math.min(8, (20 * 60 - startAfterArrival) / 60));

      if (isMorningArrival) {
        return {
          startTitle: `Arrive at airport (${arrivalTiming})`,
          startLabel: `${arrivalAirport} · assumed arrival ${arrivalTiming}`,
          dayStartMinutes: Math.max(9 * 60, startAfterArrival),
          availableVisitHours: Math.max(4, availableVisitHours),
        };
      }

      return {
        startTitle: `Arrival + hotel check-in (${arrivalTiming})`,
        startLabel: `${arrivalAirport} · assumed arrival ${arrivalTiming}`,
        dayStartMinutes: startAfterArrival,
        availableVisitHours,
      };
    },
    [tripInfo?.arrivalAirport, tripInfo?.arrivalTimePreference]
  );

  const DayTimelineRows = ({
    day,
    dayIndex,
    startStayLabel,
    endStayLabel,
    startStayCoordinates,
    endStayCoordinates,
  }: {
    day: GroupedDay;
    dayIndex: number;
    startStayLabel?: string | null;
    endStayLabel?: string | null;
    startStayCoordinates?: { lat: number; lng: number } | null;
    endStayCoordinates?: { lat: number; lng: number } | null;
  }) => {
    const startContext = getDayStartContext(dayIndex, startStayLabel);
    const availableVisitHours = startContext.availableVisitHours;
    const isLastDay = dayIndex === groupedDays.length - 1;
    const lunchHours = 1;
    const sortedActivities = sortActivitiesForTimeline(day.activities);
    const totalCommuteMinutesEstimate = sortedActivities.reduce((sum, activity, index) => {
      const next = sortedActivities[index + 1];
      if (!next) return sum;
      const legId = buildLegId(day.dayNumber, activity.id, next.id);
      const fallbackMinutes =
        estimateCommuteMinutes(getCommutePoint(activity), getCommutePoint(next));
      const commuteMinutes = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
      return sum + commuteMinutes;
    }, 0);
    const firstActivity = sortedActivities[0];
    const lastActivity = sortedActivities[sortedActivities.length - 1];
    const stayStartCommuteMinutes =
      startContext.startLabel && firstActivity && startStayCoordinates
        ? (commuteByLeg[buildStayStartLegId(day.dayNumber, firstActivity.id)]?.minutes ??
          estimateCommuteMinutes(startStayCoordinates, getCommutePoint(firstActivity)))
        : 0;
    const stayStartCommuteMode: CommuteMode =
      startContext.startLabel && firstActivity && startStayCoordinates
        ? pickCommuteMode(startStayCoordinates, getCommutePoint(firstActivity), isRailFriendlyDestination)
        : isRailFriendlyDestination
          ? "TRAIN"
          : "DRIVE";
    const stayEndCommuteMinutes =
      endStayLabel && lastActivity && endStayCoordinates
        ? (commuteByLeg[buildStayEndLegId(day.dayNumber, lastActivity.id)]?.minutes ??
          estimateCommuteMinutes(getCommutePoint(lastActivity), endStayCoordinates))
        : 0;
    const stayEndCommuteMode: CommuteMode =
      endStayLabel && lastActivity && endStayCoordinates
        ? pickCommuteMode(getCommutePoint(lastActivity), endStayCoordinates, isRailFriendlyDestination)
        : isRailFriendlyDestination
          ? "TRAIN"
          : "DRIVE";
    const totalCommuteHoursEstimate = (totalCommuteMinutesEstimate + stayStartCommuteMinutes + stayEndCommuteMinutes) / 60;
    const remainingForActivities = Math.max(availableVisitHours - lunchHours - totalCommuteHoursEstimate, 0);
    const totalRequestedHours = day.activities.reduce(
      (sum, activity) => sum + parseEstimatedHours(activity.estimatedDuration) * activityLoadFactor(activity),
      0
    );
    const freeActivityHours = Math.max(0, remainingForActivities - totalRequestedHours);
    const earliestFixedStartMinutes = sortedActivities
      .filter((activity) => activity.isFixedStartTime)
      .map((activity) => parseFixedStartTimeMinutes(activity.fixedStartTime))
      .filter((minutes): minutes is number => minutes != null)
      .sort((a, b) => a - b)[0];
    const hadVeryEarlyFixedStart =
      (earliestFixedStartMinutes != null && earliestFixedStartMinutes <= 6 * 60) ||
      sortedActivities.some((activity) => activity.isFixedStartTime && activity.fixedStartTime?.toLowerCase() === "sunrise");
    const freeSlotSuggestion = hadVeryEarlyFixedStart
      ? "Optional light add-on: beach, cafe, or sunset viewpoint near your stay."
      : "A slot is free, consider adding or moving an activity.";
    const scaleFactor =
      totalRequestedHours > 0 && totalRequestedHours > remainingForActivities && remainingForActivities > 0
        ? remainingForActivities / totalRequestedHours
        : 1;
    let scheduledActivityMinutes = 0;
    let effectiveActivityMinutesForOverload = 0;
    let scheduledCommuteMinutes = 0;
    const trackActivityMinutes = (startMinutes: number, endMinutes: number) => {
      const rawMinutes = Math.max(0, endMinutes - startMinutes);
      const inWindowStart = Math.max(startMinutes, REGULAR_DAY_START_MINUTES);
      const inWindowEnd = Math.min(endMinutes, REGULAR_DAY_END_MINUTES);
      const inWindowMinutes = Math.max(0, inWindowEnd - inWindowStart);
      const offWindowMinutes = Math.max(0, rawMinutes - inWindowMinutes);
      scheduledActivityMinutes += rawMinutes;
      effectiveActivityMinutesForOverload += inWindowMinutes + offWindowMinutes * OFF_HOURS_ACTIVITY_DISCOUNT;
    };

    if (sortedActivities.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-sky-200 bg-sky-50/40 p-3 text-xs text-sky-800">
          No activities yet. Reserve about 1 hr for lunch and keep 2-3 flexible hours.
        </div>
      );
    }

    type TimelineItem =
      | {
          type: "stay";
          id: string;
          title: string;
          detail: string;
        }
      | {
          type: "activity";
          id: string;
          activity: SuggestedActivity;
          timeRange: string;
          affordLabel: string;
        }
      | {
          type: "lunch" | "commute" | "continue" | "free";
          id: string;
          title: string;
          detail: string;
          timeRange: string;
        };

    const timelineItems: TimelineItem[] = [];
    const departureClock = tripInfo?.departureTimePreference || "6:00 PM";
    const departureMinutes = parseClockMinutes(departureClock) ?? 18 * 60;
    const prepBufferMinutes = tripInfo?.transportMode === "car" ? 180 : 150;
    const eveningCutoffMinutes = isLastDay ? Math.max(10 * 60, departureMinutes - prepBufferMinutes) : 18 * 60;
    const lunchMinStart = 12 * 60;
    const lunchTargetStart = 12 * 60 + 30;
    const lunchBlockMinutes = roundToQuarter(60 + 15);
    const preDayBufferMinutes = 15;
    const bufferedStayStartCommuteMinutes =
      stayStartCommuteMinutes > 0 ? roundToQuarter(stayStartCommuteMinutes + preDayBufferMinutes) : 0;
    const defaultDayStartMinutes = startContext.dayStartMinutes;
    let cursorMinutes =
      earliestFixedStartMinutes != null
        ? Math.max(0, roundToQuarter(earliestFixedStartMinutes - bufferedStayStartCommuteMinutes - preDayBufferMinutes))
        : defaultDayStartMinutes;
    if (startContext.startLabel) {
      timelineItems.push({
        type: "stay",
        id: `stay-start-${day.dayNumber}`,
        title: startContext.startTitle,
        detail: startContext.startLabel,
      });
      if (stayStartCommuteMinutes > 0) {
        // If the day already starts around/after lunch, show lunch before the first commute
        // to avoid a confusing commute->lunch sequence with no destination context.
        if (cursorMinutes >= lunchMinStart) {
          const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
          const lunchEnd = lunchStart + lunchBlockMinutes;
          timelineItems.push({
            type: "lunch",
            id: `lunch-${day.dayNumber}`,
            title: "Lunch break",
            detail: "About 1 hr",
            timeRange: toRangeLabel(lunchStart, lunchEnd),
          });
          cursorMinutes = lunchEnd;
        }
        const bufferedCommuteMinutes = roundToQuarter(stayStartCommuteMinutes + 15);
        const commuteStart = roundToQuarter(cursorMinutes);
        const commuteEnd = commuteStart + bufferedCommuteMinutes;
        scheduledCommuteMinutes += Math.max(0, commuteEnd - commuteStart);
        timelineItems.push({
          type: "commute",
          id: `commute-stay-start-${day.dayNumber}`,
          title: "Commute",
          detail: `${commuteModeLabel(stayStartCommuteMode)} · Approx ${stayStartCommuteMinutes} min`,
          timeRange: toRangeLabel(commuteStart, commuteEnd),
        });
        cursorMinutes = commuteEnd;
      }
    }
    let lunchInserted = timelineItems.some((item) => item.type === "lunch");
    let hasScheduledPrimaryActivity = false;

    sortedActivities.forEach((activity, index) => {
      const requestedHours = parseEstimatedHours(activity.estimatedDuration) * activityLoadFactor(activity);
      const allocatedHours = Math.max(0.75, requestedHours * scaleFactor);
      const activityMinutes = Math.max(45, roundToQuarter(allocatedHours * 60 + 15));
      const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime);
      const fixedAlignedStartMinutes =
        activity.isFixedStartTime && fixedStartMinutes != null ? roundToQuarter(fixedStartMinutes) : null;
      const nightStartFloorMinutes = nightOnlyStartFloorMinutes(activity);
      const activityStart = fixedAlignedStartMinutes != null
        ? Math.max(roundToQuarter(cursorMinutes), fixedAlignedStartMinutes, nightStartFloorMinutes ?? 0)
        : Math.max(roundToQuarter(cursorMinutes), nightStartFloorMinutes ?? 0);
      const uncappedActivityEnd = activityStart + activityMinutes;
      const daylightCapMinutes = daylightEndCapMinutes(activity, eveningCutoffMinutes);
      const activityEnd =
        daylightCapMinutes != null ? Math.min(uncappedActivityEnd, daylightCapMinutes) : uncappedActivityEnd;
      const recommendedWindowEndMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.end);
      const recommendedWindowLabel = formatRecommendedStartWindowLabel(activity);
      const lateStartWarning =
        recommendedWindowEndMinutes != null && activityStart > recommendedWindowEndMinutes
          ? `Late-start risk: recommended ${recommendedWindowLabel || "earlier"}${activity.recommendedStartWindow?.reason ? ` (${activity.recommendedStartWindow.reason})` : ""}.`
          : null;
      const daylightWarning =
        daylightCapMinutes != null && uncappedActivityEnd > daylightCapMinutes
          ? `Ends by ${toClockLabel(daylightCapMinutes)} to stay in daylight.`
          : null;
      const nightOnlyWarning =
        nightStartFloorMinutes != null
          ? `Scheduled after sunset (${toClockLabel(sunsetMinutes)}).`
          : null;
      const combinedWarning = [lateStartWarning, daylightWarning, nightOnlyWarning].filter(Boolean).join(" ");
      const lunchMinutes = roundToQuarter(60 + 15);

      // If a long activity crosses lunch, split it into before-lunch and continue-after-lunch.
      const crossesLunchWindow = !lunchInserted && activityStart < lunchTargetStart && activityEnd > lunchTargetStart;
      if (crossesLunchWindow) {
        const lunchStart = roundToQuarter(Math.max(lunchTargetStart, lunchMinStart));
        const lunchEnd = lunchStart + lunchMinutes;
        const beforeLunchEnd = Math.max(activityStart + 30, lunchStart);
        const afterLunchStart = lunchEnd;
        const afterLunchEnd = afterLunchStart + Math.max(30, activityEnd - beforeLunchEnd);
        trackActivityMinutes(activityStart, beforeLunchEnd);
        trackActivityMinutes(afterLunchStart, afterLunchEnd);

        timelineItems.push({
          type: "activity",
          id: `activity-${activity.id}`,
          activity,
          timeRange: toRangeLabel(activityStart, beforeLunchEnd),
          affordLabel: `Spend up to ${formatHourLabel(allocatedHours)} here${combinedWarning ? ` • ${combinedWarning}` : ""}`,
        });
        timelineItems.push({
          type: "lunch",
          id: `lunch-${day.dayNumber}`,
          title: "Lunch break",
          detail: "About 1 hr",
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
        hasScheduledPrimaryActivity = true;
        cursorMinutes = afterLunchEnd;
      } else {
        // If it's already afternoon and lunch isn't inserted yet, place lunch before this activity
        // only after at least one activity has started (avoid commute -> lunch -> first activity).
        if (!lunchInserted && hasScheduledPrimaryActivity && activityStart >= lunchMinStart) {
          const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
          const lunchEnd = lunchStart + lunchMinutes;
          timelineItems.push({
            type: "lunch",
            id: `lunch-${day.dayNumber}`,
            title: "Lunch break",
            detail: "About 1 hr",
            timeRange: toRangeLabel(lunchStart, lunchEnd),
          });
          cursorMinutes = lunchEnd;
        }

        const nextActivityStart =
          fixedAlignedStartMinutes != null
            ? Math.max(roundToQuarter(cursorMinutes), fixedAlignedStartMinutes, nightStartFloorMinutes ?? 0)
            : Math.max(roundToQuarter(cursorMinutes), nightStartFloorMinutes ?? 0);
        const uncappedNextActivityEnd = nextActivityStart + activityMinutes;
        const nextActivityEnd =
          daylightCapMinutes != null ? Math.min(uncappedNextActivityEnd, daylightCapMinutes) : uncappedNextActivityEnd;
        trackActivityMinutes(nextActivityStart, nextActivityEnd);
        timelineItems.push({
          type: "activity",
          id: `activity-${activity.id}`,
          activity,
          timeRange: toRangeLabel(nextActivityStart, nextActivityEnd),
          affordLabel: `Spend up to ${formatHourLabel(allocatedHours)} here${combinedWarning ? ` • ${combinedWarning}` : ""}`,
        });
        hasScheduledPrimaryActivity = true;
        cursorMinutes = nextActivityEnd;
      }

      if (!lunchInserted && timelineItems.some((item) => item.type === "lunch")) {
        lunchInserted = true;
      }

      const next = sortedActivities[index + 1];
      if (next) {
        const legId = buildLegId(day.dayNumber, activity.id, next.id);
        const fallbackMode = pickCommuteMode(getCommutePoint(activity), getCommutePoint(next), isRailFriendlyDestination);
        const fallbackMinutes = estimateCommuteMinutes(getCommutePoint(activity), getCommutePoint(next));
        const commuteMode = commuteByLeg[legId]?.mode ?? fallbackMode;
        const commuteMinutes = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
        const bufferedCommuteMinutes = roundToQuarter(commuteMinutes + 15);
        const commuteStart = roundToQuarter(cursorMinutes);
        const commuteEnd = commuteStart + bufferedCommuteMinutes;
        scheduledCommuteMinutes += Math.max(0, commuteEnd - commuteStart);
        timelineItems.push({
          type: "commute",
          id: `commute-${activity.id}-${next.id}`,
          title: "Commute",
          detail: `${commuteModeLabel(commuteMode)} · Approx ${commuteMinutes} min`,
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
        detail: "About 1 hr",
        timeRange: toRangeLabel(lunchStart, lunchEnd),
      });
      cursorMinutes = lunchEnd;
      lunchInserted = true;
    }

    let freeSlotMinutesBeforeEvening = 0;
    let freeSlotNoticeText = freeSlotSuggestion;
    const freeStart = roundToQuarter(cursorMinutes);
    const cappedByEveningMinutes = Math.max(0, eveningCutoffMinutes - freeStart);
    const budgetFreeMinutes = Math.min(roundToQuarter(freeActivityHours * 60), roundToQuarter(cappedByEveningMinutes));
    const timelineGapFreeMinutes = roundToQuarter(cappedByEveningMinutes);
    const freeMinutes = budgetFreeMinutes > 0 ? budgetFreeMinutes : timelineGapFreeMinutes;
    const hasVisibleFreeSlot = freeMinutes >= 45;
    freeSlotMinutesBeforeEvening = hasVisibleFreeSlot ? freeMinutes : 0;
    if (hasVisibleFreeSlot) {
      const freeEnd = freeStart + freeMinutes;
      const detail =
        freeStart >= lunchMinStart
          ? "Afternoon slot is open. Add a nearby activity, cafe, or scenic stop."
          : freeSlotSuggestion;
      freeSlotNoticeText = detail;
      timelineItems.push({
        type: "free",
        id: `free-slot-${day.dayNumber}`,
        title: "Free slot",
        detail,
        timeRange: toRangeLabel(freeStart, freeEnd),
      });
      cursorMinutes = freeEnd;
    }
    const showFreeSlotNotice = freeSlotMinutesBeforeEvening >= 45;

    if (endStayLabel) {
      if (stayEndCommuteMinutes > 0) {
        const bufferedCommuteMinutes = roundToQuarter(stayEndCommuteMinutes + 15);
        const commuteStart = roundToQuarter(cursorMinutes);
        const commuteEnd = commuteStart + bufferedCommuteMinutes;
        scheduledCommuteMinutes += Math.max(0, commuteEnd - commuteStart);
        timelineItems.push({
          type: "commute",
          id: `commute-stay-end-${day.dayNumber}`,
          title: "Commute",
          detail: `${commuteModeLabel(stayEndCommuteMode)} · Approx ${stayEndCommuteMinutes} min`,
          timeRange: toRangeLabel(commuteStart, commuteEnd),
        });
        cursorMinutes = commuteEnd;
      }
      timelineItems.push({
        type: "stay",
        id: `stay-end-${day.dayNumber}`,
        title: isLastDay ? "Departure prep" : "End at night stay",
        detail: isLastDay
          ? `Checkout${
              tripInfo?.transportMode === "car" ? ", return rental car," : ","
            } then head to ${tripInfo?.departureAirport || "the airport"} for ${departureClock} departure.`
          : endStayLabel,
      });
    }

    const totalPlannedHours = (scheduledActivityMinutes + scheduledCommuteMinutes) / 60;
    const effectivePlannedHoursForOverload =
      (effectiveActivityMinutesForOverload + scheduledCommuteMinutes) / 60;
    const isOverloaded = !showFreeSlotNotice && effectivePlannedHoursForOverload > availableVisitHours;

    return (
      <>
        {showFreeSlotNotice ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2 text-[11px] text-emerald-900">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{freeSlotNoticeText}</span>
            </div>
          </div>
        ) : null}
        {isOverloaded ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-900">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Overloaded day: ~{formatHourLabel(effectivePlannedHoursForOverload)} effective hrs (raw ~{formatHourLabel(totalPlannedHours)}).
                Consider moving an activity.
              </span>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          {timelineItems.map((item, index) => {
            const isLast = index === timelineItems.length - 1;
            const dotClass =
              item.type === "activity"
                ? "bg-sky-500 border-sky-600"
                : item.type === "lunch"
                  ? "bg-amber-400 border-amber-500"
                  : item.type === "free"
                    ? "bg-emerald-300 border-emerald-400"
                  : item.type === "continue"
                    ? "bg-sky-300 border-sky-400"
                    : item.type === "stay"
                      ? "bg-emerald-400 border-emerald-500"
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
                  ) : item.type === "stay" ? (
                    <div className="flex items-center justify-between gap-3 text-xs text-emerald-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <Home className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="font-medium text-emerald-900">{item.title}</span>
                        <span className="text-emerald-700 truncate">· {item.detail}</span>
                      </div>
                    </div>
                  ) : item.type === "commute" ? (
                    <div className="flex items-center justify-between gap-3 text-xs text-gray-600">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-gray-700">{item.title}</span>
                        <span className="text-gray-500 truncate">· {item.detail}</span>
                      </div>
                      <Badge variant="outline" className="h-5 bg-gray-50 text-gray-600 border-gray-200">
                        {item.timeRange}
                      </Badge>
                    </div>
                  ) : item.type === "lunch" ? (
                    <div className="flex items-center justify-between gap-3 text-xs text-amber-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <Utensils className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                        <span className="font-medium text-amber-900">{item.title}</span>
                        <span className="text-amber-700 truncate">· {item.detail}</span>
                      </div>
                      <Badge variant="outline" className="h-5 bg-amber-50 text-amber-700 border-amber-200">
                        {item.timeRange}
                      </Badge>
                    </div>
                  ) : (
                    <div
                      className={`rounded-md border p-2 text-xs ${
                        item.type === "free"
                            ? "border-emerald-200 bg-emerald-50/70"
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
                            item.type === "free"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
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
        <div className="flex items-center gap-2">
          {headerActions}
          <Button onClick={onConfirm} disabled={isLoading} className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 h-11 shrink-0">
            {isLoading ? "Confirming..." : "Confirm Grouping"}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* Day tabs */}
        <div className="flex items-center justify-between mb-4 shrink-0 px-2">
          <div className="flex items-baseline gap-2 px-1">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Planned Highlights</h3>
            <span className="text-[10px] text-gray-400">Timeline is approximate. Daily budget: 8 hrs</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            {groupedDays.map((day) => {
              const dayColor = getDayColor(day.dayNumber);
              const isActive = activeDayNumber === day.dayNumber;
              return (
                <Button
                  key={day.dayNumber}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => scrollToDay(day.dayNumber)}
                  className="h-8 px-3 whitespace-nowrap border font-semibold transition-colors"
                  style={{
                    backgroundColor: isActive ? dayColor : `${dayColor}1A`,
                    borderColor: isActive ? dayColor : `${dayColor}66`,
                    color: isActive ? "#FFFFFF" : dayColor,
                    boxShadow: isActive ? `0 0 0 2px ${dayColor}33` : "none",
                  }}
                >
                  Day {day.dayNumber}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Day-based horizontal carousel */}
        <div
          ref={scrollContainerRef}
          className="flex-1 flex overflow-x-auto snap-x snap-mandatory scrollbar-none"
          style={{ scrollBehavior: 'smooth' }}
        >
          {groupedDays.map((day, index) => (
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
                      {day.nightStay?.label && (
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          <Home className="h-3.5 w-3.5" />
                          Night stay: {day.nightStay.label}
                        </div>
                      )}
                      {day.nightStay?.candidates && day.nightStay.candidates.length > 0 && (
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          {day.nightStay.candidates.slice(0, 3).map((candidate) => (
                            <div key={candidate.label}>
                              Alt: {candidate.label}
                              {candidate.driveScoreKm != null ? ` · ~${candidate.driveScoreKm} km drive` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full px-4 pb-6">
                    <div className="space-y-3">
                      <DayTimelineRows
                        day={day}
                        dayIndex={index}
                        startStayLabel={groupedDays[index - 1]?.nightStay?.label ?? day.nightStay?.label}
                        endStayLabel={day.nightStay?.label}
                        startStayCoordinates={getStartStayCoordinates(day, index)}
                        endStayCoordinates={day.nightStay?.coordinates}
                      />
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
