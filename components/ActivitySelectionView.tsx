"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Clock, Star, MapPin, RefreshCw, ExternalLink } from "lucide-react";
import type { SuggestedActivity } from "@/lib/api-client";
import { formatCost } from "@/lib/utils/currency";

interface ActivitySelectionViewProps {
  activities: SuggestedActivity[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  onConfirm: () => void;
  onRegenerate: () => void;
  onHoverActivity?: (id: string | null) => void;
  isLoading?: boolean;
}

export function ActivitySelectionView({
  activities,
  selectedIds,
  onSelectionChange,
  onConfirm,
  onRegenerate,
  onHoverActivity,
  isLoading = false,
}: ActivitySelectionViewProps) {
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set(selectedIds));

  const toggleActivity = (id: string) => {
    const newSelected = new Set(localSelectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setLocalSelectedIds(newSelected);
    onSelectionChange(Array.from(newSelected));
  };

  const handleConfirm = () => {
    onConfirm();
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

  const getBestTimeColor = (time: string): string => {
    switch (time) {
      case "morning":
        return "bg-amber-100 text-amber-800";
      case "afternoon":
        return "bg-orange-100 text-orange-800";
      case "evening":
        return "bg-indigo-100 text-indigo-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
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

  return (
    <div className="space-y-4">
      {/* Header with selection count */}
      <div className="flex items-center justify-between bg-white py-2 px-4">
        <div>
          <h2 className="text-lg font-semibold">Select Activities</h2>
          <p className="text-sm text-gray-500">
            {localSelectedIds.size} of {activities.length} selected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isLoading}
            className="text-gray-500"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Regenerate
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={localSelectedIds.size === 0 || isLoading}
            className="bg-primary text-white"
          >
            {isLoading ? (
              "Organizing..."
            ) : (
              `Continue with ${localSelectedIds.size} ${localSelectedIds.size === 1 ? "activity" : "activities"}`
            )}
          </Button>
        </div>
      </div>

      {/* Activity grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activities.map((activity, index) => {
          const isSelected = localSelectedIds.has(activity.id);
          return (
            <Card
              key={activity.id}
              className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary bg-primary/5" : ""
                }`}
              onClick={() => toggleActivity(activity.id)}
              onMouseEnter={() => onHoverActivity?.(activity.id)}
              onMouseLeave={() => onHoverActivity?.(null)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base line-clamp-2">
                    <span className="text-gray-400 mr-2">#{index + 1}</span>
                    {activity.name}
                  </CardTitle>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openInMaps(activity);
                      }}
                      className="h-6 w-6 p-0 text-gray-400 hover:text-primary"
                      title="Open in Google Maps"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                    {isSelected && (
                      <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <Badge variant="secondary" className={getActivityTypeColor(activity.type)}>
                    {activity.type}
                  </Badge>
                  <Badge variant="secondary" className={getBestTimeColor(activity.bestTimeOfDay)}>
                    {activity.bestTimeOfDay}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-gray-600 line-clamp-3 mb-3">{activity.description}</p>
                <div className="flex flex-wrap gap-3 text-sm text-gray-500">
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>{activity.estimatedDuration}</span>
                  </div>
                  {activity.estimatedCost != null && activity.estimatedCost > 0 && (
                    <div className="flex items-center gap-1">
                      <span>{formatCost(activity.estimatedCost, activity.currency)}</span>
                    </div>
                  )}
                  {activity.estimatedCost === 0 && (
                    <div className="flex items-center gap-1 text-green-600">
                      <span>Free</span>
                    </div>
                  )}
                  {activity.rating && (
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      <span>{activity.rating.toFixed(1)}</span>
                    </div>
                  )}
                  {activity.neighborhood && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span className="truncate max-w-[120px]">{activity.neighborhood}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
