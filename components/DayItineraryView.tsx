"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Clock,
  Star,
  MapPin,
  Utensils,
  ExternalLink,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GroupedDay, SuggestedActivity, RestaurantSuggestion } from "@/lib/api-client";
import { formatCost } from "@/lib/utils/currency";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";

interface DayItineraryViewProps {
  groupedDays: GroupedDay[];
  tripInfo?: {
    destination: string | null;
    startDate: string | null;
    endDate: string | null;
    durationDays: number | null;
  };
}

export function DayItineraryView({ groupedDays, tripInfo, onActivityHover, onMoveActivity }: DayItineraryViewProps & { onActivityHover?: (id: string | null) => void, onMoveActivity?: (activityId: string, fromDay: number, toDay: number) => void }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [movingActivity, setMovingActivity] = useState<{ id: string; fromDay: number } | null>(null);

  // Flatten all activities and restaurants into a single list with metadata
  const carouselItems = groupedDays.flatMap(day => [
    ...day.activities.map(activity => ({ type: 'activity' as const, data: activity, dayNumber: day.dayNumber, dayTheme: day.theme })),
    ...day.restaurants.map(restaurant => ({ type: 'restaurant' as const, data: restaurant, dayNumber: day.dayNumber, dayTheme: day.theme }))
  ]);

  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = scrollContainerRef.current.clientWidth;
      const currentScroll = scrollContainerRef.current.scrollLeft;
      scrollContainerRef.current.scrollTo({
        left: direction === "left" ? currentScroll - scrollAmount : currentScroll + scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const getActivityTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      museum: "bg-purple-100 text-purple-800",
      landmark: "bg-blue-100 text-blue-800",
      park: "bg-green-100 text-green-800",
      viewpoint: "bg-cyan-100 text-cyan-800",
      market: "bg-orange-100 text-orange-800",
      experience: "bg-pink-100 text-pink-800",
      neighborhood: "bg-yellow-100 text-yellow-800",
      beach: "bg-teal-100 text-teal-800",
      temple: "bg-red-100 text-red-800",
      gallery: "bg-indigo-100 text-indigo-800",
    };
    return colors[type.toLowerCase()] || "bg-gray-100 text-gray-800";
  };

  const openInMaps = (activity: SuggestedActivity) => {
    if (activity.coordinates) {
      const { lat, lng } = activity.coordinates;
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${activity.place_id || ""}`,
        "_blank"
      );
    } else {
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.name)}`,
        "_blank"
      );
    }
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

  const ActivityCard = ({ activity, dayNumber, dayTheme }: { activity: SuggestedActivity, dayNumber: number, dayTheme: string }) => {
    const isMoving = movingActivity?.id === activity.id;
    return (
      <Card
        className={`w-full min-w-full flex-shrink-0 snap-center transition-all duration-200 border-t-4 hover:shadow-md ${isMoving ? "ring-2 ring-primary bg-blue-50/30" : ""}`}
        style={{ borderTopColor: getDayColor(dayNumber) }}
        onMouseEnter={() => onActivityHover?.(activity.id)}
        onMouseLeave={() => onActivityHover?.(null)}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge className={`${getDayBadgeColors(dayNumber)} h-5 px-1.5`}>Day {dayNumber}</Badge>
                <Badge variant="secondary" className={`${getActivityTypeColor(activity.type)} text-[10px] h-5`}>
                  {activity.type}
                </Badge>
              </div>
              <CardTitle className="text-base line-clamp-1">{activity.name}</CardTitle>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openInMaps(activity)}
                className="h-8 w-8 text-gray-400 hover:text-primary"
                title="Open in Maps"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600 line-clamp-3 min-h-[60px]">{activity.description}</p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 pt-1">
            <div className="flex items-center gap-1.5 font-medium text-gray-700">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span>{activity.estimatedDuration}</span>
            </div>
            {activity.rating && (
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                <span className="font-medium text-gray-700">{activity.rating.toFixed(1)}</span>
              </div>
            )}
            {activity.estimatedCost != null && (
              <div className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                {activity.estimatedCost === 0 ? "Free" : formatCost(activity.estimatedCost, activity.currency)}
              </div>
            )}
          </div>

          <div className="pt-2 border-t">
            {isMoving ? (
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <Select onValueChange={(val) => handleMoveConfirm(parseInt(val))}>
                  <SelectTrigger className="flex-1 h-9 text-xs">
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
                <Button variant="outline" size="sm" onClick={handleMoveCancel} className="h-9 px-3">
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoveStart(activity.id, dayNumber);
                }}
                className="w-full h-9 text-xs font-medium text-gray-600 hover:text-primary hover:border-primary transition-colors"
                title="Move this activity to another day"
              >
                Change Day
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const RestaurantCard = ({ restaurant, dayNumber }: { restaurant: RestaurantSuggestion, dayNumber: number }) => (
    <Card
      className="w-full min-w-full flex-shrink-0 snap-center border-t-4 border-amber-400 bg-amber-50/20"
      onMouseEnter={() => onActivityHover?.(restaurant.id)}
      onMouseLeave={() => onActivityHover?.(null)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`${getDayBadgeColors(dayNumber)} h-5 px-1.5`}>Day {dayNumber}</Badge>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-[10px] h-5">
                Restaurant
              </Badge>
            </div>
            <CardTitle className="text-base line-clamp-1 flex items-center gap-2">
              <Utensils className="w-4 h-4 text-amber-600" />
              {restaurant.name}
            </CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openRestaurantInMaps(restaurant)}
            className="h-8 w-8 text-gray-400 hover:text-amber-600"
          >
            <ExternalLink className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {restaurant.cuisine && (
            <Badge variant="outline" className="text-[10px] h-5">{restaurant.cuisine}</Badge>
          )}
          {restaurant.priceRange && (
            <Badge variant="outline" className="text-[10px] h-5 text-green-700 border-green-200 bg-green-50">{restaurant.priceRange}</Badge>
          )}
        </div>

        {restaurant.vicinity && (
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
            <span className="line-clamp-2">{restaurant.vicinity}</span>
          </div>
        )}

        {restaurant.rating && (
          <div className="flex items-center gap-1 pt-1">
            <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
            <span className="text-xs font-medium text-gray-700">{restaurant.rating.toFixed(1)} rating</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Trip summary header */}
      {tripInfo && tripInfo.destination && (
        <div className="bg-primary/5 rounded-2xl p-6 border border-primary/20">
          <h2 className="text-2xl font-bold text-gray-900">{tripInfo.destination}</h2>
          {tripInfo.startDate && tripInfo.endDate && (
            <p className="text-sm font-medium text-gray-600 mt-1 uppercase tracking-wider">
              {formatDate(tripInfo.startDate)} — {formatDate(tripInfo.endDate)}
            </p>
          )}
          <div className="flex items-center gap-3 mt-4">
            <Badge variant="secondary" className="bg-white text-primary border-primary/20">
              {groupedDays.length} Days
            </Badge>
            <Badge variant="secondary" className="bg-white text-primary border-primary/20">
              {carouselItems.length} Stops
            </Badge>
          </div>
        </div>
      )}

      <div className="relative group overflow-hidden">
        {/* Navigation buttons */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Plan Highlights</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => scroll("left")} className="rounded-full h-8 w-8 hover:bg-primary hover:text-white transition-all shadow-sm">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => scroll("right")} className="rounded-full h-8 w-8 hover:bg-primary hover:text-white transition-all shadow-sm">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Flat activity carousel */}
        <div
          ref={scrollContainerRef}
          className="flex overflow-x-auto pb-6 snap-x snap-mandatory scrollbar-none"
          style={{ scrollBehavior: 'smooth' }}
        >
          {carouselItems.map((item, idx) => (
            <div key={`${item.type}-${item.data.id}-${idx}`} className="w-full flex-shrink-0 snap-center">
              {item.type === 'activity' ? (
                <ActivityCard activity={item.data} dayNumber={item.dayNumber} dayTheme={item.dayTheme} />
              ) : (
                <RestaurantCard restaurant={item.data} dayNumber={item.dayNumber} />
              )}
            </div>
          ))}
          {carouselItems.length === 0 && (
            <div className="w-full py-12 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed">
              <MapPin className="w-8 h-8 mb-2 opacity-20" />
              <p>No activities planned yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
