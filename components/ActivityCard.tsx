"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Clock, Star, MapPin, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import type { SuggestedActivity } from "@/lib/api-client";
import { formatCost } from "@/lib/utils/currency";

interface ActivityCardProps {
  activity: SuggestedActivity;
  index: number;
  isSelected: boolean;
  userPreferences?: string[];
  onClick?: () => void;
  onHoverActivity?: (id: string | null) => void;
  extraContent?: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function ActivityCard({
  activity,
  index,
  isSelected,
  userPreferences = [],
  onClick,
  onHoverActivity,
  extraContent,
  collapsed = false,
  onToggleCollapse,
}: ActivityCardProps) {
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

  const openInMaps = (selectedActivity: SuggestedActivity) => {
    if (selectedActivity.coordinates) {
      const { lat, lng } = selectedActivity.coordinates;
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${selectedActivity.place_id || ""}`,
        "_blank"
      );
    } else {
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedActivity.name)}`,
        "_blank"
      );
    }
  };

  const getActivityPhotoUrls = (selectedActivity: SuggestedActivity): string[] => {
    const fromArray = Array.isArray(selectedActivity.photo_urls)
      ? selectedActivity.photo_urls.filter(Boolean).slice(0, 3)
      : [];
    if (fromArray.length > 0) return fromArray;
    if (selectedActivity.photo_url) return [selectedActivity.photo_url];
    return [];
  };

  const getDifficultyBadgeClass = (level: SuggestedActivity["difficultyLevel"]) => {
    if (level === "easy") return "border-emerald-200 bg-emerald-50 text-emerald-800";
    if (level === "hard") return "border-rose-200 bg-rose-50 text-rose-800";
    return "border-amber-200 bg-amber-50 text-amber-800";
  };
  const difficultyLevel = activity.difficultyLevel || "moderate";

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary bg-primary/5" : ""}`}
      onClick={onClick}
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
            {onToggleCollapse && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse();
                }}
                className="h-6 w-6 p-0 text-gray-400 hover:text-primary"
                title={collapsed ? "Expand card" : "Collapse card"}
              >
                {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </Button>
            )}
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
          <Badge className="border border-blue-200 bg-blue-50 text-blue-800">
            <Clock className="mr-1 h-3 w-3" />
            {activity.estimatedDuration}
          </Badge>
          <Badge className={`border ${getDifficultyBadgeClass(difficultyLevel)}`}>
            {difficultyLevel}
          </Badge>
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
      {!collapsed && (
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
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(() => {
            const photos = getActivityPhotoUrls(activity);
            return Array.from({ length: 3 }).map((_, photoIndex) => {
              const url = photos[photoIndex];
              return url ? (
                <img
                  key={`${activity.id}-photo-${photoIndex}`}
                  src={url}
                  alt={`${activity.name} photo ${photoIndex + 1}`}
                  className="h-16 w-full rounded-md object-cover border border-gray-200"
                  loading="lazy"
                />
              ) : (
                <div
                  key={`${activity.id}-photo-placeholder-${photoIndex}`}
                  className="h-16 w-full rounded-md border border-dashed border-gray-200 bg-gray-50"
                />
              );
            });
          })()}
        </div>
        {extraContent}
      </CardContent>
      )}
    </Card>
  );
}
