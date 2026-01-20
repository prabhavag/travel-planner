"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Check,
  Star,
  MapPin,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  UtensilsCrossed,
  XCircle,
  Banknote
} from "lucide-react";
import type { RestaurantSuggestion } from "@/lib/api-client";

interface RestaurantSelectionViewProps {
  restaurants: RestaurantSuggestion[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  onConfirm: (wantsRestaurants: boolean) => void;
  isLoading?: boolean;
}

export function RestaurantSelectionView({
  restaurants,
  selectedIds,
  onSelectionChange,
  onConfirm,
  isLoading = false,
}: RestaurantSelectionViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set(selectedIds));

  const toggleRestaurant = (id: string) => {
    const newSelected = new Set(localSelectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setLocalSelectedIds(newSelected);
    onSelectionChange(Array.from(newSelected));
  };

  const handleAddRestaurants = () => {
    onConfirm(true);
  };

  const handleSkip = () => {
    onConfirm(false);
  };

  const nextRestaurant = () => {
    if (currentIndex < restaurants.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const prevRestaurant = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (restaurants.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-center text-gray-500">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
          <XCircle className="w-10 h-10 text-gray-300" />
        </div>
        <p className="text-xl font-medium mb-6">No restaurants found near your activities.</p>
        <Button variant="outline" onClick={handleSkip} className="h-14 px-8 rounded-2xl text-lg font-bold">
          Continue Without Restaurants
        </Button>
      </div>
    );
  }

  const currentRestaurant = restaurants[currentIndex];
  const isSelected = localSelectedIds.has(currentRestaurant.id);

  return (
    <div className="h-full flex flex-col relative bg-orange-50/20">
      {/* Immersive Header */}
      <div className="px-8 py-6 bg-white border-b border-gray-200 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center text-white shadow-lg">
            <UtensilsCrossed className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 leading-tight">Pick Your Restaurants</h2>
            <p className="text-sm font-medium text-amber-600 uppercase tracking-widest">
              {localSelectedIds.size} {localSelectedIds.size === 1 ? "Selected" : "Selections"}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={handleSkip} disabled={isLoading} className="h-14 px-6 rounded-2xl font-medium text-gray-400 hover:text-gray-600">
            Skip
          </Button>
          <Button
            onClick={handleAddRestaurants}
            disabled={localSelectedIds.size === 0 || isLoading}
            size="lg"
            className="h-14 px-8 rounded-2xl font-medium text-lg bg-gray-900 hover:bg-black shadow-xl shadow-gray-200 transition-all gap-2"
          >
            {isLoading ? "Adding..." : (
              <>
                <CheckCircle2 className="w-6 h-6" />
                Add to Itinerary
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        {/* Navigation Arrows - Fixed relative to the panel */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={prevRestaurant}
            disabled={currentIndex === 0}
            className="w-16 h-16 rounded-full bg-white shadow-xl hover:bg-gray-50 border border-gray-100 disabled:opacity-0 transition-all pointer-events-auto"
          >
            <ChevronLeft className="w-10 h-10 text-gray-800" />
          </Button>
        </div>

        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={nextRestaurant}
            disabled={currentIndex === restaurants.length - 1}
            className="w-16 h-16 rounded-full bg-white shadow-xl hover:bg-gray-50 border border-gray-100 disabled:opacity-0 transition-all pointer-events-auto"
          >
            <ChevronRight className="w-10 h-10 text-gray-800" />
          </Button>
        </div>

        {/* Scrollable Content Viewport */}
        <div className="absolute inset-0 overflow-y-auto px-20 py-10 flex justify-center">
          {/* Large Restaurant Card - Two Column Header */}
          <Card
            className={`w-full max-w-[95%] h-fit min-h-full overflow-hidden border-0 shadow-[0_30px_60px_rgba(0,0,0,0.12)] flex flex-col rounded-[2.5rem] transition-all duration-500 cursor-pointer bg-white ${isSelected ? "ring-8 ring-amber-500/20" : ""
              }`}
            onClick={() => toggleRestaurant(currentRestaurant.id)}
          >
            <div className="flex flex-col md:flex-row border-b border-gray-100">
              {/* Left Column: Image (Non-stretched) */}
              {currentRestaurant.photo_url ? (
                <div className="w-full md:w-[400px] h-[300px] md:h-auto overflow-hidden bg-gray-50 flex-shrink-0">
                  <img
                    src={currentRestaurant.photo_url}
                    alt={currentRestaurant.name}
                    className="w-full h-full object-cover transition-transform duration-[3000ms] hover:scale-105"
                  />
                  {isSelected && (
                    <div className="absolute top-6 left-6 w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center shadow-2xl z-10">
                      <Check className="w-8 h-8 text-white stroke-[3px]" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full md:w-[400px] h-48 md:h-auto bg-amber-900 flex items-center justify-center flex-shrink-0 relative">
                  <UtensilsCrossed className="w-12 h-12 text-amber-700" />
                  {isSelected && (
                    <div className="absolute top-6 left-6 w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center shadow-2xl">
                      <Check className="w-8 h-8 text-white stroke-[3px]" />
                    </div>
                  )}
                </div>
              )}

              {/* Right Column: Key Info */}
              <div className="flex-1 p-8 flex flex-col justify-center bg-white relative">
                <div className="flex items-center gap-3 mb-4">
                  <Badge className="bg-amber-100 text-amber-700 border-amber-200 px-3 py-1 font-medium text-xs">
                    {currentRestaurant.cuisine || "Restaurant"}
                  </Badge>
                  {currentRestaurant.priceRange && (
                    <div className="flex items-center gap-1 bg-green-50 px-3 py-1 rounded-full border border-green-100">
                      <Banknote className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700">{currentRestaurant.priceRange}</span>
                    </div>
                  )}
                  {currentRestaurant.rating && (
                    <div className="flex items-center gap-1 bg-amber-50 px-3 py-1 rounded-full border border-amber-100">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-medium text-amber-900">{currentRestaurant.rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>
                <h1 className="text-4xl font-bold text-gray-900 leading-tight mb-2">{currentRestaurant.name}</h1>
                <div className="flex items-center gap-2 text-gray-400 font-medium">
                  <MapPin className="w-4 h-4" />
                  <span className="text-sm">{currentRestaurant.vicinity}</span>
                </div>

                {isSelected && !currentRestaurant.photo_url && (
                  <div className="absolute top-8 right-8 w-12 h-12 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                )}
              </div>
            </div>

            <CardContent className="p-8 space-y-10">
              <section className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">Why pick this restaurant?</h4>
                <p className="text-lg text-gray-600 leading-relaxed font-normal">
                  Located in the heart of {currentRestaurant.vicinity.split(',')[0]}, this {currentRestaurant.cuisine?.toLowerCase() || 'local'} spot is perfect for a break during your trip.
                </p>
              </section>

              <div className="pt-8 border-t border-gray-100">
                <Button
                  className={`w-full h-16 text-xl font-medium rounded-2xl transition-all gap-4 ${isSelected
                    ? "bg-amber-500 hover:bg-amber-600 text-white shadow-xl shadow-amber-200"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                    }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRestaurant(currentRestaurant.id);
                  }}
                >
                  {isSelected ? (
                    <>
                      <Check className="w-10 h-10 stroke-[3px]" />
                      Selected
                    </>
                  ) : "Select This Restaurant"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Progress Sync Footer */}
        <div className="absolute bottom-0 inset-x-0 p-6 bg-white/50 backdrop-blur-sm border-t border-gray-200 flex flex-col items-center gap-4 z-20">
          <div className="flex gap-2">
            {restaurants.map((r, idx) => (
              <button
                key={r.id}
                onClick={() => setCurrentIndex(idx)}
                className={`transition-all duration-300 rounded-full h-3 ${idx === currentIndex
                  ? "w-14 bg-gray-900"
                  : localSelectedIds.has(r.id)
                    ? "w-3 bg-amber-500"
                    : "w-3 bg-gray-200 hover:bg-gray-300"
                  }`}
              />
            ))}
          </div>
          <p className="text-xs font-medium text-gray-300 uppercase tracking-[0.2em]">
            Reviewing {currentIndex + 1} of {restaurants.length} Suggestions
          </p>
        </div>
      </div>
    </div>
  );
}
