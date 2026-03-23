"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type DragEvent, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, ListChecks, Home, AlertTriangle, Utensils } from "lucide-react";
import { computeRoutes } from "@/lib/api-client";
import type { GroupedDay, SuggestedActivity, TripInfo } from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";
import { DayActivityItem } from "@/components/DayActivityItem";
import { DayTimelineRows } from "@/components/DayTimelineRows";
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
  recommendedWindowMidpointMinutes,
  activityLoadFactor,
  formatRecommendedStartWindowLabel,
  checkRailFriendlyDestination,
  getActivityStartPoint,
  getActivityEndPoint,
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
  userPreferences?: string[];
  debugMode?: boolean;
  destination?: string | null;
  tripInfo?: Pick<
    TripInfo,
    "arrivalAirport" | "departureAirport" | "arrivalTimePreference" | "departureTimePreference" | "transportMode" | "endDate"
  >;
  onMoveActivity: (activityId: string, fromDay: number, toDay: number, targetIndex?: number) => void;
  onConfirm: () => void;
  onDayChange?: (dayNumber: number) => void;
  onSchedulingPlanChange?: (plan: { scheduledActivityIds: string[]; unscheduledActivityIds: string[] }) => void;
  isLoading?: boolean;
  headerActions?: ReactNode;
}

