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
  userPreferences?: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  onConfirm: () => void;
  onRegenerate: () => void;
  onHoverActivity?: (id: string | null) => void;
  isLoading?: boolean;
}

export function ActivitySelectionView({
  activities,
  selectedIds,
  userPreferences = [],
  onSelectionChange,
  onConfirm,
  onRegenerate,
  onHoverActivity,
  isLoading = false,
}: ActivitySelectionViewProps) {
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set(selectedIds));

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const preferenceTerms = userPreferences.map(normalize).filter(Boolean);

  const isInterestTagMatch = (tag: string): boolean => {
    const normalizedTag = normalize(tag);
    if (!normalizedTag || normalizedTag === "general interest match" || preferenceTerms.length === 0) {
      return false;
    }

    return preferenceTerms.some(
      (pref) => pref === normalizedTag || pref.includes(normalizedTag) || normalizedTag.includes(pref)
    );
  };

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
                  {(activity.interestTags && activity.interestTags.length > 0
                    ? activity.interestTags
                    : ["general interest match"]).map((tag) => {
                    const isMatch = isInterestTagMatch(tag);
                    return (
                      <Badge
                        key={activity.id + "-" + tag}
                        variant="secondary"
                        title={tag}
                        className={`max-w-[150px] truncate ${isMatch
                          ? "border border-rose-200 bg-rose-50 text-rose-800"
                          : "border border-sky-200 bg-sky-50 text-sky-800"
                          }`}
                      >
                        {tag}
                      </Badge>
                    );
                  })}
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
