"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type DragEvent, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, ListChecks, Home, AlertTriangle, Utensils } from "lucide-react";
import { computeRoutes } from "@/lib/api-client";
import type { ActivityCostDebug, GroupedDay, SuggestedActivity, TripInfo } from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";
import { DayActivityItem } from "@/components/DayActivityItem";
import { DayTimelineRows } from "@/components/DayTimelineRows";
import { computePlannableDurationHours } from "@/lib/planning-flags";
import {
  type CommuteMode,
  REGULAR_DAY_START_MINUTES,
  REGULAR_DAY_END_MINUTES,
  DEFAULT_SUNSET_MINUTES,
  AIRPORT_ARRIVAL_LEAD_MINUTES,
  COMMUTE_TRANSITION_BUFFER_MINUTES,
  DEPARTURE_TRANSFER_MINUTES,
  LUNCH_MIN_START_MINUTES,
  LUNCH_TARGET_START_MINUTES,
  LUNCH_BLOCK_MINUTES,
  PRE_DAY_BUFFER_MINUTES,
  OFF_HOURS_ACTIVITY_DISCOUNT,
  roundToQuarter,
  parseEstimatedHours,
  estimateCommuteMinutes,
  estimateDriveMinutesNoFloor,
  estimateRouteIntrinsicMinutes,
  pickCommuteMode,
  toTravelMode,
  commuteModeLabel,
  formatHourLabel,
  toClockLabel,
  toRangeLabel,
  parseFixedStartTimeMinutes,
  hasHardFixedStart,
  recommendedWindowMidpointMinutes,
  formatRecommendedStartWindowLabel,
  checkRailFriendlyDestination,
  getActivityStartPoint,
  getActivityExitPointToward,
  buildStayStartLegId,
  buildStayEndLegId,
  buildLegId,
  nightOnlyStartFloorMinutes,
  daylightEndCapMinutes,
  getActivityTimingPolicy,
} from "@/lib/utils/timeline-utils";

/** The possible active tab key in the horizontal day carousel. */
type DayTabKey = number | "unscheduled";

interface DayGroupingViewProps {
  groupedDays: GroupedDay[];
  availableActivities?: SuggestedActivity[];
  initialUnscheduledActivityIds?: string[];
  userPreferences?: string[];
  debugMode?: boolean;
  destination?: string | null;
  tripInfo?: Pick<
    TripInfo,
    "arrivalAirport" | "departureAirport" | "arrivalTimePreference" | "departureTimePreference" | "transportMode" | "startDate" | "endDate" | "durationDays"
  >;
  onMoveActivity: (activityId: string, fromDay: number, toDay: number, targetIndex?: number) => void;
  onConfirm: () => void;
  onDayChange?: (dayNumber: number) => void;
  onOverallDebugCostChange?: (totalCost: number | null) => void;
  activityCostDebugById?: Record<string, ActivityCostDebug>;
  isLoading?: boolean;
  headerActions?: ReactNode;
}

