import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, MapPin, Utensils, ExternalLink, Clock, Star, Plane, Building2, Home, AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { computeRoutes } from "@/lib/api-client";
import type {
  GroupedDay,
  SuggestedActivity,
  RestaurantSuggestion,
  AccommodationOption,
  FlightOption,
} from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";
import { ActivityCard } from "@/components/ActivityCard";
import { ResearchOptionCard } from "@/components/ResearchOptionCard";

interface DayItineraryViewProps {
  groupedDays: GroupedDay[];
  selectedAccommodation?: AccommodationOption | null;
  selectedFlight?: FlightOption | null;
  tripInfo?: {
    destination: string | null;
    startDate: string | null;
    endDate: string | null;
    durationDays: number | null;
  };
}

export function DayItineraryView({
  groupedDays,
  selectedAccommodation,
  selectedFlight,
  tripInfo,
  onActivityHover,
  onMoveActivity,
  onDayChange,
}: DayItineraryViewProps & {
  onActivityHover?: (id: string | null) => void;
  onMoveActivity?: (activityId: string, fromDay: number, toDay: number) => void;
  onDayChange?: (dayNumber: number) => void;
}) {
  const [movingActivity, setMovingActivity] = useState<{ id: string; fromDay: number } | null>(null);
  const [collapsedActivityCards, setCollapsedActivityCards] = useState<Record<string, boolean>>({});
  const [collapsedRestaurantCards, setCollapsedRestaurantCards] = useState<Record<string, boolean>>({});
  const [commuteMinutesByLeg, setCommuteMinutesByLeg] = useState<Record<string, number>>({});

  const buildLegId = (dayNumber: number, fromId: string, toId: string) =>
    `${dayNumber}:${fromId}->${toId}`;

  const sortActivitiesForTimeline = useCallback((activities: SuggestedActivity[]) => {
    const score: Record<SuggestedActivity["bestTimeOfDay"], number> = {
      morning: 0,
      afternoon: 1,
      evening: 2,
      any: 3,
    };
    return [...activities].sort((a, b) => score[a.bestTimeOfDay] - score[b.bestTimeOfDay]);
  }, []);

  const commuteLegs = useMemo(() => {
    const legs: Array<{
      id: string;
      origin: { lat: number; lng: number };
      destination: { lat: number; lng: number };
    }> = [];
    groupedDays.forEach((day) => {
      const sorted = sortActivitiesForTimeline(day.activities);
      sorted.forEach((activity, index) => {
        const next = sorted[index + 1];
        if (!next?.coordinates || !activity.coordinates) return;
        legs.push({
          id: buildLegId(day.dayNumber, activity.id, next.id),
          origin: activity.coordinates,
          destination: next.coordinates,
        });
      });
    });
    return legs;
  }, [groupedDays, sortActivitiesForTimeline]);

  const commuteLegsToFetch = useMemo(
    () => commuteLegs.filter((leg) => commuteMinutesByLeg[leg.id] == null),
    [commuteLegs, commuteMinutesByLeg]
  );

  useEffect(() => {
    if (commuteLegsToFetch.length === 0) return;
    let isActive = true;
    computeRoutes(commuteLegsToFetch)
      .then((result) => {
        if (!isActive || !result?.legs) return;
        const updates: Record<string, number> = {};
        result.legs.forEach((leg) => {
          if (leg.durationSeconds != null) {
            updates[leg.id] = Math.max(5, Math.round(leg.durationSeconds / 60));
          }
        });
        if (Object.keys(updates).length > 0) {
          setCommuteMinutesByLeg((prev) => ({ ...prev, ...updates }));
        }
      })
      .catch(() => {
        // Ignore route API failures and fall back to local estimates.
      });

    return () => {
      isActive = false;
    };
  }, [commuteLegsToFetch]);

  useEffect(() => {
    const nextCollapsedActivities: Record<string, boolean> = {};
    const nextCollapsedRestaurants: Record<string, boolean> = {};
    for (const day of groupedDays) {
      for (const activity of day.activities) {
        nextCollapsedActivities[activity.id] = true;
      }
      for (const restaurant of day.restaurants) {
        nextCollapsedRestaurants[restaurant.id] = true;
      }
    }
    setCollapsedActivityCards(nextCollapsedActivities);
    setCollapsedRestaurantCards(nextCollapsedRestaurants);
    if (groupedDays[0]?.dayNumber) onDayChange?.(groupedDays[0].dayNumber);
  }, [groupedDays, onDayChange]);

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const openRestaurantInMaps = (restaurant: RestaurantSuggestion) => {
    if (restaurant.coordinates) {
      const { lat, lng } = restaurant.coordinates;
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${restaurant.place_id || ""}`,
        "_blank"
      );
    }
  };

  const handleMoveStart = (activityId: string, fromDay: number) => {
    setMovingActivity({ id: activityId, fromDay });
  };

  const handleMoveConfirm = (toDay: number) => {
    if (movingActivity && movingActivity.fromDay !== toDay && onMoveActivity) {
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

  const toggleRestaurantCollapse = (restaurantId: string) => {
    setCollapsedRestaurantCards((prev) => ({
      ...prev,
      [restaurantId]: !prev[restaurantId],
    }));
  };

  const areAllCardsCollapsedForDay = (day: GroupedDay) => {
    const activityCollapsed = day.activities.every((activity) => collapsedActivityCards[activity.id]);
    const restaurantCollapsed = day.restaurants.every((restaurant) => collapsedRestaurantCards[restaurant.id]);
    return activityCollapsed && restaurantCollapsed;
  };

  const toggleDayCardsCollapse = (day: GroupedDay) => {
    const shouldCollapse = !areAllCardsCollapsedForDay(day);
    setCollapsedActivityCards((prev) => {
      const next = { ...prev };
      for (const activity of day.activities) {
        next[activity.id] = shouldCollapse;
      }
      return next;
    });
    setCollapsedRestaurantCards((prev) => {
      const next = { ...prev };
      for (const restaurant of day.restaurants) {
        next[restaurant.id] = shouldCollapse;
      }
      return next;
    });
  };

  const ActivityItem = ({
    activity,
    dayNumber,
    index,
  }: {
    activity: SuggestedActivity;
    dayNumber: number;
    index: number;
  }) => {
    const isMoving = movingActivity?.id === activity.id;
    const isCollapsed = collapsedActivityCards[activity.id] || false;
    const moveControls = (
      <div className="pt-3 mt-3 border-t border-gray-50" onClick={(e) => e.stopPropagation()}>
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
        onHoverActivity={onActivityHover}
        collapsed={isCollapsed}
        onToggleCollapse={() => toggleActivityCollapse(activity.id)}
        extraContent={moveControls}
      />
    );
  };

  const RestaurantItem = ({ restaurant }: { restaurant: RestaurantSuggestion }) => {
    const isCollapsed = collapsedRestaurantCards[restaurant.id] || false;
    const locationText = restaurant.formatted_address || restaurant.vicinity;
    return (
      <div className="p-4 rounded-xl border border-amber-100 bg-amber-50/20 mb-3 hover:shadow-sm transition-all">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-[10px] h-5">
                Restaurant
              </Badge>
            </div>
            <h4 className="text-sm font-bold text-gray-900 line-clamp-1 flex items-center gap-2">
              <Utensils className="w-3.5 h-3.5 text-amber-600" />
              {restaurant.name}
            </h4>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleRestaurantCollapse(restaurant.id)}
              className="h-7 w-7 text-gray-400 hover:text-amber-600 shrink-0"
              title={isCollapsed ? "Expand card" : "Collapse card"}
            >
              {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openRestaurantInMaps(restaurant)}
              className="h-7 w-7 text-gray-400 hover:text-amber-600 shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {!isCollapsed && (
          <>
            {restaurant.photo_url && (
              <div className="mb-2 overflow-hidden rounded-md border border-amber-100 bg-amber-50">
                <img
                  src={restaurant.photo_url}
                  alt={restaurant.name}
                  className="h-28 w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 mb-2">
              {restaurant.cuisine && (
                <Badge variant="outline" className="text-[9px] h-4 py-0">
                  {restaurant.cuisine}
                </Badge>
              )}
              {restaurant.priceRange && (
                <Badge
                  variant="outline"
                  className="text-[9px] h-4 py-0 text-green-700 border-green-200 bg-green-50"
                >
                  {restaurant.priceRange}
                </Badge>
              )}
              {restaurant.rating && (
                <Badge variant="outline" className="text-[9px] h-4 py-0 text-amber-700 border-amber-200 bg-amber-50">
                  <Star className="w-2.5 h-2.5 mr-1 fill-amber-500 text-amber-500" />
                  {restaurant.rating.toFixed(1)}
                  {typeof restaurant.user_ratings_total === "number" && restaurant.user_ratings_total > 0
                    ? ` (${restaurant.user_ratings_total})`
                    : ""}
                </Badge>
              )}
            </div>

            {locationText && (
              <div className="flex items-start gap-1.5 text-[10px] text-gray-500">
                <MapPin className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
                <span className="line-clamp-1">{locationText}</span>
              </div>
            )}

            {restaurant.opening_hours && (
              <div className="mt-1 flex items-start gap-1.5 text-[10px] text-gray-500">
                <Clock className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
                <span className="line-clamp-1">{restaurant.opening_hours}</span>
              </div>
            )}
          </>
        )}
      </div>
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
    if (/meal|restaurant|lunch|dinner|breakfast/.test(text)) return 1.25;
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

  const getCommutePoint = useCallback((activity: SuggestedActivity) => {
    if (activity.locationMode === "route") {
      return activity.startCoordinates || activity.endCoordinates || activity.coordinates || null;
    }
    return activity.coordinates || activity.startCoordinates || activity.endCoordinates || null;
  }, []);

  const formatHourLabel = (hours: number): string => {
    const rounded = Math.round(hours * 10) / 10;
    if (Math.abs(rounded - 1) < 0.01) return "1 hr";
    return `${rounded} hrs`;
  };

  const DayTimeline = ({
    day,
    startStayLabel,
    endStayLabel,
    startStayCoordinates,
    endStayCoordinates,
  }: {
    day: GroupedDay;
    startStayLabel?: string | null;
    endStayLabel?: string | null;
    startStayCoordinates?: { lat: number; lng: number } | null;
    endStayCoordinates?: { lat: number; lng: number } | null;
  }) => {
    const availableVisitHours = 8;
    const lunchHours = 1;
    const sortedActivities = sortActivitiesForTimeline(day.activities);
    const totalCommuteMinutesEstimate = sortedActivities.reduce((sum, activity, index) => {
      const next = sortedActivities[index + 1];
      if (!next) return sum;
      const legId = buildLegId(day.dayNumber, activity.id, next.id);
      const commuteMinutes =
        commuteMinutesByLeg[legId] ?? estimateCommuteMinutes(getCommutePoint(activity), getCommutePoint(next));
      return sum + commuteMinutes;
    }, 0);
    const firstActivity = sortedActivities[0];
    const lastActivity = sortedActivities[sortedActivities.length - 1];
    const stayStartCommuteMinutes =
      startStayLabel && firstActivity && startStayCoordinates
        ? estimateCommuteMinutes(startStayCoordinates, getCommutePoint(firstActivity))
        : 0;
    const stayEndCommuteMinutes =
      endStayLabel && lastActivity && endStayCoordinates
        ? estimateCommuteMinutes(getCommutePoint(lastActivity), endStayCoordinates)
        : 0;
    const totalCommuteHoursEstimate =
      (totalCommuteMinutesEstimate + stayStartCommuteMinutes + stayEndCommuteMinutes) / 60;
    const remainingForActivities = Math.max(availableVisitHours - lunchHours - totalCommuteHoursEstimate, 0);
    const totalRequestedHours = day.activities.reduce((sum, activity) => sum + parseEstimatedHours(activity.estimatedDuration), 0);
    const freeActivityHours = Math.max(0, remainingForActivities - totalRequestedHours);
    const showFreeSlotNotice = freeActivityHours >= 0.75;
    const scaleFactor =
      totalRequestedHours > 0 && totalRequestedHours > remainingForActivities && remainingForActivities > 0
        ? remainingForActivities / totalRequestedHours
        : 1;

    const timelineRows: Array<{
      label: string;
      detail: string;
      type: "activity" | "commute" | "lunch" | "stay" | "free";
    }> = [];

    if (startStayLabel) {
      timelineRows.push({
        label: "Start from stay",
        detail: startStayLabel,
        type: "stay",
      });
      if (stayStartCommuteMinutes > 0) {
        timelineRows.push({
          label: "Commute to first stop",
          detail: `Approx ${stayStartCommuteMinutes} min`,
          type: "commute",
        });
      }
    }

    sortedActivities.forEach((activity, index) => {
      const requestedHours = parseEstimatedHours(activity.estimatedDuration);
      const allocatedHours = Math.max(0.75, requestedHours * scaleFactor);

      timelineRows.push({
        label: activity.name,
        detail: `Visit up to ${formatHourLabel(allocatedHours)} (${activity.estimatedDuration || "estimated"})`,
        type: "activity",
      });

      if (index === 0) {
        timelineRows.push({
          label: "Lunch break",
          detail: "Reserve about 1 hr around midday",
          type: "lunch",
        });
      }

      const next = sortedActivities[index + 1];
      if (next) {
        const legId = buildLegId(day.dayNumber, activity.id, next.id);
        const commuteMin =
          commuteMinutesByLeg[legId] ?? estimateCommuteMinutes(activity.coordinates, next.coordinates);
        timelineRows.push({
          label: "Commute",
          detail: `Approx ${commuteMin} min`,
          type: "commute",
        });
      }
    });

    if (timelineRows.length === 0) {
      timelineRows.push(
        {
          label: "Lunch break",
          detail: "Reserve about 1 hr around midday",
          type: "lunch",
        },
        {
          label: "Explore nearby",
          detail: "Keep 2-3 flexible hours for local discoveries",
          type: "activity",
        },
      );
    }

    if (showFreeSlotNotice) {
      timelineRows.push({
        label: "Free slot",
        detail: "A slot is free, consider adding or moving an activity.",
        type: "free",
      });
    }

    if (endStayLabel) {
      if (stayEndCommuteMinutes > 0) {
        timelineRows.push({
          label: "Commute to night stay",
          detail: `Approx ${stayEndCommuteMinutes} min`,
          type: "commute",
        });
      }
      timelineRows.push({
        label: "End at night stay",
        detail: endStayLabel,
        type: "stay",
      });
    }

    return (
      <div className="rounded-lg border border-sky-100 bg-sky-50/50 p-3 mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-sky-800">Timeline (Approximate)</h4>
          <span className="text-[10px] text-sky-700">
            {formatHourLabel(availableVisitHours)} day budget
          </span>
        </div>
        {showFreeSlotNotice ? (
          <div className="mb-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-2 py-1 text-[10px] text-emerald-900">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>A slot is free, consider adding or moving an activity.</span>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          {timelineRows.map((row, index) => {
            const badgeClass =
              row.type === "activity"
                ? "bg-white text-sky-700 border-sky-200"
                : row.type === "lunch"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : row.type === "free"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : row.type === "stay"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-gray-50 text-gray-600 border-gray-200";

            return (
              <div key={`${row.label}-${index}`} className="flex items-start gap-2 text-xs">
                <Badge variant="outline" className={`shrink-0 h-5 ${badgeClass}`}>
                  {row.type === "activity"
                    ? "Stop"
                    : row.type === "lunch"
                      ? "Lunch"
                      : row.type === "stay"
                        ? "Stay"
                        : row.type === "free"
                          ? "Free"
                          : "Commute"}
                </Badge>
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 line-clamp-1">{row.label}</p>
                  <p className="text-gray-500">{row.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      {tripInfo && tripInfo.destination && (
        <div className="bg-primary/5 rounded-2xl p-6 border border-primary/20 shrink-0">
          <h2 className="text-2xl font-bold text-gray-900">{tripInfo.destination}</h2>
          {tripInfo.startDate && tripInfo.endDate && (
            <p className="text-sm font-medium text-gray-600 mt-1 uppercase tracking-wider">
              {formatDate(tripInfo.startDate)} - {formatDate(tripInfo.endDate)}
            </p>
          )}
          <div className="flex items-center gap-3 mt-4">
            <Badge variant="secondary" className="bg-white text-primary border-primary/20">
              {groupedDays.length} Days
            </Badge>
            <Badge variant="secondary" className="bg-white text-primary border-primary/20">
              {groupedDays.reduce((acc, day) => acc + day.activities.length + day.restaurants.length, 0)} Stops
            </Badge>
          </div>
        </div>
      )}

      {(selectedAccommodation || selectedFlight) && (
        <div className="grid gap-3 md:grid-cols-2 shrink-0">
          {selectedAccommodation && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 uppercase tracking-wider">
                <Building2 className="h-4 w-4" />
                Selected Hotel
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{selectedAccommodation.name}</p>
              <p className="text-xs text-gray-600">{selectedAccommodation.neighborhood || "Area not specified"}</p>
              <p className="mt-1 text-xs text-gray-700">
                {selectedAccommodation.nightlyPriceEstimate != null
                  ? `${selectedAccommodation.currency} ${selectedAccommodation.nightlyPriceEstimate}/night`
                  : "Price unavailable"}
              </p>
            </div>
          )}
          {selectedFlight && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 uppercase tracking-wider">
                <Plane className="h-4 w-4" />
                Selected Flight
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{selectedFlight.airline}</p>
              <p className="text-xs text-gray-600">{selectedFlight.routeSummary}</p>
              <p className="mt-1 text-xs text-gray-700">
                {selectedFlight.totalPriceEstimate != null
                  ? `${selectedFlight.currency} ${selectedFlight.totalPriceEstimate}`
                  : "Price unavailable"}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-4 shrink-0 px-2">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Daily Itinerary</h3>
          {groupedDays.length > 0 ? <span className="text-xs text-gray-500">All days (collapsed by default)</span> : null}
        </div>

        {groupedDays.length > 0 ? (
          <ScrollArea className="flex-1 min-h-0 px-2">
            <div className="space-y-4 pb-6">
              {groupedDays.map((day, index) => (
                <Card key={day.dayNumber} className="border-t-4 flex flex-col" style={{ borderTopColor: getDayColor(day.dayNumber) }}>
                  <CardHeader className="pb-3 shrink-0">
                    <div className="flex items-center justify-between gap-3">
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleDayCardsCollapse(day)}
                        className="shrink-0"
                      >
                        {areAllCardsCollapsedForDay(day) ? (
                          <>
                            Expand <ChevronDown className="w-4 h-4 ml-1" />
                          </>
                        ) : (
                          <>
                            Collapse <ChevronUp className="w-4 h-4 ml-1" />
                          </>
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="px-4 pb-6">
                      <DayTimeline
                        day={day}
                        startStayLabel={groupedDays[index - 1]?.nightStay?.label ?? day.nightStay?.label}
                        endStayLabel={day.nightStay?.label}
                        startStayCoordinates={groupedDays[index - 1]?.nightStay?.coordinates ?? day.nightStay?.coordinates}
                        endStayCoordinates={day.nightStay?.coordinates}
                      />
                      <div className="space-y-1">
                        {day.activities.map((activity, index) => (
                          <ActivityItem
                            key={activity.id}
                            activity={activity}
                            dayNumber={day.dayNumber}
                            index={index}
                          />
                        ))}
                        {day.restaurants.map((restaurant) => (
                          <RestaurantItem key={restaurant.id} restaurant={restaurant} />
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="w-full py-12 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed mx-2">
            <MapPin className="w-8 h-8 mb-2 opacity-20" />
            <p>No activities planned yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
