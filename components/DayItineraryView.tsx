import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, MapPin, Utensils, ExternalLink, Clock, Star, Plane, Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
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
              {groupedDays.map((day) => (
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
