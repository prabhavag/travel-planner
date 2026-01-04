"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Clock, DollarSign, Star, MapPin, Lightbulb } from "lucide-react";
import type { FinalPlan, Meal, Activity } from "@/lib/api-client";

interface DetailedItineraryViewProps {
  itinerary: FinalPlan["itinerary"];
}

export default function DetailedItineraryView({ itinerary }: DetailedItineraryViewProps) {
  const getGoogleMapsUrl = (coords: { lat: number; lng: number } | undefined) => {
    if (!coords?.lat || !coords?.lng) return null;
    return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
  };

  const openLink = (url: string | null) => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const getTimeSlotColor = (slot: string) => {
    switch (slot) {
      case "morning":
        return "bg-orange-400";
      case "afternoon":
        return "bg-orange-500";
      case "evening":
        return "bg-indigo-500";
      default:
        return "bg-blue-500";
    }
  };

  const getMealColor = (mealType: string) => {
    switch (mealType) {
      case "breakfast":
        return "bg-amber-600";
      case "lunch":
        return "bg-green-500";
      case "dinner":
        return "bg-purple-500";
      default:
        return "bg-blue-500";
    }
  };

  const renderMeal = (meal: Meal | undefined, mealType: string) => {
    if (!meal || !meal.name) return null;
    const mapsUrl = getGoogleMapsUrl(meal.coordinates);

    return (
      <div className="mb-4">
        <Badge className={`${getMealColor(mealType)} text-white mb-2`}>
          {mealType.charAt(0).toUpperCase() + mealType.slice(1)}
        </Badge>

        <div className="pl-3">
          <h4 className="text-base font-bold text-gray-800 mb-1">{meal.name}</h4>

          {meal.timeSlot && (
            <p className="text-sm text-blue-600 mb-1.5">{meal.timeSlot}</p>
          )}

          {meal.description && (
            <p className="text-sm text-gray-600 leading-5 mb-2">{meal.description}</p>
          )}

          <div className="flex flex-wrap gap-2 mb-2">
            {meal.cuisine && (
              <Badge variant="secondary" className="text-xs">
                {meal.cuisine}
              </Badge>
            )}
            {meal.estimatedCost != null && (
              <Badge variant="secondary" className="text-xs">
                <DollarSign className="w-3 h-3 mr-1" />
                {meal.estimatedCost}
              </Badge>
            )}
            {meal.rating && (
              <Badge variant="secondary" className="text-xs">
                <Star className="w-3 h-3 mr-1" />
                {meal.rating}
              </Badge>
            )}
          </div>

          {mapsUrl && (
            <Button
              size="sm"
              onClick={() => openLink(mapsUrl)}
              className="rounded-full text-xs"
            >
              <MapPin className="w-3 h-3 mr-1" />
              View on Maps
            </Button>
          )}
        </div>
      </div>
    );
  };

  if (!itinerary || itinerary.length === 0) {
    return null;
  }

  return (
    <div className="p-4 bg-gray-100">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Your Finalized Itinerary</h2>
      <p className="text-sm text-gray-500 mb-5">
        Click on &quot;View on Maps&quot; to open locations in Google Maps
      </p>

      <div className="space-y-5">
        {itinerary.map((day, dayIdx) => (
          <Card key={dayIdx}>
            <CardContent className="p-4">
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200">
                <h3 className="text-xl font-bold text-blue-600">Day {day.day_number || day.dayNumber}</h3>
                <span className="text-sm text-gray-500">{day.date}</span>
              </div>

              {/* Breakfast */}
              {renderMeal(day.breakfast, "breakfast")}

              {/* Time slots */}
              {(["morning", "afternoon", "evening"] as const).map((slot) => {
                const mealForSlot = slot === "afternoon" ? day.lunch : slot === "evening" ? day.dinner : null;
                const activities = day[slot];
                const hasContent = mealForSlot?.name || (activities && activities.length > 0);
                if (!hasContent) return null;

                return (
                  <div key={slot}>
                    {/* Render lunch before afternoon, dinner before evening */}
                    {mealForSlot && renderMeal(mealForSlot, slot === "afternoon" ? "lunch" : "dinner")}

                    {activities && activities.length > 0 && (
                      <div className="mb-4">
                        <Badge className={`${getTimeSlotColor(slot)} text-white mb-3`}>
                          {slot.charAt(0).toUpperCase() + slot.slice(1)}
                        </Badge>

                        {activities.map((activity: Activity, actIdx: number) => (
                          <div key={actIdx} className="pl-3 mb-3">
                            <h4 className="text-base font-bold text-gray-800 mb-1">{activity.name}</h4>

                            {activity.time && (
                              <p className="text-sm text-blue-600 mb-1.5">{activity.time}</p>
                            )}

                            {activity.description && (
                              <p className="text-sm text-gray-600 leading-5 mb-2">
                                {activity.description}
                              </p>
                            )}

                            <div className="flex flex-wrap gap-2 mb-2">
                              {activity.duration && (
                                <Badge variant="secondary" className="text-xs">
                                  <Clock className="w-3 h-3 mr-1" />
                                  {activity.duration}
                                </Badge>
                              )}
                              {activity.cost != null && (
                                <Badge variant="secondary" className="text-xs">
                                  <DollarSign className="w-3 h-3 mr-1" />
                                  {activity.cost}
                                </Badge>
                              )}
                              {activity.rating && (
                                <Badge variant="secondary" className="text-xs">
                                  <Star className="w-3 h-3 mr-1" />
                                  {activity.rating}
                                </Badge>
                              )}
                            </div>

                            {activity.practical_tips && (
                              <div className="bg-amber-50 p-3 rounded-lg mb-2 flex gap-2">
                                <Lightbulb className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-amber-800">{activity.practical_tips}</p>
                              </div>
                            )}

                            {activity.coordinates && (
                              <Button
                                size="sm"
                                onClick={() => openLink(getGoogleMapsUrl(activity.coordinates))}
                                className="rounded-full text-xs"
                              >
                                <MapPin className="w-3 h-3 mr-1" />
                                View on Maps
                              </Button>
                            )}

                            {actIdx < activities.length - 1 && (
                              <Separator className="my-4" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