export function DayGroupingView({
  groupedDays,
  availableActivities = [],
  initialUnscheduledActivityIds = [],
  userPreferences = [],
  debugMode = false,
  destination = null,
  tripInfo,
  onMoveActivity,
  onConfirm,
  onDayChange,
  onOverallDebugCostChange,
  activityCostDebugById = {},
  isLoading = false,
  headerActions = null,
}: DayGroupingViewProps) {
  const ACTIVITY_DRAG_TYPE = "application/x-travel-planner-activity";
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [movingActivity, setMovingActivity] = useState<{
    id: string;
    fromDay: number;
  } | null>(null);
  const [collapsedActivityCards, setCollapsedActivityCards] = useState<Record<string, boolean>>({});
  const [activeDayNumber, setActiveDayNumber] = useState<DayTabKey | null>(groupedDays[0]?.dayNumber ?? null);
  const [commuteByLeg, setCommuteByLeg] = useState<Record<string, { minutes: number; mode: CommuteMode }>>({});
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [draggedActivity, setDraggedActivity] = useState<{ id: string; dayNumber: number; index: number } | null>(null);
  const [dragInsertion, setDragInsertion] = useState<{ dayNumber: number; index: number } | null>(null);
  const draggedActivityRef = useRef<{ id: string; dayNumber: number; index: number } | null>(null);

  const buildLegId = (dayNumber: number, fromId: string, toId: string) =>
    `${dayNumber}:${fromId}->${toId}`;
  const buildStayStartLegId = (dayNumber: number, toId: string) => `${dayNumber}:stay-start->${toId}`;
  const buildStayEndLegId = (dayNumber: number, fromId: string) => `${dayNumber}:${fromId}->stay-end`;

  const getStartStayCoordinates = useCallback((days: GroupedDay[], day: GroupedDay, dayIndex: number): { lat: number; lng: number } | null => {
    if (dayIndex > 0) {
      return days[dayIndex - 1]?.nightStay?.coordinates ?? null;
    }

    // Day 1 fallback: use the selected night-stay location so the initial commute
    // is visible instead of being omitted entirely.
    return day.nightStay?.coordinates ?? null;
  }, []);



  const normalizeDateKey = useCallback((value?: string | null): string | null => {
    if (!value) return null;
    const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }, []);

  const tripEndDateKey = useMemo(() => normalizeDateKey(tripInfo?.endDate), [normalizeDateKey, tripInfo?.endDate]);

  const isDepartureDay = useCallback((day: GroupedDay, dayIndex: number): boolean => {
    if (tripEndDateKey) {
      const dayDateKey = normalizeDateKey(day.date);
      if (dayDateKey) return dayDateKey === tripEndDateKey;
    }
    return dayIndex === groupedDays.length - 1;
  }, [groupedDays.length, normalizeDateKey, tripEndDateKey]);

  const sunsetMinutes = useMemo(() => {
    // TODO: drive this from destination/date-aware sunset data when available.
    return DEFAULT_SUNSET_MINUTES;
  }, []);





  const sourceDayByActivityId = useMemo(() => {
    const sourceDayById: Record<string, number> = {};
    groupedDays.forEach((day) => {
      day.activities.forEach((activity) => {
        sourceDayById[activity.id] = day.dayNumber;
      });
    });
    return sourceDayById;
  }, [groupedDays]);

  const getDayStartContext = useCallback(
    (dayIndex: number, fallbackStayLabel?: string | null) => {
      if (dayIndex !== 0) {
        return {
          isArrivalDay: false,
          startTitle: "Start from stay",
          startLabel: fallbackStayLabel || null,
          dayStartMinutes: 9 * 60 + 30,
          availableVisitHours: 8,
          arrivalAirport: null as string | null,
          arrivalTiming: null as string | null,
        };
      }

      const arrivalTiming = tripInfo?.arrivalTimePreference || "12:00 PM";
      const arrivalAirport = tripInfo?.arrivalAirport || "arrival airport";
      const arrivalMinutes = parseFixedStartTimeMinutes(arrivalTiming) ?? 12 * 60;
      const isMorningArrival = arrivalMinutes < 12 * 60;
      const startAfterArrival = Math.max(8 * 60 + 30, Math.min(19 * 60, arrivalMinutes + 120));
      const availableVisitHours = Math.max(2.5, Math.min(8, (20 * 60 - startAfterArrival) / 60));

      return {
        isArrivalDay: true,
        startTitle: `Arrive at airport (${arrivalTiming})`,
        startLabel: `${arrivalAirport} · assumed arrival ${arrivalTiming}`,
        dayStartMinutes: Math.max(9 * 60, startAfterArrival),
        availableVisitHours: isMorningArrival ? Math.max(4, availableVisitHours) : availableVisitHours,
        arrivalAirport,
        arrivalTiming,
      };
    },
    [tripInfo?.arrivalAirport, tripInfo?.arrivalTimePreference]
  );

  const dedupeActivitiesById = useCallback((activities: SuggestedActivity[]): SuggestedActivity[] => {
    const seen = new Set<string>();
    const deduped: SuggestedActivity[] = [];
    activities.forEach((activity) => {
      if (seen.has(activity.id)) return;
      seen.add(activity.id);
      deduped.push(activity);
    });
    return deduped;
  }, []);

  const regroupedActivitiesByDay = useMemo(() => {
    const map: Record<number, { scheduledActivities: SuggestedActivity[]; prunedActivities: SuggestedActivity[] }> = {};
    groupedDays.forEach((day) => {
      map[day.dayNumber] = {
        scheduledActivities: dedupeActivitiesById(day.activities),
        prunedActivities: [],
      };
    });
    return map;
  }, [groupedDays, dedupeActivitiesById]);

  const unscheduledActivities = useMemo(() => {
    const deduped = new Map<string, SuggestedActivity>();
    if (initialUnscheduledActivityIds.length > 0 && availableActivities.length > 0) {
      const availableById = new Map(availableActivities.map((activity) => [activity.id, activity]));
      const groupedById = new Map<string, SuggestedActivity>();
      groupedDays.forEach((day) => {
        day.activities.forEach((activity) => groupedById.set(activity.id, activity));
      });
      initialUnscheduledActivityIds.forEach((activityId) => {
        if (deduped.has(activityId)) return;
        const activity = availableById.get(activityId) ?? groupedById.get(activityId);
        if (activity) deduped.set(activity.id, activity);
      });
    }
    return [...deduped.values()];
  }, [
    initialUnscheduledActivityIds,
    availableActivities,
    groupedDays,
  ]);

  const unscheduledActivityIds = useMemo(() => new Set(unscheduledActivities.map((activity) => activity.id)), [unscheduledActivities]);

  const displayGroupedDays = useMemo(() => {
    const unassignedSet = new Set(initialUnscheduledActivityIds);
    return groupedDays.map((day) => ({
      ...day,
      activities: dedupeActivitiesById(day.activities).filter((activity) => !unassignedSet.has(activity.id)),
    }));
  }, [groupedDays, initialUnscheduledActivityIds, dedupeActivitiesById]);

  const rawDayByNumber = useMemo(
    () => new Map(groupedDays.map((day) => [day.dayNumber, day])),
    [groupedDays]
  );

  const overallDebugCost = useMemo(() => {
    const displayCost = displayGroupedDays.find((day) => typeof day.debugCost?.overallTripCost === "number")?.debugCost?.overallTripCost;
    if (displayCost != null) return displayCost;
    const groupedCost = groupedDays.find((day) => typeof day.debugCost?.overallTripCost === "number")?.debugCost?.overallTripCost;
    return groupedCost ?? null;
  }, [displayGroupedDays, groupedDays]);

  useEffect(() => {
    if (!onOverallDebugCostChange) return;
    onOverallDebugCostChange(overallDebugCost);
  }, [onOverallDebugCostChange, overallDebugCost]);

  const formatCostScore = useCallback((value: number): string => {
    return Number.isFinite(value) ? value.toFixed(2) : "N/A";
  }, []);


  const isRailFriendlyDestination = useMemo(() => {
    return checkRailFriendlyDestination(destination);
  }, [destination]);

  const commuteLegs = useMemo(() => {
    const legs: Array<{
      id: string;
      origin: { lat: number; lng: number };
      destination: { lat: number; lng: number };
      mode: CommuteMode;
      travelMode: "DRIVE" | "WALK" | "TRANSIT";
    }> = [];
    displayGroupedDays.forEach((day, dayIndex) => {
      const sorted = [...day.activities];
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const startStayCoordinates = getStartStayCoordinates(displayGroupedDays, day, dayIndex);
      const endStayCoordinates = day.nightStay?.coordinates;

      if (first && startStayCoordinates) {
        const firstPoint = getActivityStartPoint(first);
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
        const fromPoint = getActivityExitPointToward(activity, getActivityStartPoint(next));
        const toPoint = getActivityStartPoint(next);
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
        const lastPoint = getActivityExitPointToward(last, endStayCoordinates);
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
  }, [displayGroupedDays, isRailFriendlyDestination, getActivityStartPoint, getStartStayCoordinates]);



  const commuteLegsToFetch = useMemo(
    () => commuteLegs.filter((leg) => commuteByLeg[leg.id] == null),
    [commuteLegs, commuteByLeg]
  );

  useEffect(() => {
    if (commuteLegsToFetch.length === 0) return;
    setRoutingError(null);
    let isActive = true;
    computeRoutes(commuteLegsToFetch)
      .then((result) => {
        if (!isActive || !result?.legs) return;
        const routeFailures = result.legs.filter((leg) => typeof leg.error === "string" && leg.error.trim().length > 0);
        if (routeFailures.length > 0) {
          const sample = routeFailures[0];
          setRoutingError(
            `Mapping/routing error while computing commute legs (${routeFailures.length} failed). Example: ${sample.error}`
          );
          return;
        }
        const updates: Record<string, { minutes: number; mode: CommuteMode }> = {};
        result.legs.forEach((leg) => {
          const sourceLeg = commuteLegsToFetch.find((l) => l.id === leg.id);
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
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setRoutingError(`Mapping/routing error while computing commute legs: ${message}`);
      });

    return () => {
      isActive = false;
    };
  }, [commuteLegsToFetch]);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current && onDayChange) {
      const container = scrollContainerRef.current;
      const index = Math.round(container.scrollLeft / container.clientWidth);
      if (index === displayGroupedDays.length && unscheduledActivities.length > 0) {
        setActiveDayNumber("unscheduled");
        return;
      }
      const activeDay = displayGroupedDays[index]?.dayNumber;
      if (activeDay != null) {
        setActiveDayNumber(activeDay);
        onDayChange(activeDay);
      }
    }
  }, [displayGroupedDays, onDayChange, unscheduledActivities.length]);

  const handleDayPanelWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    // Keep vertical scrolling inside the day panel instead of bubbling to the
    // horizontal snap container.
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.stopPropagation();
    }
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  useEffect(() => {
    if (displayGroupedDays.length === 0) {
      setActiveDayNumber(unscheduledActivities.length > 0 ? "unscheduled" : null);
      return;
    }
    if (
      activeDayNumber == null ||
      (activeDayNumber !== "unscheduled" &&
        !displayGroupedDays.some((day) => day.dayNumber === activeDayNumber))
    ) {
      setActiveDayNumber(displayGroupedDays[0].dayNumber);
    }
  }, [displayGroupedDays, activeDayNumber, unscheduledActivities.length]);

  useEffect(() => {
    const nextCollapsed: Record<string, boolean> = {};
    for (const day of displayGroupedDays) {
      for (const activity of day.activities) {
        nextCollapsed[activity.id] = true;
      }
    }
    for (const activity of unscheduledActivities) {
      nextCollapsed[activity.id] = true;
    }
    setCollapsedActivityCards(nextCollapsed);
  }, [displayGroupedDays, unscheduledActivities]);

  const scrollToDay = (dayNumber: DayTabKey) => {
    if (scrollContainerRef.current) {
      const index =
        dayNumber === "unscheduled"
          ? displayGroupedDays.length
          : displayGroupedDays.findIndex((day) => day.dayNumber === dayNumber);
      if (index === -1) return;
      const scrollAmount = scrollContainerRef.current.clientWidth * index;
      scrollContainerRef.current.scrollTo({
        left: scrollAmount,
        behavior: "auto",
      });
      setActiveDayNumber(dayNumber);
      if (dayNumber !== "unscheduled") onDayChange?.(dayNumber);
    }
  };

  const handleMoveStart = (activityId: string, fromDay: number) => {
    setMovingActivity({ id: activityId, fromDay });
  };

  const handleMoveConfirm = (toDay: number | "unscheduled") => {
    if (movingActivity) {
      if (toDay === "unscheduled") {
        if (movingActivity.fromDay !== 0) {
          onMoveActivity(movingActivity.id, movingActivity.fromDay, 0);
        }
        setMovingActivity(null);
        return;
      }
      const isCurrentlyUnscheduled = unscheduledActivityIds.has(movingActivity.id);
      if (movingActivity.fromDay !== toDay || isCurrentlyUnscheduled) {
        onMoveActivity(movingActivity.id, movingActivity.fromDay, toDay);
      }
    }
    setMovingActivity(null);
  };

  const handleMoveCancel = () => {
    setMovingActivity(null);
  };

  const handleMoveWithinDay = (activityId: string, dayNumber: number, targetIndex: number) => {
    if (targetIndex < 0) return;
    onMoveActivity(activityId, dayNumber, dayNumber, targetIndex);
  };

  const handleActivityDragStart = (
    event: DragEvent<HTMLDivElement>,
    activityId: string,
    dayNumber: number,
    index: number
  ) => {
    event.dataTransfer.effectAllowed = "move";
    const nextDraggedActivity = { id: activityId, dayNumber, index };
    draggedActivityRef.current = nextDraggedActivity;
    setDraggedActivity(nextDraggedActivity);
    try {
      const payload = JSON.stringify(nextDraggedActivity);
      event.dataTransfer.setData(ACTIVITY_DRAG_TYPE, payload);
      event.dataTransfer.setData("text/plain", activityId);
    } catch {
      // Some browsers may restrict dataTransfer for custom types; in-memory fallback is enough.
    }
    setDragInsertion({ dayNumber, index });
  };

  const readDraggedActivityFromEvent = (event: DragEvent<HTMLDivElement>) => {
    if (draggedActivityRef.current) return draggedActivityRef.current;
    try {
      const payload = event.dataTransfer.getData(ACTIVITY_DRAG_TYPE);
      if (!payload) return null;
      const parsed = JSON.parse(payload) as { id: string; dayNumber: number; index: number };
      if (parsed && typeof parsed.id === "string" && typeof parsed.dayNumber === "number" && typeof parsed.index === "number") {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  };

  const handleActivityDragOver = (
    event: DragEvent<HTMLDivElement>,
    dayNumber: number,
    hoverIndex: number
  ) => {
    const activeDrag = readDraggedActivityFromEvent(event);
    if (!activeDrag || activeDrag.dayNumber !== dayNumber) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    setDragInsertion({ dayNumber, index: insertAfter ? hoverIndex + 1 : hoverIndex });
  };

  const handleDayDragOver = (
    event: DragEvent<HTMLDivElement>,
    dayNumber: number,
    activitiesLength: number
  ) => {
    const activeDrag = readDraggedActivityFromEvent(event);
    if (!activeDrag || activeDrag.dayNumber !== dayNumber) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragInsertion({ dayNumber, index: activitiesLength });
  };

  const handleActivityDrop = (
    event: DragEvent<HTMLDivElement>,
    dayNumber: number,
    fallbackIndex: number
  ) => {
    const activeDrag = readDraggedActivityFromEvent(event);
    if (!activeDrag || activeDrag.dayNumber !== dayNumber) return;
    event.preventDefault();
    const targetIndexRaw = dragInsertion?.dayNumber === dayNumber ? dragInsertion.index : fallbackIndex;
    const targetIndex = activeDrag.index < targetIndexRaw ? targetIndexRaw - 1 : targetIndexRaw;
    if (targetIndex !== activeDrag.index) {
      onMoveActivity(activeDrag.id, dayNumber, dayNumber, targetIndex);
    }
    draggedActivityRef.current = null;
    setDraggedActivity(null);
    setDragInsertion(null);
  };

  const handleActivityDragEnd = () => {
    draggedActivityRef.current = null;
    setDraggedActivity(null);
    setDragInsertion(null);
  };

  const toggleActivityCollapse = (activityId: string) => {
    setCollapsedActivityCards((prev) => ({
      ...prev,
      [activityId]: !prev[activityId],
    }));
  };

  // ---------------------------------------------------------------------------
  // Scheduling / timeline helpers (pure utilities imported from timeline-utils)
  // ---------------------------------------------------------------------------



  return (
    <div className="space-y-6 h-full min-h-0 flex flex-col">
      {routingError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold">Routing API warning</p>
              <p>{routingError}</p>
            </div>
          </div>
        </div>
      ) : null}
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

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Day tabs */}
        <div className="flex items-center justify-between mb-4 shrink-0 px-2">
          <div className="flex items-baseline gap-2 px-1">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Planned Highlights</h3>
            <span className="text-[10px] text-gray-400">Timeline is approximate. Daily budget: 8 hrs</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            {displayGroupedDays.map((day) => {
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
            {unscheduledActivities.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => scrollToDay("unscheduled")}
                className="h-8 px-3 whitespace-nowrap border font-semibold transition-colors"
                style={{
                  backgroundColor: activeDayNumber === "unscheduled" ? "#334155" : "#f1f5f9",
                  borderColor: activeDayNumber === "unscheduled" ? "#334155" : "#cbd5e1",
                  color: activeDayNumber === "unscheduled" ? "#FFFFFF" : "#334155",
                  boxShadow: activeDayNumber === "unscheduled" ? "0 0 0 2px #33415533" : "none",
                }}
              >
                Unscheduled ({unscheduledActivities.length})
              </Button>
            ) : null}
          </div>
        </div>
        {debugMode && overallDebugCost != null ? (
          <div className="mb-4 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <p className="font-semibold uppercase tracking-wide text-slate-800">Trip Cost Function</p>
            <p>Total score: {formatCostScore(overallDebugCost)}</p>
          </div>
        ) : null}

        {/* Day-based horizontal carousel */}
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-none"
        >
          {displayGroupedDays.map((day, index) => {
            const isFinalDepartureDay = isDepartureDay(day, index);
            return (
              <div key={day.dayNumber} className="w-full flex-shrink-0 snap-center px-2">
                <Card className="h-full border-t-4 flex flex-col" style={{ borderTopColor: getDayColor(day.dayNumber) }}>
                  <CardHeader className="pb-3 shrink-0">
                    <div className="flex items-start justify-between gap-3">
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
                        {day.nightStay?.label && !isFinalDepartureDay && (
                          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            <Home className="h-3.5 w-3.5" />
                            Night stay: {day.nightStay.label}
                          </div>
                        )}
                        {day.nightStay?.candidates && day.nightStay.candidates.length > 0 && !isFinalDepartureDay && (
                          <div className="mt-2 space-y-1 text-xs text-slate-600">
                            {day.nightStay.candidates.slice(0, 3).map((candidate, candidateIndex) => (
                              <div key={`${candidate.label}-${candidateIndex}`}>
                                Alt: {candidate.label}
                                {candidate.driveScoreKm != null ? ` · ~${candidate.driveScoreKm} km drive` : ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {(() => {
                        const dayDebugCost = day.debugCost;
                        if (!debugMode || !dayDebugCost) return null;
                        return (
                        <div className="shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-700">
                          <p className="font-semibold uppercase tracking-wide text-slate-800">Day Cost</p>
                          <p>Total {formatCostScore(dayDebugCost.dayCost)}</p>
                          <p>S {formatCostScore(dayDebugCost.structuralCost)} · B {formatCostScore(dayDebugCost.balancePenalty)}</p>
                          <p>C {formatCostScore(dayDebugCost.commuteProxy)} · H {formatCostScore(dayDebugCost.totalHours)}</p>
                        </div>
                        );
                      })()}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-0">
                    <div
                      className="h-full overflow-auto px-4 pb-6"
                      onWheelCapture={handleDayPanelWheel}
                    >
                      <div className="space-y-3">
                        <DayTimelineRows
                          day={day}
                          rawDay={rawDayByNumber.get(day.dayNumber)}
                          dayIndex={index}
                          startStayLabel={index > 0 ? displayGroupedDays[index - 1]?.nightStay?.label : null}
                          endStayLabel={day.nightStay?.label}
                          startStayCoordinates={getStartStayCoordinates(displayGroupedDays, day, index)}
                          endStayCoordinates={day.nightStay?.coordinates}
                          regroupedActivities={regroupedActivitiesByDay[day.dayNumber]}
                          forceScheduleDay={true}
                          startContext={getDayStartContext(index, index > 0 ? displayGroupedDays[index - 1]?.nightStay?.label : null)}
                          isFinalDepartureDay={isDepartureDay(day, index)}
                          commuteByLeg={commuteByLeg}
                          isRailFriendlyDestination={isRailFriendlyDestination}
                          sunsetMinutes={DEFAULT_SUNSET_MINUTES}
                          tripInfo={tripInfo}
                          debugMode={debugMode}
                          userPreferences={userPreferences}
                          activityCostDebugById={activityCostDebugById}
                          displayGroupedDays={displayGroupedDays}
                          collapsedActivityCards={collapsedActivityCards}
                          movingActivity={movingActivity}
                          dragInsertion={dragInsertion}
                          draggedActivity={draggedActivity}
                          sourceDayByActivityId={sourceDayByActivityId}
                          onDayDragOver={handleDayDragOver}
                          onActivityDrop={handleActivityDrop}
                          onActivityDragStart={handleActivityDragStart}
                          onActivityDragOver={handleActivityDragOver}
                          onActivityDragEnd={handleActivityDragEnd}
                          onToggleCollapse={toggleActivityCollapse}
                          onMoveStart={handleMoveStart}
                          onMoveConfirm={handleMoveConfirm}
                          onMoveCancel={handleMoveCancel}
                          onMoveWithinDay={handleMoveWithinDay}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
          {unscheduledActivities.length > 0 ? (
            <div className="w-full flex-shrink-0 snap-center px-2">
              <Card className="h-full border-t-4 border-slate-500 flex flex-col">
                <CardHeader className="pb-3 shrink-0">
                  <div className="space-y-1">
                    <Badge className="h-6 px-2 bg-slate-100 text-slate-700 border border-slate-200">
                      Unscheduled Activities
                    </Badge>
                    <CardTitle className="text-xl">Needs Manual Placement</CardTitle>
                    <p className="text-xs text-gray-500">
                      These could not be auto-fit within day/time constraints. Move them into a day.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <div className="h-full overflow-auto px-4 pb-6">
                    <div className="space-y-3">
                      {unscheduledActivities.map((activity, index) => (
                        <DayActivityItem
                          key={`unscheduled-${activity.id}-${index}`}
                          activity={activity}
                          dayNumber={sourceDayByActivityId[activity.id] ?? 0}
                          sourceDayNumber={sourceDayByActivityId[activity.id]}
                          index={index}
                          affordLabel="Auto-placement could not fit this activity."
                          groupingCostDebug={activityCostDebugById[activity.id] ?? null}
                          isMoving={movingActivity?.id === activity.id}
                          isCollapsed={collapsedActivityCards[activity.id] ?? true}
                          debugMode={debugMode}
                          userPreferences={userPreferences}
                          displayGroupedDays={displayGroupedDays}
                          onToggleCollapse={toggleActivityCollapse}
                          onMoveStart={handleMoveStart}
                          onMoveConfirm={handleMoveConfirm}
                          onMoveCancel={handleMoveCancel}
                          allowUnscheduledTarget={true}
                        />
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
          {displayGroupedDays.length === 0 && unscheduledActivities.length === 0 && (
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