export function DayGroupingView({
  groupedDays,
  userPreferences = [],
  debugMode = false,
  destination = null,
  tripInfo,
  onMoveActivity,
  onConfirm,
  onDayChange,
  onSchedulingPlanChange,
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

  const regroupSchedulableActivitiesForDay = useCallback(
    ({
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
    }): { scheduledActivities: SuggestedActivity[]; prunedActivities: SuggestedActivity[] } => {
      const DEPARTURE_TRANSFER_MINUTES_ESTIMATE = DEPARTURE_TRANSFER_MINUTES;
      const startContext = getDayStartContext(dayIndex, startStayLabel);
      const availableVisitHours = startContext.availableVisitHours;
      const isFinalDepartureDay = isDepartureDay(day, dayIndex);
      const lunchHours = 1;
      const lunchMinStart = LUNCH_MIN_START_MINUTES;
      const lunchTargetStart = LUNCH_TARGET_START_MINUTES;
      const commuteTransitionBufferMinutes = COMMUTE_TRANSITION_BUFFER_MINUTES;
      const airportArrivalLeadMinutes = AIRPORT_ARRIVAL_LEAD_MINUTES;
      const departureClock = tripInfo?.departureTimePreference || "6:00 PM";
      const departureMinutes = parseFixedStartTimeMinutes(departureClock) ?? DEFAULT_SUNSET_MINUTES;
      const airportArrivalDeadlineMinutes = Math.max(10 * 60, departureMinutes - airportArrivalLeadMinutes);
      const preDayBufferMinutes = PRE_DAY_BUFFER_MINUTES;
      const initialSortedActivities = [...day.activities];
      let currentActivities = [...initialSortedActivities];
      const prunedById = new Map<string, SuggestedActivity>();

      for (let attempt = 0; attempt < initialSortedActivities.length; attempt += 1) {
        if (currentActivities.length === 0) break;

        const firstActivity = currentActivities[0];
        const lastActivity = currentActivities[currentActivities.length - 1];
        const stayStartCommuteMinutes =
          startContext.startLabel && firstActivity && startStayCoordinates
            ? (commuteByLeg[buildStayStartLegId(day.dayNumber, firstActivity.id)]?.minutes ??
              estimateCommuteMinutes(startStayCoordinates, getActivityStartPoint(firstActivity)))
            : 0;
        const endOfDayCommuteMinutes =
          isFinalDepartureDay
            ? DEPARTURE_TRANSFER_MINUTES_ESTIMATE
            : endStayLabel && lastActivity && endStayCoordinates
              ? (commuteByLeg[buildStayEndLegId(day.dayNumber, lastActivity.id)]?.minutes ??
                estimateCommuteMinutes(getActivityEndPoint(lastActivity), endStayCoordinates))
              : 0;
        const bufferedEndOfDayCommuteMinutes =
          endOfDayCommuteMinutes > 0 ? roundToQuarter(endOfDayCommuteMinutes + commuteTransitionBufferMinutes) : 0;
        const eveningCutoffMinutes = isFinalDepartureDay
          ? Math.max(10 * 60, airportArrivalDeadlineMinutes - bufferedEndOfDayCommuteMinutes)
          : 18 * 60;

        const interActivityCommuteMinutesEstimate = currentActivities.reduce((sum, activity, index) => {
          const next = currentActivities[index + 1];
          if (!next) return sum;
          const legId = buildLegId(day.dayNumber, activity.id, next.id);
          const fallbackMinutes = estimateCommuteMinutes(getActivityEndPoint(activity), getActivityStartPoint(next));
          const commuteMinutes = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
          return sum + commuteMinutes;
        }, 0);
        const totalCommuteHoursEstimate =
          (interActivityCommuteMinutesEstimate + stayStartCommuteMinutes + endOfDayCommuteMinutes) / 60;
        const remainingForActivities = Math.max(availableVisitHours - lunchHours - totalCommuteHoursEstimate, 0);
        const totalRequestedHours = currentActivities.reduce((sum, activity) => {
          const estimatedHours = parseEstimatedHours(activity.estimatedDuration);
          const routeFloorHours = (estimateRouteIntrinsicMinutes(activity) ?? 0) / 60;
          return sum + Math.max(estimatedHours, routeFloorHours) * activityLoadFactor(activity);
        }, 0);
        const scaleFactor =
          totalRequestedHours > 0 && totalRequestedHours > remainingForActivities && remainingForActivities > 0
            ? remainingForActivities / totalRequestedHours
            : 1;

        const earliestFixedStartMinutes = currentActivities
          .filter((activity) => activity.isFixedStartTime)
          .map((activity) => parseFixedStartTimeMinutes(activity.fixedStartTime))
          .filter((minutes): minutes is number => minutes != null)
          .sort((a, b) => a - b)[0];
        const earliestRecommendedMidpointMinutes = currentActivities
          .map((activity) => recommendedWindowMidpointMinutes(activity))
          .filter((minutes): minutes is number => minutes != null)
          .sort((a, b) => a - b)[0];
        const bufferedStayStartCommuteMinutes =
          stayStartCommuteMinutes > 0 ? roundToQuarter(stayStartCommuteMinutes + preDayBufferMinutes) : 0;
        const recommendedEarlyStartMinutes =
          dayIndex !== 0 && earliestRecommendedMidpointMinutes != null
            ? Math.max(0, roundToQuarter(earliestRecommendedMidpointMinutes - bufferedStayStartCommuteMinutes - preDayBufferMinutes))
            : null;
        const defaultDayStartMinutes =
          recommendedEarlyStartMinutes != null
            ? Math.min(startContext.dayStartMinutes, recommendedEarlyStartMinutes)
            : startContext.dayStartMinutes;

        let cursorMinutes = defaultDayStartMinutes;
        if (dayIndex !== 0 && earliestFixedStartMinutes != null) {
          cursorMinutes = Math.max(
            0,
            roundToQuarter(earliestFixedStartMinutes - bufferedStayStartCommuteMinutes - preDayBufferMinutes)
          );
        }
        let lunchInserted = false;
        if (startContext.startLabel) {
          if (dayIndex === 0) {
            cursorMinutes += roundToQuarter(Math.max(20, Math.min(90, roundToQuarter((stayStartCommuteMinutes > 0 ? stayStartCommuteMinutes : 15) + 30))) + commuteTransitionBufferMinutes);
          }
          if (stayStartCommuteMinutes > 0) {
            if (cursorMinutes >= lunchMinStart) {
              const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
              const lunchEnd = lunchStart + LUNCH_BLOCK_MINUTES;
              cursorMinutes = lunchEnd;
              lunchInserted = true;
            }
            cursorMinutes += roundToQuarter(stayStartCommuteMinutes + commuteTransitionBufferMinutes);
          }
        }

        const droppedThisAttempt = new Set<string>();
        let hasScheduledPrimaryActivity = false;
        let departureCutoffReached = false;

        currentActivities.forEach((activity, index) => {
          if (departureCutoffReached) {
            droppedThisAttempt.add(activity.id);
            return;
          }

          const estimatedHours = parseEstimatedHours(activity.estimatedDuration);
          const routeFloorHours = (estimateRouteIntrinsicMinutes(activity) ?? 0) / 60;
          const recommendedHours = Math.max(estimatedHours, routeFloorHours);
          const requestedHours = recommendedHours * activityLoadFactor(activity);
          const durationIsFlexible = activity.isDurationFlexible !== false;
          const minimumScheduledHours = durationIsFlexible ? Math.max(0.75, recommendedHours * 0.5) : requestedHours;
          const allocatedHours = durationIsFlexible
            ? Math.max(minimumScheduledHours, requestedHours * scaleFactor)
            : requestedHours;
          const timingPolicy = getActivityTimingPolicy(activity);
          const activityMinutes = durationIsFlexible
            ? roundToQuarter(allocatedHours * 60 + timingPolicy.settleBufferMinutes)
            : roundToQuarter(allocatedHours * 60);
          const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime);
          const fixedAlignedStartMinutes =
            activity.isFixedStartTime && fixedStartMinutes != null ? roundToQuarter(fixedStartMinutes) : null;
          const nightStartFloorMinutes = nightOnlyStartFloorMinutes(activity, sunsetMinutes);
          const roundedCursorMinutes = roundToQuarter(cursorMinutes);
          if (fixedAlignedStartMinutes != null && roundedCursorMinutes > fixedAlignedStartMinutes) {
            droppedThisAttempt.add(activity.id);
            return;
          }
          const activityStart = fixedAlignedStartMinutes != null
            ? Math.max(fixedAlignedStartMinutes, nightStartFloorMinutes ?? 0)
            : Math.max(roundedCursorMinutes, nightStartFloorMinutes ?? 0);
          if (isFinalDepartureDay && activityStart >= eveningCutoffMinutes) {
            droppedThisAttempt.add(activity.id);
            departureCutoffReached = true;
            return;
          }

          const uncappedActivityEnd = activityStart + activityMinutes;
          const daylightCapMinutes = daylightEndCapMinutes(activity, eveningCutoffMinutes, sunsetMinutes);
          const departureHardCapMinutes = isFinalDepartureDay ? eveningCutoffMinutes : null;
          const effectiveCapMinutes =
            departureHardCapMinutes != null && daylightCapMinutes != null
              ? Math.min(departureHardCapMinutes, daylightCapMinutes)
              : (departureHardCapMinutes ?? daylightCapMinutes);
          const activityEnd =
            effectiveCapMinutes != null ? Math.min(uncappedActivityEnd, effectiveCapMinutes) : uncappedActivityEnd;
          if (activityEnd <= activityStart) {
            droppedThisAttempt.add(activity.id);
            return;
          }

          const crossesLunchWindow = !lunchInserted && activityStart < lunchTargetStart && activityEnd > lunchTargetStart;
          if (crossesLunchWindow) {
            const lunchStart = roundToQuarter(Math.max(lunchTargetStart, lunchMinStart));
            const lunchMinutes = LUNCH_BLOCK_MINUTES;
            const lunchEnd = lunchStart + lunchMinutes;
            const beforeLunchEnd = Math.max(activityStart + 30, lunchStart);
            const afterLunchStart = lunchEnd;
            const afterLunchEnd = afterLunchStart + Math.max(30, activityEnd - beforeLunchEnd);
            cursorMinutes = afterLunchEnd;
            lunchInserted = true;
          } else {
            const lunchMinutes = LUNCH_BLOCK_MINUTES;
            const preLunchGapMinutes = Math.max(0, activityStart - roundToQuarter(cursorMinutes));
            const canInsertLunchBeforeFirstActivity = !hasScheduledPrimaryActivity && preLunchGapMinutes >= lunchMinutes;
            if (!lunchInserted && activityStart >= lunchMinStart && (hasScheduledPrimaryActivity || canInsertLunchBeforeFirstActivity)) {
              const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
              const lunchEnd = lunchStart + lunchMinutes;
              cursorMinutes = lunchEnd;
              lunchInserted = true;
            }
            const nextActivityStart =
              fixedAlignedStartMinutes != null
                ? Math.max(roundToQuarter(cursorMinutes), fixedAlignedStartMinutes, nightStartFloorMinutes ?? 0)
                : Math.max(roundToQuarter(cursorMinutes), nightStartFloorMinutes ?? 0);
            const nextActivityEnd = effectiveCapMinutes != null
              ? Math.min(nextActivityStart + activityMinutes, effectiveCapMinutes)
              : nextActivityStart + activityMinutes;
            if (nextActivityEnd <= nextActivityStart) {
              droppedThisAttempt.add(activity.id);
              return;
            }
            cursorMinutes = nextActivityEnd;
          }

          hasScheduledPrimaryActivity = true;
          const next = currentActivities[index + 1];
          if (next) {
            const legId = buildLegId(day.dayNumber, activity.id, next.id);
            const fallbackMinutes = estimateCommuteMinutes(getActivityEndPoint(activity), getActivityStartPoint(next));
            const commuteMinutes = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
            const bufferedCommuteMinutes = roundToQuarter(commuteMinutes + commuteTransitionBufferMinutes);
            cursorMinutes = roundToQuarter(cursorMinutes) + bufferedCommuteMinutes;
          }
        });

        if (droppedThisAttempt.size === 0) {
          return {
            scheduledActivities: currentActivities,
            prunedActivities: [...prunedById.values()],
          };
        }

        currentActivities = currentActivities.filter((activity) => {
          if (!droppedThisAttempt.has(activity.id)) return true;
          prunedById.set(activity.id, activity);
          return false;
        });
      }

      return {
        scheduledActivities: currentActivities,
        prunedActivities: [...prunedById.values()],
      };
    },
    [
      getDayStartContext,
      isDepartureDay,
      tripInfo?.departureTimePreference,
      commuteByLeg,
      getActivityStartPoint,
      getActivityEndPoint,
      getActivityTimingPolicy,
      nightOnlyStartFloorMinutes,
      daylightEndCapMinutes,
    ]
  );

  const regroupedActivitiesByDay = useMemo(() => {
    const map: Record<number, ReturnType<typeof regroupSchedulableActivitiesForDay>> = {};
    groupedDays.forEach((day, index) => {
      const startStayLabel = index > 0 ? groupedDays[index - 1]?.nightStay?.label : null;
      const endStayLabel = day.nightStay?.label;
      const startStayCoordinates = getStartStayCoordinates(groupedDays, day, index);
      const endStayCoordinates = day.nightStay?.coordinates;
      map[day.dayNumber] = regroupSchedulableActivitiesForDay({
        day,
        dayIndex: index,
        startStayLabel,
        endStayLabel,
        startStayCoordinates,
        endStayCoordinates,
      });
    });
    return map;
  }, [groupedDays, regroupSchedulableActivitiesForDay, getStartStayCoordinates]);

  const unscheduledActivities = useMemo(() => {
    const deduped = new Map<string, SuggestedActivity>();
    Object.values(regroupedActivitiesByDay).forEach((regrouped) => {
      regrouped.prunedActivities.forEach((activity) => {
        if (!deduped.has(activity.id)) {
          deduped.set(activity.id, activity);
        }
      });
    });
    return [...deduped.values()];
  }, [regroupedActivitiesByDay]);

  const unscheduledActivityIds = useMemo(() => new Set(unscheduledActivities.map((activity) => activity.id)), [unscheduledActivities]);

  const displayGroupedDays = useMemo(() => {
    return groupedDays.map((day) => ({
      ...day,
      activities: day.activities.filter((activity) => !unscheduledActivityIds.has(activity.id)),
    }));
  }, [groupedDays, unscheduledActivityIds]);
  const rawDayByNumber = useMemo(
    () => new Map(groupedDays.map((day) => [day.dayNumber, day])),
    [groupedDays]
  );

  useEffect(() => {
    if (!onSchedulingPlanChange) return;
    const scheduledActivityIds = displayGroupedDays.flatMap((day) => day.activities.map((activity) => activity.id));
    onSchedulingPlanChange({
      scheduledActivityIds,
      unscheduledActivityIds: unscheduledActivities.map((activity) => activity.id),
    });
  }, [displayGroupedDays, onSchedulingPlanChange, unscheduledActivities]);

  const overallDebugCost = displayGroupedDays[0]?.debugCost?.overallTripCost ?? null;

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
        const fromPoint = getActivityEndPoint(activity);
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
        const lastPoint = getActivityEndPoint(last);
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
  }, [displayGroupedDays, isRailFriendlyDestination, getActivityEndPoint, getActivityStartPoint, getStartStayCoordinates]);



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

  const handleMoveConfirm = (toDay: number) => {
    if (movingActivity && movingActivity.fromDay !== toDay) {
      onMoveActivity(movingActivity.id, movingActivity.fromDay, toDay);
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
                      {debugMode && day.debugCost ? (
                        <div className="shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-700">
                          <p className="font-semibold uppercase tracking-wide text-slate-800">Day Cost</p>
                          <p>Total {formatCostScore(day.debugCost.dayCost)}</p>
                          <p>S {formatCostScore(day.debugCost.structuralCost)} · B {formatCostScore(day.debugCost.balancePenalty)}</p>
                          <p>C {formatCostScore(day.debugCost.commuteProxy)} · H {formatCostScore(day.debugCost.totalHours)}</p>
                        </div>
                      ) : null}
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
                          startContext={getDayStartContext(index, index > 0 ? displayGroupedDays[index - 1]?.nightStay?.label : null)}
                          isFinalDepartureDay={isDepartureDay(day, index)}
                          commuteByLeg={commuteByLeg}
                          isRailFriendlyDestination={isRailFriendlyDestination}
                          sunsetMinutes={DEFAULT_SUNSET_MINUTES}
                          tripInfo={tripInfo}
                          debugMode={debugMode}
                          userPreferences={userPreferences}
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
                          dayNumber={sourceDayByActivityId[activity.id] ?? 1}
                          sourceDayNumber={sourceDayByActivityId[activity.id]}
                          index={index}
                          affordLabel="Auto-placement could not fit this activity."
                          isMoving={movingActivity?.id === activity.id}
                          isCollapsed={collapsedActivityCards[activity.id] ?? true}
                          debugMode={debugMode}
                          userPreferences={userPreferences}
                          displayGroupedDays={displayGroupedDays}
                          onToggleCollapse={toggleActivityCollapse}
                          onMoveStart={handleMoveStart}
                          onMoveConfirm={handleMoveConfirm}
                          onMoveCancel={handleMoveCancel}
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
