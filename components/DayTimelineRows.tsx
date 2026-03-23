import { useMemo, useEffect, type DragEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Home, AlertTriangle, Utensils } from "lucide-react";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";
import { DayActivityItem } from "@/components/DayActivityItem";
import {
  type CommuteMode,
  formatHourLabel,
  toClockLabel,
  roundToQuarter,
  formatRecommendedStartWindowLabel,
  toRangeLabel,
  buildLegId,
  pickCommuteMode,
  getActivityExitPointToward,
  getActivityStartPoint,
  estimateCommuteMinutes,
  daylightEndCapMinutes,
  commuteModeLabel,
  buildStayStartLegId,
  buildStayEndLegId,
  parseEstimatedHours,
  estimateRouteIntrinsicMinutes,
  activityLoadFactor,
  parseFixedStartTimeMinutes,
  hasHardFixedStart,
  recommendedWindowMidpointMinutes,
  nightOnlyStartFloorMinutes,
  getActivityTimingPolicy,
  LUNCH_BLOCK_MINUTES,
  COMMUTE_TRANSITION_BUFFER_MINUTES,
  AIRPORT_ARRIVAL_LEAD_MINUTES,
  PRE_DAY_BUFFER_MINUTES,
  MIN_SCHEDULED_DURATION_RATIO,
  DEFAULT_SUNSET_MINUTES,
  LUNCH_MIN_START_MINUTES,
  LUNCH_TARGET_START_MINUTES,
  DEPARTURE_TRANSFER_MINUTES,
  REGULAR_DAY_START_MINUTES,
  REGULAR_DAY_END_MINUTES,
  OFF_HOURS_ACTIVITY_DISCOUNT
} from "@/lib/utils/timeline-utils";

type DayTabKey = number | "unscheduled";

export interface DayTimelineRowsProps {
  day: GroupedDay;
  rawDay?: GroupedDay;
  dayIndex: number;
  startStayLabel?: string | null;
  endStayLabel?: string | null;
  startStayCoordinates?: { lat: number; lng: number } | null;
  endStayCoordinates?: { lat: number; lng: number } | null;

  // Callbacks and context from parent
  isFinalDepartureDay: boolean;
  startContext: any; // we'll type this as any to avoid exporting the type
  regroupedActivities: { scheduledActivities: SuggestedActivity[], prunedActivities: SuggestedActivity[] };
  forceScheduleDay?: boolean;

  // Contextual state from parent
  commuteByLeg: Record<string, { minutes: number; mode: CommuteMode }>;
  isRailFriendlyDestination: boolean;
  sunsetMinutes: number;
  tripInfo?: any;

  // UI preferences and display state
  debugMode?: boolean;
  userPreferences?: string[];
  displayGroupedDays: GroupedDay[];
  collapsedActivityCards: Record<string, boolean>;
  movingActivity: { id: string; fromDay: number } | null;
  dragInsertion: { dayNumber: number; index: number } | null;
  draggedActivity: { id: string; dayNumber: number; index: number } | null;
  sourceDayByActivityId: Record<string, number>;

  // Handlers
  onDayDragOver: (event: DragEvent<HTMLDivElement>, dayNumber: number, activitiesLength: number) => void;
  onActivityDrop: (event: DragEvent<HTMLDivElement>, dayNumber: number, fallbackIndex: number) => void;
  onActivityDragStart: (event: DragEvent<HTMLDivElement>, activityId: string, dayNumber: number, index: number) => void;
  onActivityDragOver: (event: DragEvent<HTMLDivElement>, dayNumber: number, index: number) => void;
  onActivityDragEnd: () => void;
  onToggleCollapse: (activityId: string) => void;
  onMoveStart: (activityId: string, fromDay: number) => void;
  onMoveConfirm: (toDay: number | "unscheduled") => void;
  onMoveCancel: () => void;
  onMoveWithinDay: (activityId: string, dayNumber: number, targetIndex: number) => void;
}

