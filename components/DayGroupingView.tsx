"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, ChevronLeft, ChevronRight, Star, MapPin, ListChecks } from "lucide-react";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";

interface DayGroupingViewProps {
  groupedDays: GroupedDay[];
  userPreferences?: string[];
  onMoveActivity: (activityId: string, fromDay: number, toDay: number) => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DayGroupingView({
  groupedDays,
  userPreferences = [],
  onMoveActivity,
  onConfirm,
  isLoading = false,
}: DayGroupingViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [movingActivity, setMovingActivity] = useState<{
    id: string;
    fromDay: number;
  } | null>(null);

  // Flatten all activities into a single list with metadata
  const carouselItems = groupedDays.flatMap(day =>
    day.activities.map(activity => ({
      data: activity,
      dayNumber: day.dayNumber,
      dayTheme: day.theme
    }))
  );

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

  const handleMoveStart = (activityId: string, fromDay: number) => {
    setMovingActivity({ id: activityId, fromDay });
  };

  const handleMoveConfirm = (toDay: number) => {
    if (movingActivity && movingActivity.fromDay !== toDay) {
      onMoveActivity(movingActivity.id, movingActivity.fromDay, toDay);
    }
    setMovingActivity(null);
  };

  const handleMoveCancel = () => {
    setMovingActivity(null);
  };

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

  const ActivityCard = ({
    activity,
    dayNumber,
  }: {
    activity: SuggestedActivity;
    dayNumber: number;
  }) => {
    const isMoving = movingActivity?.id === activity.id;

    return (
      <Card
        className={`w-full min-w-full flex-shrink-0 snap-center transition-all duration-200 border-t-4 hover:shadow-md ${isMoving ? "ring-2 ring-primary bg-blue-50/30" : ""}`}
        style={{ borderTopColor: getDayColor(dayNumber) }}
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
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(activity.interestTags && activity.interestTags.length > 0
                  ? activity.interestTags
                  : ["general interest match"]).map((tag) => {
                  const isMatch = isInterestTagMatch(tag);
                  return (
                    <Badge
                      key={`${activity.id}-${tag}`}
                      variant="secondary"
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
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600 line-clamp-2 min-h-[40px]">{activity.description}</p>

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
          </div>

          <div className="pt-2 border-t">
            {isMoving ? (
              <div className="flex items-center gap-2">
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
                onClick={() => handleMoveStart(activity.id, dayNumber)}
                className="w-full h-9 text-xs font-medium text-gray-600 hover:text-primary hover:border-primary transition-colors"
              >
                Change Day
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex items-center justify-between sticky top-0 z-10">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-primary" />
            Organize Your Days
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Review the daily flow or shuffle activities to perfect your trip
          </p>
        </div>
        <Button onClick={onConfirm} disabled={isLoading} className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 h-11">
          {isLoading ? "Confirming..." : "Confirm Grouping"}
        </Button>
      </div>

      <div className="relative group overflow-hidden">
        {/* Navigation buttons */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest px-1">Planned Highlights</h3>
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
            <div key={`${item.data.id}-${idx}`} className="w-full flex-shrink-0 snap-center">
              <ActivityCard
                activity={item.data}
                dayNumber={item.dayNumber}
              />
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
