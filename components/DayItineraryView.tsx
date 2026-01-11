"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Star,
  MapPin,
  Utensils,
  ExternalLink,
} from "lucide-react";
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

export function DayItineraryView({ groupedDays, tripInfo }: DayItineraryViewProps) {
  const [expandedDays, setExpandedDays] = useState<Set<number>>(
    new Set(groupedDays.map((d) => d.dayNumber))
  );

  const toggleDay = (dayNumber: number) => {
    const newExpanded = new Set(expandedDays);
    if (newExpanded.has(dayNumber)) {
      newExpanded.delete(dayNumber);
    } else {
      newExpanded.add(dayNumber);
    }
    setExpandedDays(newExpanded);
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

  const ActivityItem = ({ activity, index, dayNumber }: { activity: SuggestedActivity, index: number, dayNumber: number }) => (
    <div
      className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border-l-4"
      style={{ borderLeftColor: getDayColor(dayNumber) }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-400 font-mono text-xs">#{index + 1}</span>
          <h4 className="font-medium text-sm">{activity.name}</h4>
          <Badge variant="secondary" className={`${getActivityTypeColor(activity.type)} text-xs`}>
            {activity.type}
          </Badge>
        </div>
        <p className="text-sm text-gray-600 mt-1 line-clamp-2">{activity.description}</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{activity.estimatedDuration}</span>
          </div>
          {activity.estimatedCost != null && activity.estimatedCost > 0 && (
            <div className="flex items-center gap-1">
              <span>{formatCost(activity.estimatedCost, activity.currency)}</span>
            </div>
          )}
          {activity.estimatedCost === 0 && (
            <span className="text-green-600">Free</span>
          )}
          {activity.rating && (
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              <span>{activity.rating.toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => openInMaps(activity)}
        className="flex-shrink-0"
      >
        <ExternalLink className="w-4 h-4" />
      </Button>
    </div>
  );

  const RestaurantItem = ({ restaurant }: { restaurant: RestaurantSuggestion }) => (
    <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
      <Utensils className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-medium text-sm">{restaurant.name}</h4>
          {restaurant.cuisine && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
              {restaurant.cuisine}
            </Badge>
          )}
          {restaurant.priceRange && (
            <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">
              {restaurant.priceRange}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          {restaurant.rating && (
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              <span>{restaurant.rating.toFixed(1)}</span>
            </div>
          )}
          {restaurant.vicinity && (
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span className="truncate max-w-[150px]">{restaurant.vicinity}</span>
            </div>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => openRestaurantInMaps(restaurant)}
        className="flex-shrink-0"
      >
        <ExternalLink className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Trip summary header */}
      {tripInfo && tripInfo.destination && (
        <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
          <h2 className="text-lg font-semibold text-primary">{tripInfo.destination}</h2>
          {tripInfo.startDate && tripInfo.endDate && (
            <p className="text-sm text-gray-600 mt-1">
              {formatDate(tripInfo.startDate)} — {formatDate(tripInfo.endDate)}
            </p>
          )}
          <p className="text-sm text-gray-500 mt-1">
            {groupedDays.length} days • {groupedDays.reduce((sum, d) => sum + d.activities.length, 0)} activities
            {groupedDays.reduce((sum, d) => sum + d.restaurants.length, 0) > 0 &&
              ` • ${groupedDays.reduce((sum, d) => sum + d.restaurants.length, 0)} restaurants`}
          </p>
        </div>
      )}

      {/* Day cards */}
      {groupedDays.map((day) => {
        const isExpanded = expandedDays.has(day.dayNumber);
        return (
          <Card key={day.dayNumber} className="overflow-hidden">
            <CardHeader
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => toggleDay(day.dayNumber)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`${getDayBadgeColors(day.dayNumber)} rounded-full w-8 h-8 flex items-center justify-center font-semibold`}>
                    {day.dayNumber}
                  </div>
                  <div>
                    <CardTitle className="text-base">{day.theme}</CardTitle>
                    <p className="text-sm text-gray-500">{formatDate(day.date)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {day.activities.length} activities
                  </Badge>
                  {day.restaurants.length > 0 && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
                      {day.restaurants.length} restaurants
                    </Badge>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>
            </CardHeader>
            {isExpanded && (
              <CardContent className="pt-0 space-y-3">
                {day.activities.map((activity, index) => (
                  <ActivityItem key={activity.id} activity={activity} index={index} dayNumber={day.dayNumber} />
                ))}
                {day.restaurants.length > 0 && (
                  <>
                    <div className="border-t pt-3 mt-3">
                      <h4 className="text-sm font-medium text-amber-700 mb-2 flex items-center gap-2">
                        <Utensils className="w-4 h-4" /> Restaurants
                      </h4>
                    </div>
                    {day.restaurants.map((restaurant) => (
                      <RestaurantItem key={restaurant.id} restaurant={restaurant} />
                    ))}
                  </>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
