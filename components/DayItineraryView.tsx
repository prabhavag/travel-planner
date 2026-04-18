import { useState, useEffect, useMemo, useCallback, useRef, type DragEvent } from "react";
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
import { MIN_SCHEDULED_DURATION_RATIO } from "@/lib/utils/timeline-utils";
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
    arrivalAirport?: string | null;
    departureAirport?: string | null;
    arrivalTimePreference?: string | null;
    departureTimePreference?: string | null;
    transportMode?: "flight" | "train" | "car" | "bus" | "ferry" | "other";
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
  onMoveActivity?: (activityId: string, fromDay: number, toDay: number, targetIndex?: number) => void;
  onDayChange?: (dayNumber: number) => void;
}) {
  const ACTIVITY_DRAG_TYPE = "application/x-travel-planner-activity";
  const [movingActivity, setMovingActivity] = useState<{ id: string; fromDay: number } | null>(null);
  const [collapsedActivityCards, setCollapsedActivityCards] = useState<Record<string, boolean>>({});
  const [collapsedRestaurantCards, setCollapsedRestaurantCards] = useState<Record<string, boolean>>({});
  const [commuteByLeg, setCommuteByLeg] = useState<Record<string, { minutes: number; mode: CommuteMode }>>({});
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [draggedActivity, setDraggedActivity] = useState<{ id: string; dayNumber: number; index: number } | null>(null);
  const [dragInsertion, setDragInsertion] = useState<{ dayNumber: number; index: number } | null>(null);
  const draggedActivityRef = useRef<{ id: string; dayNumber: number; index: number } | null>(null);

  type CommuteMode = "TRAIN" | "TRANSIT" | "WALK" | "DRIVE";

  const buildLegId = (dayNumber: number, fromId: string, toId: string) =>
    `${dayNumber}:${fromId}->${toId}`;
  const buildStayStartLegId = (dayNumber: number, toId: string) => `${dayNumber}:stay-start->${toId}`;
  const buildStayEndLegId = (dayNumber: number, fromId: string) => `${dayNumber}:${fromId}->stay-end`;

  const getActivityStartPoint = useCallback((activity: SuggestedActivity) => {
    if (activity.locationMode === "route") {
      return activity.startCoordinates || activity.coordinates || activity.endCoordinates || null;
    }
    return activity.coordinates || activity.startCoordinates || activity.endCoordinates || null;
  }, []);

  const getActivityEndPoint = useCallback((activity: SuggestedActivity) => {
    if (activity.locationMode === "route") {
      return activity.endCoordinates || activity.coordinates || activity.startCoordinates || null;
    }
    return activity.coordinates || activity.endCoordinates || activity.startCoordinates || null;
  }, []);

  const getActivityExitPointToward = useCallback(
    (activity: SuggestedActivity, destination: { lat: number; lng: number } | null | undefined) => {
      const fallback = getActivityEndPoint(activity);
      if (!destination || activity.locationMode !== "route") return fallback;

      const points: Array<{ lat: number; lng: number }> = [];
      const seen = new Set<string>();
      const addPoint = (point: { lat: number; lng: number } | null | undefined) => {
        if (!point) return;
        const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
        if (seen.has(key)) return;
        seen.add(key);
        points.push(point);
      };

      for (const point of activity.routePoints || []) addPoint(point);
      for (const waypoint of activity.routeWaypoints || []) addPoint(waypoint.coordinates);
      addPoint(activity.endCoordinates);
      addPoint(activity.startCoordinates);
      addPoint(activity.coordinates);

      if (points.length === 0) return fallback;

      let best = points[0];
      let bestMinutes = Number.POSITIVE_INFINITY;
      for (const point of points) {
        const minutes = estimateDriveMinutesNoFloor(point, destination);
        if (minutes < bestMinutes) {
          bestMinutes = minutes;
          best = point;
        }
      }
      return best;
    },
    [getActivityEndPoint]
  );

  const isRailFriendlyDestination = useMemo(() => {
    const destination = tripInfo?.destination?.toLowerCase().trim();
    if (!destination) return false;
    return /(switzerland|swiss|europe|europa|austria|germany|france|italy|spain|netherlands|belgium|portugal|czech|hungary|poland|denmark|norway|sweden|finland)/.test(
      destination
    );
  }, [tripInfo?.destination]);

  const commuteLegs = useMemo(() => {
    const legs: Array<{
      id: string;
      origin: { lat: number; lng: number };
      destination: { lat: number; lng: number };
      mode: CommuteMode;
      travelMode: "DRIVE" | "WALK" | "TRANSIT";
    }> = [];
    groupedDays.forEach((day, dayIndex) => {
      const ordered = day.activities;
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const startStayCoordinates = groupedDays[dayIndex - 1]?.nightStay?.coordinates ?? day.nightStay?.coordinates;
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

      ordered.forEach((activity, index) => {
        const next = ordered[index + 1];
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
  }, [groupedDays, isRailFriendlyDestination, getActivityExitPointToward, getActivityStartPoint]);

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
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setRoutingError(`Mapping/routing error while computing commute legs: ${message}`);
      });

    return () => {
      isActive = false;
    };
  }, [commuteLegById, commuteLegsToFetch]);

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
    if (!activeDrag || activeDrag.dayNumber !== dayNumber || !onMoveActivity) return;
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
    const changeDayButton = (
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          handleMoveStart(activity.id, dayNumber);
        }}
        className="h-6 px-2 text-[10px] text-gray-500"
      >
        Change Day
      </Button>
    );
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
        ) : null}
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
          headerActions={changeDayButton}
          extraContent={isMoving ? moveControls : undefined}
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
        headerActions={changeDayButton}
        extraContent={isMoving ? moveControls : undefined}
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

  function recommendedWindowMidpointMinutes(activity: SuggestedActivity): number | null {
    const startMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.start);
    const endMinutes = parseFixedStartTimeMinutes(activity.recommendedStartWindow?.end);
    if (startMinutes == null || endMinutes == null || endMinutes < startMinutes) return null;
    return Math.round((startMinutes + endMinutes) / 2);
  }

  const formatRecommendedStartWindowLabel = (activity: SuggestedActivity): string | null => {
    const window = activity.recommendedStartWindow;
    if (!window?.start || !window?.end) return null;
    return `${window.start}-${window.end}`;
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
    // Fallback only: use conservative speeds and no low hard cap, especially for winding mountain roads.
    const isLongDrive = distanceKm >= 20;
    const speedKph = isLongDrive ? 28 : 32;
    const terrainFactor = isLongDrive ? 1.2 : 1;
    const minutes = Math.round(((distanceKm / speedKph) * 60) * terrainFactor);
    return Math.max(10, minutes);
  }

  function estimateDriveMinutesNoFloor(
    from: { lat: number; lng: number } | null | undefined,
    to: { lat: number; lng: number } | null | undefined,
  ): number {
    const distanceKm = haversineKm(from, to);
    if (distanceKm == null) return 0;
    const isLongDrive = distanceKm >= 20;
    const speedKph = isLongDrive ? 28 : 32;
    const terrainFactor = isLongDrive ? 1.2 : 1;
    return Math.max(0, Math.round(((distanceKm / speedKph) * 60) * terrainFactor));
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
    if (distanceKm <= 10) return "TRANSIT";
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

  const parseClockMinutes = (value?: string | null): number | null => {
    if (!value) return null;
    const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = Number(match[1]) % 12;
    const minute = Number(match[2] || "0");
    if (match[3].toUpperCase() === "PM") hour += 12;
    if (minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  };

  const toClockLabel = (minutes: number): string => {
    const clamped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
  };

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
      const arrivalMinutes = parseClockMinutes(arrivalTiming) ?? 12 * 60;
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

  const formatHourLabel = (hours: number): string => {
    const rounded = Math.round(hours * 10) / 10;
    if (Math.abs(rounded - 1) < 0.01) return "1 hr";
    return `${rounded} hrs`;
  };

  const DayTimeline = ({
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
    const DEPARTURE_TRANSFER_MINUTES_ESTIMATE = 90;
    const startContext = getDayStartContext(dayIndex, startStayLabel);
    const availableVisitHours = startContext.availableVisitHours;
    const isFinalDepartureDay = isDepartureDay(day, dayIndex);
    const lunchHours = 1;
    const sortedActivities = day.activities;
    const totalCommuteMinutesEstimate = sortedActivities.reduce((sum, activity, index) => {
      const next = sortedActivities[index + 1];
      if (!next) return sum;
      const legId = buildLegId(day.dayNumber, activity.id, next.id);
      const fallbackMinutes = estimateCommuteMinutes(
        getActivityExitPointToward(activity, getActivityStartPoint(next)),
        getActivityStartPoint(next)
      );
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
        ? Math.max(20, Math.min(90, Math.round((stayStartCommuteMinutes > 0 ? stayStartCommuteMinutes : 15) + 30)))
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
    const totalCommuteHoursEstimate =
      (totalCommuteMinutesEstimate + stayStartCommuteMinutes + endOfDayCommuteMinutes) / 60;
    const remainingForActivities = Math.max(availableVisitHours - lunchHours - totalCommuteHoursEstimate, 0);
    const totalRequestedHours = day.activities.reduce(
      (sum, activity) => sum + parseEstimatedHours(activity.estimatedDuration),
      0
    );
    const freeActivityHours = Math.max(0, remainingForActivities - totalRequestedHours);
    const earliestFixedStartMinutes = sortedActivities
      .filter((activity) => activity.isFixedStartTime)
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
    const departureClock = tripInfo?.departureTimePreference || "6:00 PM";
    const departureMinutes = parseClockMinutes(departureClock) ?? 18 * 60;
    const airportArrivalLeadMinutes = 120;
    const commuteTransitionBufferMinutes = 20;
    const airportArrivalDeadlineMinutes = Math.max(10 * 60, departureMinutes - airportArrivalLeadMinutes);
    const bufferedEndOfDayCommuteMinutes =
      endOfDayCommuteMinutes > 0 ? Math.round((endOfDayCommuteMinutes + commuteTransitionBufferMinutes) / 15) * 15 : 0;
    const eveningCutoffMinutes = isFinalDepartureDay
      ? Math.max(10 * 60, airportArrivalDeadlineMinutes - bufferedEndOfDayCommuteMinutes)
      : 18 * 60;
    const defaultDayStartMinutes = startContext.dayStartMinutes;
    const recommendedEarlyStartMinutes =
      dayIndex !== 0 && earliestRecommendedMidpointMinutes != null
        ? Math.max(0, Math.round((earliestRecommendedMidpointMinutes - stayStartCommuteMinutes - 15) / 15) * 15)
        : null;
    const dayStartBaselineMinutes =
      recommendedEarlyStartMinutes != null
        ? Math.min(defaultDayStartMinutes, recommendedEarlyStartMinutes)
        : defaultDayStartMinutes;
    const dayStartMinutes =
      dayIndex === 0
        ? dayStartBaselineMinutes
        : earliestFixedStartMinutes != null
          ? Math.max(0, earliestFixedStartMinutes - stayStartCommuteMinutes - 15)
          : dayStartBaselineMinutes;
    const estimatedDayEndMinutes = dayStartMinutes + Math.round((totalRequestedHours + lunchHours + totalCommuteHoursEstimate) * 60);
    const freeHoursBeforeEvening = Math.max(0, (eveningCutoffMinutes - estimatedDayEndMinutes) / 60);
    const effectiveFreeHours = Math.min(freeActivityHours, freeHoursBeforeEvening);
    const showFreeSlotNotice = effectiveFreeHours >= 0.75;

    const timelineRows: Array<{
      label: string;
      detail: string;
      type: "activity" | "commute" | "lunch" | "stay" | "free";
    }> = [];

    if (startContext.startLabel) {
      timelineRows.push({
        label: dayIndex === 0 ? `Arrive at airport (${startContext.arrivalTiming || tripInfo?.arrivalTimePreference || "12:00 PM"})` : startContext.startTitle,
        detail: startContext.startLabel,
        type: "stay",
      });
      if (dayIndex === 0) {
        timelineRows.push({
          label: "Airport transfer",
          detail: `Drive · Approx ${arrivalTransferMinutes} min (estimated)`,
          type: "commute",
        });
        timelineRows.push({
          label: "Hotel check-in",
          detail: day.nightStay?.label || "At your stay",
          type: "stay",
        });
      }
      if (stayStartCommuteMinutes > 0) {
        timelineRows.push({
          label: "Commute to first stop",
          detail: `${commuteModeLabel(stayStartCommuteMode)} · Approx ${stayStartCommuteMinutes} min`,
          type: "commute",
        });
      }
    }

    sortedActivities.forEach((activity, index) => {
      const recommendedHours = parseEstimatedHours(activity.estimatedDuration);
      const requestedHours = recommendedHours;
      const durationIsFlexible = activity.isDurationFlexible !== false;
      const minimumScheduledHours = durationIsFlexible
        ? Math.max(0.75, recommendedHours * MIN_SCHEDULED_DURATION_RATIO)
        : requestedHours;
      const allocatedHours = durationIsFlexible
        ? Math.max(minimumScheduledHours, requestedHours * scaleFactor)
        : requestedHours;
      const recommendedStartWindowLabel = formatRecommendedStartWindowLabel(activity);
      const recommendedStartSuffix =
        !activity.isFixedStartTime && recommendedStartWindowLabel
          ? ` Recommended start: ${recommendedStartWindowLabel}${activity.recommendedStartWindow?.reason ? ` (${activity.recommendedStartWindow.reason})` : ""}.`
          : "";
      const fixedStartMinutes = parseFixedStartTimeMinutes(activity.fixedStartTime);
      const arrivalConflictSuffix =
        dayIndex === 0 && fixedStartMinutes != null && fixedStartMinutes < startContext.dayStartMinutes
          ? ` Arrival conflict: fixed start ${activity.fixedStartTime} is before feasible start on arrival day.`
          : "";

      timelineRows.push({
        label: activity.name,
        detail: `${activity.isFixedStartTime && activity.fixedStartTime ? `Starts at ${activity.fixedStartTime}. ` : ""}Visit up to ${formatHourLabel(allocatedHours)} (${activity.estimatedDuration || "estimated"}).${recommendedStartSuffix}${arrivalConflictSuffix}`,
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
        const fallbackOrigin = getActivityExitPointToward(activity, getActivityStartPoint(next));
        const fallbackMode = pickCommuteMode(fallbackOrigin, getActivityStartPoint(next), isRailFriendlyDestination);
        const fallbackMinutes = estimateCommuteMinutes(fallbackOrigin, getActivityStartPoint(next));
        const commuteMode = commuteByLeg[legId]?.mode ?? fallbackMode;
        const commuteMin = commuteByLeg[legId]?.minutes ?? fallbackMinutes;
        timelineRows.push({
          label: "Commute",
          detail: `${commuteModeLabel(commuteMode)} · Approx ${commuteMin} min`,
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
        detail: freeSlotSuggestion,
        type: "free",
      });
    }

    if (isFinalDepartureDay || endStayLabel) {
      if (endOfDayCommuteMinutes > 0) {
        timelineRows.push({
          label: isFinalDepartureDay ? "Airport transfer" : "Commute to night stay",
          detail: isFinalDepartureDay
            ? `${commuteModeLabel(endOfDayCommuteMode)} · Approx ${endOfDayCommuteMinutes} min (estimated)`
            : `${commuteModeLabel(endOfDayCommuteMode)} · Approx ${endOfDayCommuteMinutes} min`,
          type: "commute",
        });
      }
      timelineRows.push({
        label: isFinalDepartureDay ? "Departure prep" : "End at night stay",
        detail: isFinalDepartureDay
          ? `Checkout${
              tripInfo?.transportMode === "car" ? ", return rental car," : ","
            } then head to ${tripInfo?.departureAirport || "the airport"} for ${departureClock} departure. Target airport arrival by ${toClockLabel(airportArrivalDeadlineMinutes)}. Airport transfer shown above is an estimate.`
          : (endStayLabel || "End at night stay"),
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
              <span>{freeSlotSuggestion}</span>
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
              {groupedDays.map((day, index) => {
                const isFinalDepartureDay = isDepartureDay(day, index);
                return (
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
                        {day.nightStay?.label && !isFinalDepartureDay && (
                          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            <Home className="h-3.5 w-3.5" />
                            Night stay: {day.nightStay.label}
                          </div>
                        )}
                        {day.nightStay?.candidates && day.nightStay.candidates.length > 0 && !isFinalDepartureDay && (
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
                        dayIndex={index}
                        startStayLabel={groupedDays[index - 1]?.nightStay?.label ?? day.nightStay?.label}
                        endStayLabel={isFinalDepartureDay ? null : day.nightStay?.label}
                        startStayCoordinates={groupedDays[index - 1]?.nightStay?.coordinates ?? day.nightStay?.coordinates}
                        endStayCoordinates={isFinalDepartureDay ? null : day.nightStay?.coordinates}
                      />
                      <div
                        className="space-y-1"
                        onDragOver={(event) => handleDayDragOver(event, day.dayNumber, day.activities.length)}
                        onDrop={(event) => handleActivityDrop(event, day.dayNumber, day.activities.length)}
                      >
                        {day.activities.map((activity, index) => {
                          const insertionBefore =
                            dragInsertion?.dayNumber === day.dayNumber && dragInsertion.index === index;
                          const isDragging = draggedActivity?.id === activity.id && draggedActivity.dayNumber === day.dayNumber;
                          return (
                            <div
                              key={`day-${day.dayNumber}-activity-${activity.id}-${index}`}
                              draggable={Boolean(onMoveActivity)}
                              onDragStart={(event) => handleActivityDragStart(event, activity.id, day.dayNumber, index)}
                              onDragOver={(event) => handleActivityDragOver(event, day.dayNumber, index)}
                              onDrop={(event) => handleActivityDrop(event, day.dayNumber, index)}
                              onDragEnd={handleActivityDragEnd}
                              className={`rounded-md select-none ${onMoveActivity ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-50" : ""}`}
                            >
                              {insertionBefore ? <div className="mb-1 h-0.5 rounded bg-primary/70" /> : null}
                              <ActivityItem
                                activity={activity}
                                dayNumber={day.dayNumber}
                                index={index}
                              />
                            </div>
                          );
                        })}
                        {dragInsertion?.dayNumber === day.dayNumber && dragInsertion.index === day.activities.length ? (
                          <div className="h-0.5 rounded bg-primary/70" />
                        ) : null}
                        {day.restaurants.map((restaurant, index) => (
                          <RestaurantItem
                            key={`day-${day.dayNumber}-restaurant-${restaurant.id}-${index}`}
                            restaurant={restaurant}
                          />
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
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