export function DayTimelineRows({
  day,
  rawDay,
  dayIndex,
  startStayLabel,
  endStayLabel,
  startStayCoordinates,
  endStayCoordinates,

  isFinalDepartureDay,
  startContext,
  regroupedActivities,
  forceScheduleDay = false,

  commuteByLeg,
  isRailFriendlyDestination,
  sunsetMinutes,
  tripInfo,

  debugMode,
  userPreferences,
  displayGroupedDays,
  collapsedActivityCards,
  movingActivity,
  dragInsertion,
  draggedActivity,
  sourceDayByActivityId,

  onDayDragOver: handleDayDragOver,
  onActivityDrop: handleActivityDrop,
  onActivityDragStart: handleActivityDragStart,
  onActivityDragOver: handleActivityDragOver,
  onActivityDragEnd: handleActivityDragEnd,
  onToggleCollapse: toggleActivityCollapse,
  onMoveStart: handleMoveStart,
  onMoveConfirm: handleMoveConfirm,
  onMoveCancel: handleMoveCancel,
  onMoveWithinDay: handleMoveWithinDay,
}: DayTimelineRowsProps) {
  const DEPARTURE_TRANSFER_MINUTES_ESTIMATE = DEPARTURE_TRANSFER_MINUTES;
  const availableVisitHours = startContext.availableVisitHours;
  const lunchHours = 1;
  // Render from the recomputed scheduled set so each drag/move/add/remove starts from
  // a fresh day plan rather than incremental timeline artifacts.
  const sortedActivities = forceScheduleDay ? day.activities : regroupedActivities.scheduledActivities;

  const totalCommuteMinutesEstimate = sortedActivities.reduce((sum, activity, index) => {
    const next = sortedActivities[index + 1];
    if (!next) return sum;
    const legId = buildLegId(day.dayNumber, activity.id, next.id);
    const fallbackMinutes =
      estimateCommuteMinutes(getActivityExitPointToward(activity, getActivityStartPoint(next)), getActivityStartPoint(next));
    const commuteMinutes = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
    return sum + commuteMinutes;
  }, 0);
  const firstActivity = sortedActivities[0];
  const lastActivity = sortedActivities[sortedActivities.length - 1];
  const stayStartCommuteMinutes =
    startContext.startLabel && firstActivity && startStayCoordinates
      ? (commuteByLeg[buildStayStartLegId(day.dayNumber, firstActivity.id)]?.minutes ??
        estimateCommuteMinutes(startStayCoordinates, getActivityStartPoint(firstActivity)))
      : 0;
  const stayStartCommuteMode: CommuteMode =
    startContext.startLabel && firstActivity && startStayCoordinates
      ? pickCommuteMode(startStayCoordinates, getActivityStartPoint(firstActivity), isRailFriendlyDestination)
      : isRailFriendlyDestination
        ? "TRAIN"
        : "DRIVE";
  const arrivalTransferMinutes =
    dayIndex === 0
      ? Math.max(20, Math.min(90, roundToQuarter((stayStartCommuteMinutes > 0 ? stayStartCommuteMinutes : 15) + 30)))
      : 0;
  const stayEndCommuteMinutes =
    endStayLabel && lastActivity && endStayCoordinates
      ? (commuteByLeg[buildStayEndLegId(day.dayNumber, lastActivity.id)]?.minutes ??
        estimateCommuteMinutes(getActivityExitPointToward(lastActivity, endStayCoordinates), endStayCoordinates))
      : 0;
  const stayEndCommuteMode: CommuteMode =
    endStayLabel && lastActivity && endStayCoordinates
      ? pickCommuteMode(getActivityExitPointToward(lastActivity, endStayCoordinates), endStayCoordinates, isRailFriendlyDestination)
      : isRailFriendlyDestination
        ? "TRAIN"
        : "DRIVE";
  const endOfDayCommuteMinutes = isFinalDepartureDay ? DEPARTURE_TRANSFER_MINUTES_ESTIMATE : stayEndCommuteMinutes;
  const endOfDayCommuteMode: CommuteMode = isFinalDepartureDay ? "DRIVE" : stayEndCommuteMode;
  const totalCommuteHoursEstimate = (totalCommuteMinutesEstimate + stayStartCommuteMinutes + endOfDayCommuteMinutes) / 60;
  const remainingForActivities = Math.max(availableVisitHours - lunchHours - totalCommuteHoursEstimate, 0);
  const totalRequestedHours = sortedActivities.reduce((sum, activity) => {
    const estimatedHours = parseEstimatedHours(activity.estimatedDuration);
    const routeFloorHours = (estimateRouteIntrinsicMinutes(activity) ?? 0) / 60;
    return sum + Math.max(estimatedHours, routeFloorHours) * activityLoadFactor(activity);
  }, 0);
  const freeActivityHours = Math.max(0, remainingForActivities - totalRequestedHours);
  const earliestFixedStartMinutes = sortedActivities
    .filter((activity) => hasHardFixedStart(activity))
    .map((activity) => parseFixedStartTimeMinutes(activity.fixedStartTime))
    .filter((minutes): minutes is number => minutes != null)
    .sort((a, b) => a - b)[0];
  const earliestRecommendedMidpointMinutes = sortedActivities
    .map((activity) => recommendedWindowMidpointMinutes(activity))
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
  const formatMinutesLabel = (minutes: number): string => {
    const rounded = Math.max(0, Math.round(minutes));
    if (rounded % 60 === 0) return `${rounded / 60} hr`;
    if (rounded > 60) return `${Math.floor(rounded / 60)} hr ${rounded % 60} min`;
    return `${rounded} min`;
  };
  const buildCommuteDetail = ({
    mode,
    travelMinutes,
    slotMinutes,
    estimated = false,
    note,
  }: {
    mode: CommuteMode;
    travelMinutes: number;
    slotMinutes: number;
    estimated?: boolean;
    note?: string;
  }): string => {
    const estimateSuffix = estimated ? " (estimated)" : "";
    const bufferMinutes = Math.max(0, slotMinutes - travelMinutes);
    const base = `${commuteModeLabel(mode)} · Travel ~${Math.max(0, Math.round(travelMinutes))} min${estimateSuffix} · Scheduled ${formatMinutesLabel(slotMinutes)}`;
    return bufferMinutes > 0
      ? `${base} (${formatMinutesLabel(bufferMinutes)} buffer)${note ? ` · ${note}` : ""}`
      : `${base}${note ? ` · ${note}` : ""}`;
  };
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
      <div className="rounded-md border border-dashed border-sky-200 bg-sky-50/40 p-3 text-xs text-sky-800 space-y-2">
        {dayIndex === 0 ? (
          <>
            <div>Arrive at airport ({startContext.arrivalTiming || tripInfo?.arrivalTimePreference || "12:00 PM"}).</div>
            <div>Airport transfer: Drive · Approx {arrivalTransferMinutes} min (estimated).</div>
            <div>Hotel check-in: {day.nightStay?.label || "your stay"}.</div>
          </>
        ) : null}
        <div>No activities yet. Reserve about 1 hr for lunch and keep 2-3 flexible hours.</div>
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
  const commuteTransitionBufferMinutes = COMMUTE_TRANSITION_BUFFER_MINUTES;
  const airportArrivalLeadMinutes = AIRPORT_ARRIVAL_LEAD_MINUTES;
  const departureClock = tripInfo?.departureTimePreference || "6:00 PM";
  const departureMinutes = parseFixedStartTimeMinutes(departureClock) ?? DEFAULT_SUNSET_MINUTES;
  const airportArrivalDeadlineMinutes = Math.max(10 * 60, departureMinutes - airportArrivalLeadMinutes);
  const bufferedEndOfDayCommuteMinutes =
    endOfDayCommuteMinutes > 0 ? roundToQuarter(endOfDayCommuteMinutes + commuteTransitionBufferMinutes) : 0;
  const eveningCutoffMinutes = isFinalDepartureDay
    ? Math.max(10 * 60, airportArrivalDeadlineMinutes - bufferedEndOfDayCommuteMinutes)
    : DEFAULT_SUNSET_MINUTES;
  const lunchMinStart = LUNCH_MIN_START_MINUTES;
  const lunchTargetStart = LUNCH_TARGET_START_MINUTES;
  const lunchBlockMinutes = LUNCH_BLOCK_MINUTES;
  const preDayBufferMinutes = PRE_DAY_BUFFER_MINUTES;
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
    cursorMinutes = Math.max(0, roundToQuarter(earliestFixedStartMinutes - bufferedStayStartCommuteMinutes - preDayBufferMinutes));
  }
  if (startContext.startLabel) {
    timelineItems.push({
      type: "stay",
      id: `stay-start-${day.dayNumber}`,
      title: dayIndex === 0 ? `Arrive at airport (${startContext.arrivalTiming || tripInfo?.arrivalTimePreference || "12:00 PM"})` : startContext.startTitle,
      detail: startContext.startLabel,
    });
    if (dayIndex === 0) {
      const airportTransferStart = roundToQuarter(cursorMinutes);
      const airportTransferEnd = airportTransferStart + roundToQuarter(arrivalTransferMinutes + commuteTransitionBufferMinutes);
      const airportTransferSlotMinutes = Math.max(0, airportTransferEnd - airportTransferStart);
      scheduledCommuteMinutes += Math.max(0, airportTransferEnd - airportTransferStart);
      timelineItems.push({
        type: "commute",
        id: `commute-airport-stay-${day.dayNumber}`,
        title: "Airport transfer",
        detail: buildCommuteDetail({
          mode: "DRIVE",
          travelMinutes: arrivalTransferMinutes,
          slotMinutes: airportTransferSlotMinutes,
          estimated: true,
        }),
        timeRange: toRangeLabel(airportTransferStart, airportTransferEnd),
      });
      cursorMinutes = airportTransferEnd;
      timelineItems.push({
        type: "stay",
        id: `checkin-${day.dayNumber}`,
        title: "Hotel check-in",
        detail: day.nightStay?.label || "At your stay",
      });
    }
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
          detail: `About ${formatMinutesLabel(lunchBlockMinutes)}`,
          timeRange: toRangeLabel(lunchStart, lunchEnd),
        });
        cursorMinutes = lunchEnd;
      }
      const bufferedCommuteMinutes = roundToQuarter(stayStartCommuteMinutes + commuteTransitionBufferMinutes);
      const commuteStart = roundToQuarter(cursorMinutes);
      const commuteEnd = commuteStart + bufferedCommuteMinutes;
      const stayStartSlotMinutes = Math.max(0, commuteEnd - commuteStart);
      scheduledCommuteMinutes += Math.max(0, commuteEnd - commuteStart);
      timelineItems.push({
        type: "commute",
        id: `commute-stay-start-${day.dayNumber}`,
        title: "Commute",
        detail: buildCommuteDetail({
          mode: stayStartCommuteMode,
          travelMinutes: stayStartCommuteMinutes,
          slotMinutes: stayStartSlotMinutes,
        }),
        timeRange: toRangeLabel(commuteStart, commuteEnd),
      });
      cursorMinutes = commuteEnd;
    }
  }
  let lunchInserted = timelineItems.some((item) => item.type === "lunch");
  let hasScheduledPrimaryActivity = false;

  const droppedForDepartureBuffer: string[] = regroupedActivities.prunedActivities.map((activity: SuggestedActivity) => activity.name);
  let departureCutoffReached = false;

  sortedActivities.forEach((activity, index) => {
    if (departureCutoffReached && !forceScheduleDay) {
      droppedForDepartureBuffer.push(activity.name);
      return;
    }
    const estimatedHours = parseEstimatedHours(activity.estimatedDuration);
    const routeFloorHours = (estimateRouteIntrinsicMinutes(activity) ?? 0) / 60;
    const recommendedHours = Math.max(estimatedHours, routeFloorHours);
    const requestedHours = recommendedHours * activityLoadFactor(activity);
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
    const arrivalConflictWarning =
      dayIndex === 0 && fixedStartMinutes != null && fixedStartMinutes < startContext.dayStartMinutes
        ? `Arrival conflict: fixed start ${toClockLabel(fixedStartMinutes)} is before feasible start ${toClockLabel(startContext.dayStartMinutes)}.`
        : null;
    const nightStartFloorMinutes = nightOnlyStartFloorMinutes(activity, sunsetMinutes);
    const roundedCursorMinutes = roundToQuarter(cursorMinutes);
    if (!forceScheduleDay && fixedAlignedStartMinutes != null && roundedCursorMinutes > fixedAlignedStartMinutes) {
      droppedForDepartureBuffer.push(activity.name);
      return;
    }
    const activityStart = fixedAlignedStartMinutes != null
      ? Math.max(fixedAlignedStartMinutes, nightStartFloorMinutes ?? 0)
      : Math.max(roundedCursorMinutes, nightStartFloorMinutes ?? 0);
    if (!forceScheduleDay && isFinalDepartureDay && activityStart >= eveningCutoffMinutes) {
      droppedForDepartureBuffer.push(activity.name);
      departureCutoffReached = true;
      return;
    }
    const uncappedActivityEnd = activityStart + activityMinutes;
    const daylightCapMinutes = daylightEndCapMinutes(activity, eveningCutoffMinutes, sunsetMinutes);
    const departureHardCapMinutes = isFinalDepartureDay ? eveningCutoffMinutes : null;
    const effectiveCapMinutes = forceScheduleDay
      ? null
      : departureHardCapMinutes != null && daylightCapMinutes != null
        ? Math.min(departureHardCapMinutes, daylightCapMinutes)
        : (departureHardCapMinutes ?? daylightCapMinutes);
    const hasHardActivityCap = effectiveCapMinutes != null;
    const canApplyDaylightCap = hasHardActivityCap && (effectiveCapMinutes as number) > activityStart;
    const activityEnd =
      hasHardActivityCap ? Math.min(uncappedActivityEnd, effectiveCapMinutes as number) : uncappedActivityEnd;
    const effectiveScheduledHours = Math.max(0, (activityEnd - activityStart) / 60);
    const minimumRequiredHours = recommendedHours * MIN_SCHEDULED_DURATION_RATIO;
    if (!forceScheduleDay && effectiveScheduledHours + 1e-6 < minimumRequiredHours) {
      droppedForDepartureBuffer.push(activity.name);
      return;
    }
    const recommendedWindowEndMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.end);
    const recommendedWindowLabel = formatRecommendedStartWindowLabel(activity);
    const lateStartWarning =
      recommendedWindowEndMinutes != null && activityStart > recommendedWindowEndMinutes
        ? `Late-start risk: recommended ${recommendedWindowLabel || "earlier"}${activity.recommendedStartWindow?.reason ? ` (${activity.recommendedStartWindow.reason})` : ""}.`
        : null;
    const daylightWarning =
      canApplyDaylightCap && effectiveCapMinutes != null && uncappedActivityEnd > effectiveCapMinutes
        ? `Ends by ${toClockLabel(effectiveCapMinutes)} to stay on schedule.`
        : null;
    const daylightConflictWarning =
      !canApplyDaylightCap && effectiveCapMinutes != null
        ? isFinalDepartureDay
          ? `Departure cutoff conflict: no time remains before airport transfer.`
          : `Daylight conflict: no daylight remains for this slot.`
        : null;
    const nightOnlyWarning =
      nightStartFloorMinutes != null
        ? `Scheduled after sunset (${toClockLabel(sunsetMinutes)}).`
        : null;
    const combinedWarning = [arrivalConflictWarning, lateStartWarning, daylightWarning, daylightConflictWarning, nightOnlyWarning].filter(Boolean).join(" ");
    const lunchMinutes = LUNCH_BLOCK_MINUTES;
    const effectiveActivityEnd = activityEnd;
    if (effectiveActivityEnd <= activityStart) return;
    if (isFinalDepartureDay && effectiveActivityEnd <= activityStart) {
      droppedForDepartureBuffer.push(activity.name);
      departureCutoffReached = true;
      return;
    }

    // If a long activity crosses lunch, split it into before-lunch and continue-after-lunch.
    const crossesLunchWindow = !lunchInserted && activityStart < lunchTargetStart && effectiveActivityEnd > lunchTargetStart;
    if (crossesLunchWindow) {
      const lunchStart = roundToQuarter(Math.max(lunchTargetStart, lunchMinStart));
      const lunchEnd = lunchStart + lunchMinutes;
      const beforeLunchEnd = Math.max(activityStart + 30, lunchStart);
      const afterLunchStart = lunchEnd;
      const afterLunchEnd = afterLunchStart + Math.max(30, effectiveActivityEnd - beforeLunchEnd);
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
        detail: `About ${formatMinutesLabel(lunchMinutes)}`,
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
      const preLunchGapMinutes = Math.max(0, activityStart - roundToQuarter(cursorMinutes));
      const canInsertLunchBeforeFirstActivity = !hasScheduledPrimaryActivity && preLunchGapMinutes >= lunchMinutes;
      if (!lunchInserted && activityStart >= lunchMinStart && (hasScheduledPrimaryActivity || canInsertLunchBeforeFirstActivity)) {
        const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
        const lunchEnd = lunchStart + lunchMinutes;
        timelineItems.push({
          type: "lunch",
          id: `lunch-${day.dayNumber}`,
          title: "Lunch break",
          detail: `About ${formatMinutesLabel(lunchMinutes)}`,
          timeRange: toRangeLabel(lunchStart, lunchEnd),
        });
        cursorMinutes = lunchEnd;
      }

      const nextActivityStart =
        fixedAlignedStartMinutes != null
          ? Math.max(roundToQuarter(cursorMinutes), fixedAlignedStartMinutes, nightStartFloorMinutes ?? 0)
          : Math.max(roundToQuarter(cursorMinutes), nightStartFloorMinutes ?? 0);
      const uncappedNextActivityEnd = nextActivityStart + activityMinutes;
      const hasHardCapForNext = daylightCapMinutes != null;
      const nextActivityEndCapped =
        hasHardCapForNext && daylightCapMinutes != null
          ? Math.min(uncappedNextActivityEnd, daylightCapMinutes)
          : uncappedNextActivityEnd;
      const nextActivityEnd = nextActivityEndCapped;
      if (nextActivityEnd <= nextActivityStart) return;
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
      const fallbackOrigin = getActivityExitPointToward(activity, getActivityStartPoint(next));
      const fallbackMode = pickCommuteMode(fallbackOrigin, getActivityStartPoint(next), isRailFriendlyDestination);
      const fallbackMinutes = estimateCommuteMinutes(fallbackOrigin, getActivityStartPoint(next));
      const commuteMode = commuteByLeg[legId]?.mode ?? fallbackMode;
      const commuteMinutes = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
      const bufferedCommuteMinutes = roundToQuarter(commuteMinutes + commuteTransitionBufferMinutes);
      const nextDaylightCapMinutes = daylightEndCapMinutes(next, eveningCutoffMinutes, sunsetMinutes);
      const projectedArrivalAfterCommute = roundToQuarter(cursorMinutes) + bufferedCommuteMinutes;
      const commuteStart = roundToQuarter(cursorMinutes);
      const commuteEnd = commuteStart + bufferedCommuteMinutes;
      const interActivitySlotMinutes = Math.max(0, commuteEnd - commuteStart);
      scheduledCommuteMinutes += Math.max(0, commuteEnd - commuteStart);
      const cutoffNote =
        nextDaylightCapMinutes != null && projectedArrivalAfterCommute >= nextDaylightCapMinutes
          ? "Arrives near/after daylight cutoff"
          : undefined;
      timelineItems.push({
        type: "commute",
        id: `commute-${activity.id}-${next.id}`,
        title: "Commute",
        detail: buildCommuteDetail({
          mode: commuteMode,
          travelMinutes: commuteMinutes,
          slotMinutes: interActivitySlotMinutes,
          note: cutoffNote,
        }),
        timeRange: toRangeLabel(commuteStart, commuteEnd),
      });
      cursorMinutes = commuteEnd;
    }
  });

  if (!hasScheduledPrimaryActivity && stayStartCommuteMinutes > 0) {
    const stayStartCommuteId = `commute-stay-start-${day.dayNumber}`;
    const beforeCount = timelineItems.length;
    const filtered = timelineItems.filter((item) => item.id !== stayStartCommuteId);
    if (filtered.length !== beforeCount) {
      timelineItems.length = 0;
      timelineItems.push(...filtered);
      const bufferedCommuteMinutes = roundToQuarter(stayStartCommuteMinutes + commuteTransitionBufferMinutes);
      scheduledCommuteMinutes = Math.max(0, scheduledCommuteMinutes - Math.max(0, bufferedCommuteMinutes));
    }
  }

  // Ensure lunch is always present in the afternoon even if all activities finished early.
  if (!lunchInserted) {
    const lunchMinutes = LUNCH_BLOCK_MINUTES;
    const lunchStart = roundToQuarter(Math.max(cursorMinutes, lunchTargetStart, lunchMinStart));
    const lunchEnd = lunchStart + lunchMinutes;
    timelineItems.push({
      type: "lunch",
      id: `lunch-${day.dayNumber}`,
      title: "Lunch break",
      detail: `About ${formatMinutesLabel(lunchMinutes)}`,
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

  if (isFinalDepartureDay || endStayLabel) {
    if (isFinalDepartureDay) {
      cursorMinutes = Math.min(cursorMinutes, eveningCutoffMinutes);
    }
    if (endOfDayCommuteMinutes > 0 && hasScheduledPrimaryActivity) {
      const bufferedCommuteMinutes = roundToQuarter(endOfDayCommuteMinutes + commuteTransitionBufferMinutes);
      const commuteStart = roundToQuarter(cursorMinutes);
      const commuteEnd = commuteStart + bufferedCommuteMinutes;
      const endOfDaySlotMinutes = Math.max(0, commuteEnd - commuteStart);
      scheduledCommuteMinutes += Math.max(0, commuteEnd - commuteStart);
      timelineItems.push({
        type: "commute",
        id: `commute-stay-end-${day.dayNumber}`,
        title: isFinalDepartureDay ? "Airport transfer" : "Commute",
        detail: buildCommuteDetail({
          mode: endOfDayCommuteMode,
          travelMinutes: endOfDayCommuteMinutes,
          slotMinutes: endOfDaySlotMinutes,
          estimated: isFinalDepartureDay,
        }),
        timeRange: toRangeLabel(commuteStart, commuteEnd),
      });
      cursorMinutes = commuteEnd;
      if (isFinalDepartureDay && commuteEnd > airportArrivalDeadlineMinutes) {
        const latenessMinutes = commuteEnd - airportArrivalDeadlineMinutes;
        timelineItems.push({
          type: "continue",
          id: `reschedule-airport-buffer-${day.dayNumber}`,
          title: "Departure timing warning",
          detail: `Airport arrival target is ${toClockLabel(airportArrivalDeadlineMinutes)} (2 hr before ${departureClock}). Current plan arrives ${latenessMinutes} min late.`,
          timeRange: "Schedule check needed",
        });
      }
    }
    timelineItems.push({
      type: "stay",
      id: `stay-end-${day.dayNumber}`,
      title: isFinalDepartureDay ? "Departure prep" : "End at night stay",
      detail: isFinalDepartureDay
        ? `Checkout${tripInfo?.transportMode === "car" ? ", return rental car," : ","
        } then head to ${tripInfo?.departureAirport || "the airport"} for ${departureClock} departure. Target airport arrival by ${toClockLabel(airportArrivalDeadlineMinutes)}. Airport transfer shown above is an estimate.`
        : (endStayLabel || "End at night stay"),
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
      <div className="overflow-x-auto pb-1">
        <div
          className="min-w-[640px] space-y-2 pr-2"
          onDragOver={(event) => handleDayDragOver(event, day.dayNumber, sortedActivities.length)}
          onDrop={(event) => handleActivityDrop(event, day.dayNumber, sortedActivities.length)}
        >
          {(() => {
            const seenTimelineIds = new Map<string, number>();
            return timelineItems.map((item, index) => {
              const seenCount = seenTimelineIds.get(item.id) ?? 0;
              seenTimelineIds.set(item.id, seenCount + 1);
              const timelineKey = seenCount === 0 ? item.id : `${item.id}-${seenCount + 1}`;
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
                <div key={timelineKey} className="flex gap-3">
                  <div className="w-10 shrink-0 relative flex flex-col items-center">
                    <div className={`mt-2 h-3 w-3 rounded-full border-2 ${dotClass}`} />
                    {!isLast ? <div className="w-px flex-1 bg-gray-200 my-1" /> : null}
                  </div>
                  <div className="flex-1 pb-2">
                    {item.type === "activity" ? (
                      (() => {
                        const activityIndex = sortedActivities.findIndex((a) => a.id === item.activity.id);
                        const safeActivityIndex = activityIndex >= 0 ? activityIndex : 0;
                        const insertionBefore =
                          dragInsertion?.dayNumber === day.dayNumber && dragInsertion.index === activityIndex;
                        const isDragging =
                          draggedActivity?.id === item.activity.id && draggedActivity.dayNumber === day.dayNumber;
                        return (
                          <div
                            draggable={false}
                            className={`rounded-md select-none ${isDragging ? "opacity-50" : ""}`}
                          >
                            {insertionBefore ? <div className="mb-1 h-0.5 rounded bg-primary/70" /> : null}
                            <DayActivityItem
                              activity={item.activity}
                              dayNumber={day.dayNumber}
                              sourceDayNumber={sourceDayByActivityId[item.activity.id]}
                              index={safeActivityIndex}
                              timeSlotLabel={item.timeRange}
                              affordLabel={item.affordLabel}
                              isMoving={movingActivity?.id === item.activity.id}
                              isCollapsed={collapsedActivityCards[item.activity.id] ?? true}
                              debugMode={debugMode ?? false}
                              userPreferences={userPreferences ?? []}
                              displayGroupedDays={displayGroupedDays}
                              canMoveUp={activityIndex > 0}
                              canMoveDown={activityIndex >= 0 && activityIndex < sortedActivities.length - 1}
                              onToggleCollapse={toggleActivityCollapse}
                              onMoveStart={handleMoveStart}
                              onMoveConfirm={handleMoveConfirm}
                              onMoveCancel={handleMoveCancel}
                              allowUnscheduledTarget={true}
                              onMoveUp={() => handleMoveWithinDay(item.activity.id, day.dayNumber, activityIndex - 1)}
                              onMoveDown={() => handleMoveWithinDay(item.activity.id, day.dayNumber, activityIndex + 1)}
                            />
                          </div>
                        );
                      })()
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
                        <Badge variant="outline" className="h-5 shrink-0 whitespace-nowrap bg-gray-50 text-gray-600 border-gray-200">
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
                        <Badge variant="outline" className="h-5 shrink-0 whitespace-nowrap bg-amber-50 text-amber-700 border-amber-200">
                          {item.timeRange}
                        </Badge>
                      </div>
                    ) : (
                      <div
                        className={`rounded-md border p-2 text-xs ${item.type === "free"
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
                            className={`h-5 shrink-0 whitespace-nowrap ${item.type === "free"
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
            });
          })()}
          {dragInsertion?.dayNumber === day.dayNumber && dragInsertion.index === sortedActivities.length ? (
            <div className="h-0.5 rounded bg-primary/70" />
          ) : null}
        </div>
      </div>
    </>
  );
}
