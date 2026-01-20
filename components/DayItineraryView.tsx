"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Star,
  MapPin,
  Utensils,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { GroupedDay, SuggestedActivity, RestaurantSuggestion } from "@/lib/api-client";
import { formatCost } from "@/lib/utils/currency";
import { getDayColor } from "@/lib/constants";
import { formatDisplayDate } from "@/lib/utils/date";

interface DayItineraryViewProps {
  groupedDays: GroupedDay[];
  tripInfo?: {
    destination: string | null;
    startDate: string | null;
    endDate: string | null;
    durationDays: number | null;
  };
  selectedDayNumber?: number;
  onHighlightLocation?: (id: string | null) => void;
  onSelectDay?: (dayNumber: number) => void;
}

export function DayItineraryView({
  groupedDays,
  tripInfo,
  selectedDayNumber,
  onHighlightLocation,
  onSelectDay,
}: DayItineraryViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const flattenedSpots = useMemo(() => {
    return groupedDays.flatMap(day => [
      ...day.activities.map(a => ({ ...a, dayNumber: day.dayNumber })),
      ...day.restaurants.map(r => ({ ...r, dayNumber: day.dayNumber }))
    ]);
  }, [groupedDays]);

  const selectedDay = useMemo(() => {
    return groupedDays.find((d) => d.dayNumber === selectedDayNumber);
  }, [groupedDays, selectedDayNumber]);

  // Sync carousel position when the day tab changes externally
  useEffect(() => {
    const firstIdxOnDay = flattenedSpots.findIndex(s => s.dayNumber === selectedDayNumber);
    if (firstIdxOnDay !== -1) {
      const currentSpot = flattenedSpots[currentIndex];
      // Only jump to the first activity of the day if we aren't already viewing an activity on that day.
      if (!currentSpot || currentSpot.dayNumber !== selectedDayNumber) {
        setCurrentIndex(firstIdxOnDay);
      }
    }
  }, [selectedDayNumber, flattenedSpots]);

  // Highlight marker on map when carousel index changes
  useEffect(() => {
    const currentSpot = flattenedSpots[currentIndex];
    if (currentSpot && onHighlightLocation) {
      onHighlightLocation(currentSpot.id);
    }
  }, [currentIndex, flattenedSpots, onHighlightLocation]);
  // Note: Tab synchronization now happens imperatively in navigation handlers.

  const nextSpot = () => {
    if (currentIndex < flattenedSpots.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);

      // Imperative sync to tab
      const nextSpot = flattenedSpots[nextIdx];
      if (nextSpot && nextSpot.dayNumber !== selectedDayNumber && onSelectDay) {
        onSelectDay(nextSpot.dayNumber);
      }
    }
  };

  const prevSpot = () => {
    if (currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);

      // Imperative sync to tab
      const prevSpot = flattenedSpots[prevIdx];
      if (prevSpot && prevSpot.dayNumber !== selectedDayNumber && onSelectDay) {
        onSelectDay(prevSpot.dayNumber);
      }
    }
  };

  const formatDate = (dateStr: string): string => {
    return formatDisplayDate(dateStr, {
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

  const openInMaps = (spot: SuggestedActivity | RestaurantSuggestion) => {
    if (spot.coordinates) {
      const { lat, lng } = spot.coordinates;
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${spot.place_id || ""}`,
        "_blank"
      );
    } else {
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name)}`,
        "_blank"
      );
    }
  };

  if (!selectedDay || flattenedSpots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-gray-500">
        <p>No activities planned.</p>
      </div>
    );
  }

  const currentSpot = flattenedSpots[currentIndex];
  // Calculate index within day for the indicator
  const spotsOnThisDay = flattenedSpots.filter(s => s.dayNumber === selectedDay.dayNumber);
  const indexInDay = spotsOnThisDay.findIndex(s => s.id === currentSpot.id);
  const isRestaurant = "cuisine" in currentSpot;

  return (
    <div className="h-full flex flex-col relative">
      {/* Day Info Header */}
      <div className="px-6 py-4 flex items-center justify-between bg-white/50 backdrop-blur-sm sticky top-0 z-10 border-b border-gray-200/50">
        <div>
          <h3 className="text-2xl font-bold tracking-tight text-gray-900">{selectedDay.theme}</h3>
          <p className="text-sm font-medium text-gray-500 flex items-center gap-2">
            <Badge variant="outline" className={`border-${getDayColor(selectedDay.dayNumber)} text-${getDayColor(selectedDay.dayNumber)}`}>
              Day {selectedDay.dayNumber}
            </Badge>
            {formatDate(selectedDay.date)}
          </p>
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        {/* Navigation Buttons - Absolute Positioned and Fixed relative to the viewport */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <Button
            variant="secondary"
            size="icon"
            onClick={prevSpot}
            disabled={currentIndex === 0}
            className="w-12 h-12 rounded-full shadow-2xl bg-white/95 hover:bg-white border text-gray-900 transition-all scale-100 hover:scale-110 disabled:opacity-0 pointer-events-auto"
          >
            <ChevronLeft className="w-8 h-8" />
          </Button>
        </div>

        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <Button
            variant="secondary"
            size="icon"
            onClick={nextSpot}
            disabled={currentIndex === flattenedSpots.length - 1}
            className="w-12 h-12 rounded-full shadow-2xl bg-white/95 hover:bg-white border text-gray-900 transition-all scale-100 hover:scale-110 disabled:opacity-0 pointer-events-auto"
          >
            <ChevronRight className="w-8 h-8" />
          </Button>
        </div>

        {/* Scrollable Content Viewport */}
        <div className="absolute inset-0 overflow-y-auto px-16 py-8 flex justify-center">
          {/* Main Immersive Card */}
          <Card className="w-full max-w-4xl h-fit min-h-full flex flex-col overflow-hidden border-0 shadow-[0_30px_70px_rgba(0,0,0,0.2)] transition-all duration-700 bg-white">
            <div className="flex flex-col md:flex-row border-b border-gray-100">
              {/* Left Column: Image (Proportional, No Stretch) */}
              {currentSpot.photo_url ? (
                <div className="w-full md:w-64 h-[240px] md:h-auto overflow-hidden bg-gray-50 flex-shrink-0">
                  <img
                    src={currentSpot.photo_url}
                    alt={currentSpot.name}
                    className="w-full h-full object-cover transition-transform duration-[2000ms] hover:scale-105"
                  />
                </div>
              ) : (
                <div className="w-full md:w-64 h-40 md:h-auto bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-10 h-10 text-gray-300" />
                </div>
              )}

              {/* Right Column: Key Info (Structured, Non-stretched) */}
              <div className="flex-1 p-6 flex flex-col justify-center bg-white">
                <div className="flex items-center gap-2 mb-3">
                  <Badge className={`px-2 py-0.5 text-[10px] font-bold ${isRestaurant ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"}`}>
                    {isRestaurant ? "Dining" : (currentSpot as SuggestedActivity).type}
                  </Badge>
                  {currentSpot.rating && (
                    <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span className="text-xs font-medium text-amber-900">{currentSpot.rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>

                <h1 className="text-xl font-bold text-gray-900 leading-tight mb-2">
                  {currentSpot.name}
                </h1>

                <div className="flex items-center gap-2 text-gray-400 font-medium">
                  <MapPin className="w-4 h-4" />
                  <span className="text-sm">
                    {isRestaurant ? (currentSpot as RestaurantSuggestion).vicinity : "Activity Location"}
                  </span>
                </div>
              </div>
            </div>
            <CardContent className="p-6 space-y-6">
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">About this spot</h4>
                <p className="text-sm text-gray-600 leading-relaxed font-normal">
                  {isRestaurant ? (currentSpot as RestaurantSuggestion).vicinity : (currentSpot as SuggestedActivity).description}
                </p>
              </section>

              <div className="grid grid-cols-2 gap-4">
                {!isRestaurant && (
                  <div className="bg-blue-50/50 p-3 rounded-xl flex items-center gap-3 border border-blue-100/50">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-[10px] text-blue-600 font-medium uppercase tracking-wider">Duration</p>
                      <p className="text-sm font-semibold text-blue-900">{(currentSpot as SuggestedActivity).estimatedDuration}</p>
                    </div>
                  </div>
                )}

                <div className="bg-green-50/50 p-3 rounded-xl flex items-center gap-3 border border-green-100/50">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Utensils className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-[10px] text-green-600 font-medium uppercase tracking-wider">
                      {isRestaurant ? "Cuisine" : "Estimated Cost"}
                    </p>
                    <p className="text-sm font-semibold text-green-900">
                      {isRestaurant
                        ? ((currentSpot as RestaurantSuggestion).cuisine || "Varies")
                        : ((currentSpot as SuggestedActivity).estimatedCost === 0
                          ? "Free Entry"
                          : formatCost((currentSpot as SuggestedActivity).estimatedCost!, (currentSpot as SuggestedActivity).currency))
                      }
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <Button
                  className="flex-1 h-12 text-base font-medium rounded-xl bg-gray-900 hover:bg-black transition-all gap-2"
                  onClick={() => openInMaps(currentSpot)}
                >
                  <MapPin className="w-5 h-5" />
                  Navigate
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="w-12 h-12 rounded-xl border-2"
                  onClick={() => openInMaps(currentSpot)}
                >
                  <ExternalLink className="w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer Navigation Sync Indicator */}
        <div className="p-6 bg-white/50 backdrop-blur-sm border-t border-gray-200/50 flex flex-col items-center gap-4">
          <div className="flex gap-2">
            {flattenedSpots.map((s, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentIndex(idx);
                  if (s.dayNumber !== selectedDayNumber && onSelectDay) {
                    onSelectDay(s.dayNumber);
                  }
                }}
                className={`transition-all duration-300 rounded-full ${idx === currentIndex
                  ? "w-12 h-3 bg-gray-900"
                  : s.dayNumber === selectedDay.dayNumber
                    ? "w-3 h-3 bg-gray-300 hover:bg-gray-400"
                    : "w-2 h-2 bg-gray-200"
                  }`}
                title={`Day ${s.dayNumber}: ${s.name}`}
              />
            ))}
          </div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-widest">
            Spot {indexInDay + 1} of {spotsOnThisDay.length} on Day {selectedDay.dayNumber}
          </p>
        </div>
      </div>
    </div>
  );
}
