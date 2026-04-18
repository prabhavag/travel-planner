"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type DragEvent, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, ListChecks, Home, AlertTriangle, Utensils } from "lucide-react";
import { computeRoutes } from "@/lib/api-client";
import type { DayCostDebug, DayGroup, GroupedDay, SuggestedActivity, TripInfo } from "@/lib/api-client";
import { annotateDayGroupsWithCostDebug } from "@/lib/services/day-grouping";
import { buildOptimalDayRoute, computeTotalCostBreakdown } from "@/lib/services/day-grouping/scoring";
import {
  activityPairKey,
  buildDayCapacityProfiles,
  getLoadDurationHours,
  isFullDayDuration,
  recommendedWindowLatestStartMinutes as scoringRecommendedWindowLatestStartMinutes,
  slotDistance as scoringSlotDistance,
  slotForHour as scoringSlotForHour,
  parseDurationHours,
} from "@/lib/services/day-grouping/utils";
import {
  AFTER_HOURS_DRIVE_MULTIPLIER,
  COST_WEIGHTS,
  DEFAULT_DAYLIGHT_END_MINUTES,
  EARLY_MORNING_AFTER_HOURS_END_MINUTES,
  NEARBY_CLUSTER_MAX_COMMUTE_MINUTES,
  NEARBY_CLUSTER_SQUEEZE_HOURS,
  SOFT_DAY_START_MINUTES,
  NIGHT_AFTER_HOURS_START_MINUTES,
} from "@/lib/services/day-grouping/types";
import { activityCommuteMinutes, activityDistanceProxy } from "@/lib/services/day-grouping/routing";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";
import { DayActivityItem, type ActivityGroupingCostBreakdown } from "@/components/DayActivityItem";
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
  MIN_SCHEDULED_DURATION_RATIO,
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
  const [forcedScheduledDayMap, setForcedScheduledDayMap] = useState<Record<number, true>>({});
  const [manuallyUnscheduledActivityIdMap, setManuallyUnscheduledActivityIdMap] = useState<Record<string, true>>({});
  const [allocatedHoursByDay, setAllocatedHoursByDay] = useState<Record<number, Record<string, number>>>({});
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

  useEffect(() => {
    const validActivityIds = new Set(groupedDays.flatMap((day) => day.activities.map((activity) => activity.id)));
    setManuallyUnscheduledActivityIdMap((prev) => {
      const next = Object.fromEntries(
        Object.keys(prev)
          .filter((id) => validActivityIds.has(id))
          .map((id) => [id, true] as const)
      );
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every((id) => next[id])) {
        return prev;
      }
      return next;
    });
  }, [groupedDays]);

  const handleAllocatedHoursChange = useCallback((dayNumber: number, allocatedHoursByActivityId: Record<string, number>) => {
    setAllocatedHoursByDay((prev) => {
      const current = prev[dayNumber];
      const currentSerialized = JSON.stringify(current ?? {});
      const nextSerialized = JSON.stringify(allocatedHoursByActivityId);
      if (currentSerialized === nextSerialized) return prev;
      return {
        ...prev,
        [dayNumber]: allocatedHoursByActivityId,
      };
    });
  }, []);

  const allocatedHoursByActivityId = useMemo(() => {
    const merged: Record<string, number> = {};
    Object.values(allocatedHoursByDay).forEach((perDay) => {
      Object.entries(perDay).forEach(([activityId, hours]) => {
        merged[activityId] = Math.max(0, hours);
      });
    });
    return merged;
  }, [allocatedHoursByDay]);

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
      if (forcedScheduledDayMap[day.dayNumber]) {
        return {
          scheduledActivities: dedupeActivitiesById(day.activities),
          prunedActivities: [],
        };
      }
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
      const initialSortedActivities = dedupeActivitiesById(day.activities);
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
                estimateCommuteMinutes(getActivityExitPointToward(lastActivity, endStayCoordinates), endStayCoordinates))
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
          const fallbackMinutes = estimateCommuteMinutes(
            getActivityExitPointToward(activity, getActivityStartPoint(next)),
            getActivityStartPoint(next)
          );
          const commuteMinutes = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
          return sum + commuteMinutes;
        }, 0);
        const totalCommuteHoursEstimate =
          (interActivityCommuteMinutesEstimate + stayStartCommuteMinutes + endOfDayCommuteMinutes) / 60;
        const remainingForActivities = Math.max(availableVisitHours - lunchHours - totalCommuteHoursEstimate, 0);
        const totalRequestedHours = currentActivities.reduce((sum, activity) => {
          const estimatedHours = parseEstimatedHours(activity.estimatedDuration);
          const routeFloorHours = (estimateRouteIntrinsicMinutes(activity) ?? 0) / 60;
          return sum + Math.max(estimatedHours, routeFloorHours);
        }, 0);
        const scaleFactor =
          totalRequestedHours > 0 && totalRequestedHours > remainingForActivities && remainingForActivities > 0
            ? remainingForActivities / totalRequestedHours
            : 1;

        const earliestFixedStartMinutes = currentActivities
          .filter((activity) => hasHardFixedStart(activity))
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
          const requestedHours = recommendedHours;
          const durationIsFlexible = activity.isDurationFlexible !== false;
          const minimumScheduledHours = durationIsFlexible
            ? Math.max(0.75, recommendedHours * MIN_SCHEDULED_DURATION_RATIO)
            : requestedHours;
          const allocatedHours = durationIsFlexible
            ? Math.max(minimumScheduledHours, requestedHours * scaleFactor)
            : requestedHours;
          const timingPolicy = getActivityTimingPolicy(activity);
          const activityMinutes = durationIsFlexible
            ? roundToQuarter(allocatedHours * 60 + timingPolicy.settleBufferMinutes)
            : roundToQuarter(allocatedHours * 60);
          const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime);
          const fixedAlignedStartMinutes =
            hasHardFixedStart(activity) && fixedStartMinutes != null ? roundToQuarter(fixedStartMinutes) : null;
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
          const effectiveScheduledHours = Math.max(0, (activityEnd - activityStart) / 60);
          const minimumRequiredHours = recommendedHours * MIN_SCHEDULED_DURATION_RATIO;
          if (effectiveScheduledHours + 1e-6 < minimumRequiredHours) {
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
            const fallbackMinutes = estimateCommuteMinutes(
              getActivityExitPointToward(activity, getActivityStartPoint(next)),
              getActivityStartPoint(next)
            );
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
      getActivityExitPointToward,
      getActivityTimingPolicy,
      nightOnlyStartFloorMinutes,
      daylightEndCapMinutes,
      forcedScheduledDayMap,
      dedupeActivitiesById,
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
    groupedDays.forEach((day) => {
      day.activities.forEach((activity) => {
        if (manuallyUnscheduledActivityIdMap[activity.id]) {
          deduped.set(activity.id, activity);
        }
      });
    });
    Object.values(regroupedActivitiesByDay).forEach((regrouped) => {
      regrouped.prunedActivities.forEach((activity) => {
        if (!deduped.has(activity.id)) {
          deduped.set(activity.id, activity);
        }
      });
    });
    return [...deduped.values()];
  }, [groupedDays, regroupedActivitiesByDay, manuallyUnscheduledActivityIdMap]);

  const unscheduledActivityIds = useMemo(() => new Set(unscheduledActivities.map((activity) => activity.id)), [unscheduledActivities]);

  const displayGroupedDays = useMemo(() => {
    return groupedDays.map((day) => {
      const recomputed = regroupedActivitiesByDay[day.dayNumber];
      const scheduledActivities = recomputed?.scheduledActivities ?? day.activities;
      const dedupedScheduledActivities = dedupeActivitiesById(scheduledActivities);
      return {
        ...day,
        activities: dedupedScheduledActivities.filter((activity) => !manuallyUnscheduledActivityIdMap[activity.id]),
      };
    });
  }, [groupedDays, regroupedActivitiesByDay, manuallyUnscheduledActivityIdMap, dedupeActivitiesById]);

  useEffect(() => {
    const validDays = new Set(displayGroupedDays.map((day) => day.dayNumber));
    setAllocatedHoursByDay((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([dayNumber]) => validDays.has(Number(dayNumber)))
      );
      if (Object.keys(next).length === Object.keys(prev).length) return prev;
      return next;
    });
  }, [displayGroupedDays]);

  const recomputedDebugCostByDay = useMemo(() => {
    if (!debugMode) return null;
    if (displayGroupedDays.length === 0) return null;
    if (!tripInfo) return null;

    const allActivitiesById = new Map<string, SuggestedActivity>();
    groupedDays.forEach((day) => {
      day.activities.forEach((activity) => {
        if (!allActivitiesById.has(activity.id)) {
          allActivitiesById.set(activity.id, activity);
        }
      });
    });
    const allActivities = [...allActivitiesById.values()];
    if (allActivities.length === 0) return null;

    const preparedMap = new Map<string, unknown>();
    allActivities.forEach((activity) => {
      const durationHours = parseDurationHours(activity.estimatedDuration);
      preparedMap.set(activity.id, {
        activity,
        durationHours,
        loadDurationHours: durationHours,
        isFullDay: isFullDayDuration(activity.estimatedDuration, durationHours),
      });
    });

    const dayGroupsForDebug: DayGroup[] = displayGroupedDays.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date,
      theme: day.theme,
      activityIds: day.activities.map((activity) => activity.id),
      nightStay: day.nightStay ?? null,
      debugCost: day.debugCost ?? null,
    }));

    const commuteMinutesByPair = new Map<string, number>();
    Object.entries(commuteByLeg).forEach(([legId, leg]) => {
      const colonIndex = legId.indexOf(":");
      if (colonIndex < 0) return;
      const pair = legId.slice(colonIndex + 1);
      const [fromId, toId] = pair.split("->");
      if (!fromId || !toId) return;
      if (fromId.startsWith("stay-") || toId.startsWith("stay-")) return;
      commuteMinutesByPair.set(activityPairKey(fromId, toId), leg.minutes);
    });

    const dayCapacities = buildDayCapacityProfiles(
      {
        source: null,
        destination: null,
        startDate: tripInfo.startDate ?? null,
        endDate: tripInfo.endDate ?? null,
        durationDays: tripInfo.durationDays ?? null,
        preferences: [],
        foodPreferences: [],
        visitedDestinations: [],
        activityLevel: "",
        travelers: 1,
        budget: null,
        transportMode: tripInfo.transportMode ?? "flight",
        arrivalAirport: tripInfo.arrivalAirport ?? null,
        departureAirport: tripInfo.departureAirport ?? null,
        arrivalTimePreference: tripInfo.arrivalTimePreference ?? null,
        departureTimePreference: tripInfo.departureTimePreference ?? null,
      },
      dayGroupsForDebug.length
    );

    const debugDayGroups = annotateDayGroupsWithCostDebug({
      dayGroups: dayGroupsForDebug as any,
      dayCapacities,
      preparedMap: preparedMap as any,
      commuteMinutesByPair,
      scheduledHoursByActivityOverride: new Map(Object.entries(allocatedHoursByActivityId)),
    });

    const byDay: Record<number, DayCostDebug | null> = {};
    debugDayGroups.forEach((day) => {
      byDay[day.dayNumber] = day.debugCost ?? null;
    });
    return byDay;
  }, [debugMode, displayGroupedDays, tripInfo, groupedDays, commuteByLeg, allocatedHoursByActivityId]);

  const activityGroupingCostDebugById = useMemo(() => {
    if (!debugMode) return {};
    if (displayGroupedDays.length === 0) return {};
    const allActivitiesById = new Map<string, SuggestedActivity>();
    groupedDays.forEach((day) => {
      day.activities.forEach((activity) => {
        if (!allActivitiesById.has(activity.id)) {
          allActivitiesById.set(activity.id, activity);
        }
      });
    });
    const allActivities = [...allActivitiesById.values()];
    if (allActivities.length === 0) return {};

    const baseDays = displayGroupedDays.map((day) => ({
      activityIds: day.activities.map((activity) => activity.id),
    }));
    const scheduledActivityIds = new Set(baseDays.flatMap((day) => day.activityIds));

    const commuteMinutesByPair = new Map<string, number>();
    Object.entries(commuteByLeg).forEach(([legId, leg]) => {
      const colonIndex = legId.indexOf(":");
      if (colonIndex < 0) return;
      const pair = legId.slice(colonIndex + 1);
      const [fromId, toId] = pair.split("->");
      if (!fromId || !toId) return;
      if (fromId.startsWith("stay-") || toId.startsWith("stay-")) return;
      commuteMinutesByPair.set(activityPairKey(fromId, toId), leg.minutes);
    });

    const dayCapacities = buildDayCapacityProfiles(
      {
        source: null,
        destination: null,
        startDate: tripInfo?.startDate ?? null,
        endDate: tripInfo?.endDate ?? null,
        durationDays: tripInfo?.durationDays ?? null,
        preferences: [],
        foodPreferences: [],
        visitedDestinations: [],
        activityLevel: "",
        travelers: 1,
        budget: null,
        transportMode: tripInfo?.transportMode ?? "flight",
        arrivalAirport: tripInfo?.arrivalAirport ?? null,
        departureAirport: tripInfo?.departureAirport ?? null,
        arrivalTimePreference: tripInfo?.arrivalTimePreference ?? null,
        departureTimePreference: tripInfo?.departureTimePreference ?? null,
      },
      displayGroupedDays.length
    );

    const basePreparedMap = new Map<string, unknown>();
    allActivities.forEach((activity) => {
      const durationHours = parseDurationHours(activity.estimatedDuration);
      basePreparedMap.set(activity.id, {
        activity,
        durationHours,
        loadDurationHours: durationHours,
        isFullDay: isFullDayDuration(activity.estimatedDuration, durationHours),
      });
    });

    const computeAfterHoursMinutes = (startMinutes: number, endMinutes: number): number => {
      if (endMinutes <= startMinutes) return 0;
      const earlyMinutes = Math.max(
        0,
        Math.min(endMinutes, EARLY_MORNING_AFTER_HOURS_END_MINUTES) - startMinutes
      );
      const nightMinutes = Math.max(0, endMinutes - Math.max(startMinutes, NIGHT_AFTER_HOURS_START_MINUTES));
      return earlyMinutes + nightMinutes;
    };

    const makeZeroComponents = () => ({
      overflow: 0,
      commute: 0,
      afterHoursCommute: 0,
      longLeg: 0,
      spread: 0,
      variety: 0,
      slotOverflow: 0,
      slotMismatch: 0,
      recommendedStartMiss: 0,
      daylightViolation: 0,
      emptySlot: 0,
    });

    const computeDayStructuralDetails = (activityIds: string[], dayCapacity: typeof dayCapacities[number]) => {
      const route = buildOptimalDayRoute(
        activityIds
          .map((id) => (basePreparedMap as Map<string, any>).get(id)?.activity)
          .filter((activity): activity is SuggestedActivity => activity != null) as any,
        basePreparedMap as any,
        commuteMinutesByPair
      );

      const byActivity = new Map<string, ReturnType<typeof makeZeroComponents>>();
      route.forEach((activity) => {
        byActivity.set(activity.id, makeZeroComponents());
      });
      const addToActivity = (activityId: string, key: keyof ReturnType<typeof makeZeroComponents>, value: number) => {
        if (!Number.isFinite(value) || value === 0) return;
        const current = byActivity.get(activityId);
        if (!current) return;
        current[key] += value;
      };

      const loadById = new Map<string, number>();
      let totalLoad = 0;
      route.forEach((activity) => {
        const load = Math.max(0.01, getLoadDurationHours(basePreparedMap as any, activity.id));
        loadById.set(activity.id, load);
        totalLoad += load;
      });
      const totalLoadSafe = totalLoad > 0 ? totalLoad : Math.max(1, route.length);
      const loadShare = (activityId: string) => (loadById.get(activityId) ?? 1) / totalLoadSafe;

      const totals = makeZeroComponents();
      if (route.length === 0) {
        return { route, totals, byActivity, loadById, totalLoad: 0, totalHours: 0 };
      }

      const totalHours = route.reduce((sum, activity) => sum + getLoadDurationHours(basePreparedMap as any, activity.id), 0);

      const legMinutes: Array<{ from: string; to: string; minutes: number }> = [];
      for (let i = 1; i < route.length; i += 1) {
        const from = route[i - 1];
        const to = route[i];
        const minutes = activityCommuteMinutes(from as any, to as any, commuteMinutesByPair);
        legMinutes.push({ from: from.id, to: to.id, minutes });
        const weighted = minutes * COST_WEIGHTS.commute;
        totals.commute += weighted;
        addToActivity(from.id, "commute", weighted / 2);
        addToActivity(to.id, "commute", weighted / 2);
      }

      const longestLeg = legMinutes.length > 0 ? Math.max(...legMinutes.map((leg) => leg.minutes)) : 0;
      const averageLeg =
        legMinutes.length > 0
          ? legMinutes.reduce((sum, leg) => sum + leg.minutes, 0) / legMinutes.length
          : 0;

      const longLegWeighted = Math.max(0, longestLeg - 75) * COST_WEIGHTS.longLeg;
      totals.longLeg = longLegWeighted;
      if (longLegWeighted > 0 && legMinutes.length > 0) {
        const longestLegs = legMinutes.filter((leg) => leg.minutes === longestLeg);
        const eachLegShare = longLegWeighted / longestLegs.length;
        longestLegs.forEach((leg) => {
          addToActivity(leg.from, "longLeg", eachLegShare / 2);
          addToActivity(leg.to, "longLeg", eachLegShare / 2);
        });
      }

      const spreadWeighted = Math.max(0, averageLeg - 45) * COST_WEIGHTS.spread;
      totals.spread = spreadWeighted;
      const totalLegMinutes = legMinutes.reduce((sum, leg) => sum + leg.minutes, 0);
      if (spreadWeighted > 0 && legMinutes.length > 0) {
        legMinutes.forEach((leg) => {
          const legShare = totalLegMinutes > 0 ? leg.minutes / totalLegMinutes : 1 / legMinutes.length;
          const weighted = spreadWeighted * legShare;
          addToActivity(leg.from, "spread", weighted / 2);
          addToActivity(leg.to, "spread", weighted / 2);
        });
      }

      const uniqueTypes = new Set(route.map((activity) => activity.type.trim().toLowerCase())).size;
      const varietyRaw = route.length > 1 ? (route.length - uniqueTypes) / route.length : 0;
      const varietyWeighted = varietyRaw * COST_WEIGHTS.variety;
      totals.variety = varietyWeighted;
      const typeCounts = route.reduce((acc, activity) => {
        const type = activity.type.trim().toLowerCase();
        acc[type] = (acc[type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const repeatedIds = route
        .filter((activity) => (typeCounts[activity.type.trim().toLowerCase()] ?? 0) > 1)
        .map((activity) => activity.id);
      if (varietyWeighted > 0) {
        const ids = repeatedIds.length > 0 ? repeatedIds : route.map((activity) => activity.id);
        const each = varietyWeighted / ids.length;
        ids.forEach((id) => addToActivity(id, "variety", each));
      }

      const slotHours: Record<"morning" | "afternoon" | "evening", number> = {
        morning: 0,
        afternoon: 0,
        evening: 0,
      };
      route.forEach((activity) => {
        if (activity.bestTimeOfDay === "any") return;
        slotHours[activity.bestTimeOfDay] += getLoadDurationHours(basePreparedMap as any, activity.id);
      });
      const slotOverflowBySlot: Record<"morning" | "afternoon" | "evening", number> = {
        morning: Math.max(0, slotHours.morning - dayCapacity.slotCapacity.morning),
        afternoon: Math.max(0, slotHours.afternoon - dayCapacity.slotCapacity.afternoon),
        evening: Math.max(0, slotHours.evening - dayCapacity.slotCapacity.evening),
      };
      totals.slotOverflow =
        (slotOverflowBySlot.morning + slotOverflowBySlot.afternoon + slotOverflowBySlot.evening) * COST_WEIGHTS.slotOverflow;
      (["morning", "afternoon", "evening"] as const).forEach((slot) => {
        const weighted = slotOverflowBySlot[slot] * COST_WEIGHTS.slotOverflow;
        if (weighted <= 0) return;
        const activitiesInSlot = route.filter((activity) => activity.bestTimeOfDay === slot);
        const slotLoad = activitiesInSlot.reduce((sum, activity) => sum + (loadById.get(activity.id) ?? 1), 0);
        activitiesInSlot.forEach((activity) => {
          const share = slotLoad > 0 ? (loadById.get(activity.id) ?? 1) / slotLoad : 1 / activitiesInSlot.length;
          addToActivity(activity.id, "slotOverflow", weighted * share);
        });
      });

      const earliestRecommendedMidpointMinutes = route.reduce<number | null>((earliest, activity) => {
        const midpoint = recommendedWindowMidpointMinutes(activity);
        if (midpoint == null) return earliest;
        return earliest == null ? midpoint : Math.min(earliest, midpoint);
      }, null);
      const softStartMinutes =
        earliestRecommendedMidpointMinutes != null
          ? Math.min(SOFT_DAY_START_MINUTES, earliestRecommendedMidpointMinutes)
          : SOFT_DAY_START_MINUTES;

      let afterHoursMinutes = 0;
      let cursor = softStartMinutes;
      for (let i = 0; i < route.length; i += 1) {
        const activity = route[i];
        const durationMinutes = Math.round(getLoadDurationHours(basePreparedMap as any, activity.id) * 60);
        const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime || null);
        const startMinutes = fixedStartMinutes != null ? Math.max(cursor, fixedStartMinutes) : cursor;
        const endMinutes = startMinutes + durationMinutes;
        if (i < route.length - 1) {
          const next = route[i + 1];
          const commuteMinutes = activityCommuteMinutes(activity as any, next as any, commuteMinutesByPair);
          const commuteAfterHours = computeAfterHoursMinutes(endMinutes, endMinutes + commuteMinutes);
          afterHoursMinutes += commuteAfterHours;
          const weighted = commuteAfterHours * COST_WEIGHTS.commute * Math.max(0, AFTER_HOURS_DRIVE_MULTIPLIER - 1);
          totals.afterHoursCommute += weighted;
          addToActivity(activity.id, "afterHoursCommute", weighted / 2);
          addToActivity(next.id, "afterHoursCommute", weighted / 2);
          cursor = endMinutes + commuteMinutes;
        } else {
          cursor = endMinutes;
        }
      }

      const assignedSlotHours: Record<"morning" | "afternoon" | "evening", number> = {
        morning: 0,
        afternoon: 0,
        evening: 0,
      };
      let timingCursorMinutes = softStartMinutes;
      for (let i = 0; i < route.length; i += 1) {
        const activity = route[i];
        const durationHours = getLoadDurationHours(basePreparedMap as any, activity.id);
        const durationMinutes = Math.round(durationHours * 60);
        const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime || null);
        const startMinutes = fixedStartMinutes != null ? Math.max(timingCursorMinutes, fixedStartMinutes) : timingCursorMinutes;
        const endMinutes = startMinutes + durationMinutes;
        const midpointHour = (startMinutes + durationMinutes / 2) / 60;
        const assignedSlot = scoringSlotForHour(midpointHour);
        assignedSlotHours[assignedSlot] += durationHours;

        if (activity.bestTimeOfDay !== "any") {
          const mismatch = scoringSlotDistance(activity.bestTimeOfDay, assignedSlot) * durationHours * COST_WEIGHTS.slotMismatch;
          totals.slotMismatch += mismatch;
          addToActivity(activity.id, "slotMismatch", mismatch);
        }

        const recommendedWindowStartMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.start || null);
        const recommendedWindowEndMinutes = scoringRecommendedWindowLatestStartMinutes(activity as any);
        let startMissHours = 0;
        if (recommendedWindowStartMinutes != null && startMinutes < recommendedWindowStartMinutes) {
          startMissHours = (recommendedWindowStartMinutes - startMinutes) / 60;
        } else if (recommendedWindowEndMinutes != null && startMinutes > recommendedWindowEndMinutes) {
          startMissHours = (startMinutes - recommendedWindowEndMinutes) / 60;
        }
        const startMissWeighted = startMissHours * COST_WEIGHTS.recommendedStartMiss;
        totals.recommendedStartMiss += startMissWeighted;
        addToActivity(activity.id, "recommendedStartMiss", startMissWeighted);

        const daylightHours =
          activity.daylightPreference === "daylight_only"
            ? Math.max(0, (endMinutes - DEFAULT_DAYLIGHT_END_MINUTES) / 60)
            : 0;
        const daylightWeighted = daylightHours * COST_WEIGHTS.daylightViolation;
        totals.daylightViolation += daylightWeighted;
        addToActivity(activity.id, "daylightViolation", daylightWeighted);

        if (i < route.length - 1) {
          const next = route[i + 1];
          timingCursorMinutes = endMinutes + activityCommuteMinutes(activity as any, next as any, commuteMinutesByPair);
        } else {
          timingCursorMinutes = endMinutes;
        }
      }

      const emptySlotHours =
        Math.max(0, dayCapacity.slotCapacity.morning - assignedSlotHours.morning) +
        Math.max(0, dayCapacity.slotCapacity.afternoon - assignedSlotHours.afternoon) +
        Math.max(0, dayCapacity.slotCapacity.evening - assignedSlotHours.evening);
      totals.emptySlot = emptySlotHours * COST_WEIGHTS.emptySlot;
      route.forEach((activity) => {
        addToActivity(activity.id, "emptySlot", totals.emptySlot * loadShare(activity.id));
      });

      const overflow = Math.max(0, totalHours - dayCapacity.maxHours);
      let overflowPenalty =
        (overflow * COST_WEIGHTS.overflow + overflow * overflow * COST_WEIGHTS.overflowQuadratic) *
        (dayCapacity.overflowPenaltyMultiplier ?? 1);
      const fullDayActivities = route.filter((activity) => (basePreparedMap as Map<string, any>).get(activity.id)?.isFullDay);
      if (fullDayActivities.length > 0) {
        let nearbyWeightedHours = 0;
        for (const activity of route) {
          if ((basePreparedMap as Map<string, any>).get(activity.id)?.isFullDay) continue;
          const duration = getLoadDurationHours(basePreparedMap as any, activity.id);
          let minDistance = Number.POSITIVE_INFINITY;
          for (const fullDayActivity of fullDayActivities) {
            minDistance = Math.min(minDistance, activityDistanceProxy(activity as any, fullDayActivity as any));
          }
          const proximityScore = 1 / (1 + minDistance);
          nearbyWeightedHours += duration * proximityScore;
        }
        overflowPenalty = Math.max(0, overflowPenalty - nearbyWeightedHours * COST_WEIGHTS.fullDayNearbyOverflowRelief);
      }
      totals.overflow = overflowPenalty;
      route.forEach((activity) => {
        addToActivity(activity.id, "overflow", totals.overflow * loadShare(activity.id));
      });

      return { route, totals, byActivity, loadById, totalLoad, totalHours };
    };

    const baseBreakdown = computeTotalCostBreakdown(
      baseDays as any,
      basePreparedMap as any,
      commuteMinutesByPair,
      dayCapacities
    );

    const dayDetailsByNumber = new Map<number, ReturnType<typeof computeDayStructuralDetails>>();
    displayGroupedDays.forEach((day, dayIndex) => {
      dayDetailsByNumber.set(
        day.dayNumber,
        computeDayStructuralDetails(day.activities.map((activity) => activity.id), dayCapacities[dayIndex])
      );
    });

    const totalScheduledLoad = displayGroupedDays.reduce((sum, day) => {
      const details = dayDetailsByNumber.get(day.dayNumber);
      return sum + Math.max(0, details?.totalLoad ?? 0);
    }, 0);
    const totalScheduledLoadSafe = totalScheduledLoad > 0 ? totalScheduledLoad : 1;

    const commuteImbalanceByActivityId: Record<string, number> = {};
    if (baseBreakdown.commuteImbalancePenalty > 0 && baseBreakdown.dayBreakdowns.length > 0) {
      const maxCommute = Math.max(...baseBreakdown.dayBreakdowns.map((dayBreakdown) => dayBreakdown.commuteProxy));
      const maxCommuteDayNumbers = displayGroupedDays
        .filter((_, index) => baseBreakdown.dayBreakdowns[index]?.commuteProxy === maxCommute)
        .map((day) => day.dayNumber);
      const maxCommuteLoad = maxCommuteDayNumbers.reduce((sum, dayNumber) => {
        const details = dayDetailsByNumber.get(dayNumber);
        return sum + Math.max(0, details?.totalLoad ?? 0);
      }, 0);
      const maxCommuteLoadSafe = maxCommuteLoad > 0 ? maxCommuteLoad : totalScheduledLoadSafe;
      maxCommuteDayNumbers.forEach((dayNumber) => {
        const details = dayDetailsByNumber.get(dayNumber);
        if (!details) return;
        details.route.forEach((activity) => {
          const load = details.loadById.get(activity.id) ?? 0;
          commuteImbalanceByActivityId[activity.id] =
            (commuteImbalanceByActivityId[activity.id] ?? 0) +
            baseBreakdown.commuteImbalancePenalty * (load / maxCommuteLoadSafe);
        });
      });
    }

    const nearbySplitByActivityId: Record<string, number> = {};
    const activityDayIndex = new Map<string, number>();
    baseDays.forEach((day, dayIndex) => {
      day.activityIds.forEach((activityId) => {
        activityDayIndex.set(activityId, dayIndex);
      });
    });
    const preparedEntries = Array.from((basePreparedMap as Map<string, any>).values()) as Array<{
      activity: SuggestedActivity;
      loadDurationHours: number;
    }>;
    const dayHoursByIndex = baseBreakdown.dayBreakdowns.map((dayBreakdown) => dayBreakdown.totalHours);
    for (let i = 0; i < preparedEntries.length; i += 1) {
      for (let j = i + 1; j < preparedEntries.length; j += 1) {
        const left = preparedEntries[i].activity;
        const right = preparedEntries[j].activity;
        const leftDay = activityDayIndex.get(left.id);
        const rightDay = activityDayIndex.get(right.id);
        if (leftDay == null || rightDay == null || leftDay === rightDay) continue;
        const commuteMinutes = activityCommuteMinutes(left as any, right as any, commuteMinutesByPair);
        if (commuteMinutes > NEARBY_CLUSTER_MAX_COMMUTE_MINUTES) continue;
        const leftLoad = preparedEntries[i].loadDurationHours;
        const rightLoad = preparedEntries[j].loadDurationHours;
        const leftProfile = dayCapacities[leftDay];
        const rightProfile = dayCapacities[rightDay];
        const leftTotalIfMerged = (dayHoursByIndex[leftDay] ?? 0) + rightLoad;
        const rightTotalIfMerged = (dayHoursByIndex[rightDay] ?? 0) + leftLoad;
        const squeezableOnEitherDay =
          (leftProfile && leftTotalIfMerged <= leftProfile.maxHours + NEARBY_CLUSTER_SQUEEZE_HOURS) ||
          (rightProfile && rightTotalIfMerged <= rightProfile.maxHours + NEARBY_CLUSTER_SQUEEZE_HOURS);
        if (!squeezableOnEitherDay) continue;
        const proximity = (NEARBY_CLUSTER_MAX_COMMUTE_MINUTES - commuteMinutes) / NEARBY_CLUSTER_MAX_COMMUTE_MINUTES;
        const pairWeightedPenalty = proximity * (leftLoad + rightLoad) * 0.5 * COST_WEIGHTS.nearbySplit;
        nearbySplitByActivityId[left.id] = (nearbySplitByActivityId[left.id] ?? 0) + pairWeightedPenalty / 2;
        nearbySplitByActivityId[right.id] = (nearbySplitByActivityId[right.id] ?? 0) + pairWeightedPenalty / 2;
      }
    }

    const durationMismatchByActivityId: Record<string, number> = {};
    allActivities.forEach((activity) => {
      const prepared = (basePreparedMap as Map<string, any>).get(activity.id);
      if (!prepared) return;
      const recommendedHours = Math.max(0, prepared.durationHours ?? 0);
      const isScheduled = scheduledActivityIds.has(activity.id);
      const overrideHours = allocatedHoursByActivityId[activity.id];
      const scheduledHours = isScheduled
        ? Math.max(0, Math.min(overrideHours ?? prepared.loadDurationHours ?? 0, recommendedHours))
        : 0;
      const underscheduledHours = Math.max(0, recommendedHours - scheduledHours);
      durationMismatchByActivityId[activity.id] =
        underscheduledHours * COST_WEIGHTS.underDurationShortfallLinear +
        underscheduledHours * underscheduledHours * COST_WEIGHTS.underDurationShortfallQuadratic;
    });

    const debugById: Record<string, { score: number; breakdown: ActivityGroupingCostBreakdown }> = {};
    allActivities.forEach((activity) => {
      const isScheduled = scheduledActivityIds.has(activity.id);
      const dayNumber = displayGroupedDays.find((day) => day.activities.some((a) => a.id === activity.id))?.dayNumber ?? null;
      const dayDetails = dayNumber != null ? dayDetailsByNumber.get(dayNumber) : null;
      const activityDetails = dayDetails?.byActivity.get(activity.id) ?? makeZeroComponents();
      const balanceShare =
        isScheduled && dayDetails && dayDetails.totalLoad > 0 && dayNumber != null
          ? ((baseBreakdown.dayBreakdowns[displayGroupedDays.findIndex((day) => day.dayNumber === dayNumber)]?.balancePenalty ?? 0) *
            ((dayDetails.loadById.get(activity.id) ?? 0) / dayDetails.totalLoad))
          : 0;
      const commuteImbalanceShare = commuteImbalanceByActivityId[activity.id] ?? 0;
      const nearbySplitShare = nearbySplitByActivityId[activity.id] ?? 0;
      const durationMismatch = durationMismatchByActivityId[activity.id] ?? 0;
      const total =
        activityDetails.overflow +
        activityDetails.commute +
        activityDetails.afterHoursCommute +
        activityDetails.longLeg +
        activityDetails.spread +
        activityDetails.variety +
        activityDetails.slotOverflow +
        activityDetails.slotMismatch +
        activityDetails.recommendedStartMiss +
        activityDetails.daylightViolation +
        activityDetails.emptySlot +
        balanceShare +
        commuteImbalanceShare +
        nearbySplitShare +
        durationMismatch;

      debugById[activity.id] = {
        score: total,
        breakdown: {
          kind: isScheduled ? "scheduled" : "unscheduled",
          total,
          details: isScheduled
            ? ["Direct component contributions from the current plan (no delta)."]
            : ["Unscheduled activity: only duration mismatch contributes in the current plan."],
          lines: [
            { label: "Overflow", value: activityDetails.overflow },
            { label: "Commute", value: activityDetails.commute },
            { label: "After-hours commute", value: activityDetails.afterHoursCommute },
            { label: "Long-leg", value: activityDetails.longLeg },
            { label: "Spread", value: activityDetails.spread },
            { label: "Variety", value: activityDetails.variety },
            { label: "Slot overflow", value: activityDetails.slotOverflow },
            { label: "Slot mismatch", value: activityDetails.slotMismatch },
            { label: "Recommended-start miss", value: activityDetails.recommendedStartMiss },
            { label: "Daylight violation", value: activityDetails.daylightViolation },
            { label: "Empty slot", value: activityDetails.emptySlot },
            { label: "Balance", value: balanceShare },
            { label: "Commute imbalance", value: commuteImbalanceShare },
            { label: "Nearby split", value: nearbySplitShare },
            { label: "Duration mismatch", value: durationMismatch },
          ],
        },
      };
    });

    return debugById;
  }, [debugMode, displayGroupedDays, groupedDays, commuteByLeg, tripInfo, allocatedHoursByActivityId]);
  const activityGroupingCostById = useMemo(() => {
    const byId: Record<string, number> = {};
    Object.entries(activityGroupingCostDebugById).forEach(([id, value]) => {
      byId[id] = value.score;
    });
    return byId;
  }, [activityGroupingCostDebugById]);
  const activityGroupingCostBreakdownById = useMemo(() => {
    const byId: Record<string, ActivityGroupingCostBreakdown> = {};
    Object.entries(activityGroupingCostDebugById).forEach(([id, value]) => {
      byId[id] = value.breakdown;
    });
    return byId;
  }, [activityGroupingCostDebugById]);
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

  const overallDebugCost = useMemo(() => {
    const firstDayNumber = displayGroupedDays[0]?.dayNumber;
    if (firstDayNumber == null) return null;
    return recomputedDebugCostByDay?.[firstDayNumber]?.overallTripCost
      ?? displayGroupedDays[0]?.debugCost?.overallTripCost
      ?? null;
  }, [displayGroupedDays, recomputedDebugCostByDay]);

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
        setManuallyUnscheduledActivityIdMap((prev) => ({ ...prev, [movingActivity.id]: true }));
        setMovingActivity(null);
        return;
      }
      setManuallyUnscheduledActivityIdMap((prev) => {
        if (!prev[movingActivity.id]) return prev;
        const next = { ...prev };
        delete next[movingActivity.id];
        return next;
      });
      setForcedScheduledDayMap((prev) => ({ ...prev, [toDay]: true }));
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
                        const dayDebugCost = recomputedDebugCostByDay?.[day.dayNumber] ?? day.debugCost;
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
                          forceScheduleDay={forcedScheduledDayMap[day.dayNumber] === true}
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
                          activityGroupingCostById={activityGroupingCostById}
                          activityGroupingCostBreakdownById={activityGroupingCostBreakdownById}
                          onAllocatedHoursChange={handleAllocatedHoursChange}
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
                          groupingCostScore={activityGroupingCostById[activity.id] ?? null}
                          groupingCostBreakdown={activityGroupingCostBreakdownById[activity.id] ?? null}
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
