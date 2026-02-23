"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Star, MapPin, Clock, ExternalLink, Globe } from "lucide-react";
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
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set(selectedIds));
  useEffect(() => {
    setLocalSelectedIds(new Set(selectedIds));
  }, [selectedIds]);

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

  const getPriceRangeDisplay = (priceRange: string | null): string => {
    if (!priceRange) return "";
    return priceRange;
  };

  const getCuisineColor = (cuisine: string | null): string => {
    if (!cuisine) return "bg-gray-100 text-gray-800";
    const colors: Record<string, string> = {
      italian: "bg-green-100 text-green-800",
      chinese: "bg-red-100 text-red-800",
      japanese: "bg-pink-100 text-pink-800",
      mexican: "bg-orange-100 text-orange-800",
      indian: "bg-amber-100 text-amber-800",
      thai: "bg-purple-100 text-purple-800",
      french: "bg-blue-100 text-blue-800",
      american: "bg-indigo-100 text-indigo-800",
      mediterranean: "bg-cyan-100 text-cyan-800",
      vietnamese: "bg-teal-100 text-teal-800",
      korean: "bg-rose-100 text-rose-800",
      greek: "bg-sky-100 text-sky-800",
    };
    return colors[cuisine.toLowerCase()] || "bg-gray-100 text-gray-800";
  };

  const openInMaps = (restaurant: RestaurantSuggestion) => {
    if (!restaurant.coordinates) return;
    const { lat, lng } = restaurant.coordinates;
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${restaurant.place_id || ""}`,
      "_blank"
    );
  };

  const getLocationText = (restaurant: RestaurantSuggestion) => {
    return restaurant.formatted_address || restaurant.vicinity || "";
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 bg-white z-10 py-2">
        <div>
          <h2 className="text-lg font-semibold">Add Restaurants</h2>
          <p className="text-sm text-gray-500">
            {localSelectedIds.size > 0
              ? `${localSelectedIds.size} selected`
              : "Select restaurants to add to your itinerary"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSkip} disabled={isLoading}>
            Skip Restaurants
          </Button>
          <Button
            onClick={handleAddRestaurants}
            disabled={localSelectedIds.size === 0 || isLoading}
            className="bg-primary text-white"
          >
            {isLoading
              ? "Adding..."
              : `Add ${localSelectedIds.size} ${localSelectedIds.size === 1 ? "Restaurant" : "Restaurants"}`}
          </Button>
        </div>
      </div>

      {/* Restaurant grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {restaurants.map((restaurant) => {
          const isSelected = localSelectedIds.has(restaurant.id);
          return (
            <Card
              key={restaurant.id}
              className={`cursor-pointer transition-all hover:shadow-md ${
                isSelected ? "ring-2 ring-primary bg-primary/5" : ""
              }`}
              onClick={() => toggleRestaurant(restaurant.id)}
            >
              <CardHeader className="pb-2">
                <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                  {restaurant.photo_url ? (
                    <img
                      src={restaurant.photo_url}
                      alt={restaurant.name}
                      className="h-40 w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center text-xs text-gray-500">
                      No photo available
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base line-clamp-1">{restaurant.name}</CardTitle>
                  {isSelected && (
                    <div className="flex-shrink-0 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {restaurant.cuisine && (
                    <Badge variant="secondary" className={getCuisineColor(restaurant.cuisine)}>
                      {restaurant.cuisine}
                    </Badge>
                  )}
                  {restaurant.priceRange && (
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      {getPriceRangeDisplay(restaurant.priceRange)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="flex flex-wrap gap-3 text-sm text-gray-500">
                  {restaurant.rating && (
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      <span>{restaurant.rating.toFixed(1)}</span>
                      {typeof restaurant.user_ratings_total === "number" && restaurant.user_ratings_total > 0 && (
                        <span className="text-xs text-gray-400">({restaurant.user_ratings_total})</span>
                      )}
                    </div>
                  )}
                  {getLocationText(restaurant) && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span className="truncate max-w-[180px]">{getLocationText(restaurant)}</span>
                    </div>
                  )}
                </div>

                {restaurant.opening_hours && (
                  <div className="flex items-start gap-1.5 text-xs text-gray-600">
                    <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span className="line-clamp-1">{restaurant.opening_hours}</span>
                  </div>
                )}

                {restaurant.editorial_summary && (
                  <p className="text-xs text-gray-600 line-clamp-2">{restaurant.editorial_summary}</p>
                )}

                <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => openInMaps(restaurant)}
                  >
                    <ExternalLink className="w-3 h-3 mr-1" />
                    Open in Maps
                  </Button>
                  {restaurant.website && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => window.open(restaurant.website || "", "_blank")}
                    >
                      <Globe className="w-3 h-3 mr-1" />
                      Website
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {restaurants.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No restaurants found near your activities.</p>
          <Button variant="outline" onClick={handleSkip} className="mt-4">
            Continue Without Restaurants
          </Button>
        </div>
      )}
    </div>
  );
}
