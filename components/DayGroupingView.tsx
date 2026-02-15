"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, ChevronLeft, ChevronRight, Star, MapPin, ListChecks } from "lucide-react";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";

interface DayGroupingViewProps {
  groupedDays: GroupedDay[];
  userPreferences?: string[];
  onMoveActivity: (activityId: string, fromDay: number, toDay: number) => void;
  onConfirm: () => void;
  onDayChange?: (dayNumber: number) => void;
  isLoading?: boolean;
}

export function DayGroupingView({
  groupedDays,
  userPreferences = [],
  onMoveActivity,
  onConfirm,
  onDayChange,
  isLoading = false,
}: DayGroupingViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [movingActivity, setMovingActivity] = useState<{
    id: string;
    fromDay: number;
  } | null>(null);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current && onDayChange) {
      const container = scrollContainerRef.current;
      const index = Math.round(container.scrollLeft / container.clientWidth);
      const activeDay = groupedDays[index]?.dayNumber;
      if (activeDay) {
        onDayChange(activeDay);
      }
    }
  }, [groupedDays, onDayChange]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

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

  const ActivityItem = ({
    activity,
    dayNumber,
  }: {
    activity: SuggestedActivity;
    dayNumber: number;
  }) => {
    const isMoving = movingActivity?.id === activity.id;

    return (
      <div
        className={`p-4 rounded-xl border transition-all duration-200 bg-white mb-3 ${isMoving ? "ring-2 ring-primary bg-blue-50/30 shadow-md scale-[1.02]" : "border-gray-100"
          }`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className={`${getActivityTypeColor(activity.type)} text-[10px] h-5`}>
                {activity.type}
              </Badge>
            </div>
            <h4 className="text-sm font-bold text-gray-900 line-clamp-1">{activity.name}</h4>
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

        <p className="text-xs text-gray-600 line-clamp-2 mb-3 leading-relaxed">{activity.description}</p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-500 pb-3">
          <div className="flex items-center gap-1 font-medium text-gray-700">
            <Clock className="w-3 h-3 text-primary" />
            <span>{activity.estimatedDuration}</span>
          </div>
          {activity.rating && (
            <div className="flex items-center gap-0.5">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              <span className="font-medium text-gray-700">{activity.rating.toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-gray-50">
          {isMoving ? (
            <div className="flex items-center gap-2">
              <Select onValueChange={(val) => handleMoveConfirm(parseInt(val))}>
                <SelectTrigger className="flex-1 h-8 text-[10px]">
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
              <Button variant="outline" size="sm" onClick={handleMoveCancel} className="h-8 px-2 text-[10px]">
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleMoveStart(activity.id, dayNumber)}
              className="w-full h-8 text-[10px] font-medium text-gray-500 hover:text-primary hover:border-primary transition-colors"
            >
              Change Day
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-primary" />
            Organize Your Days
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Review the daily flow or shuffle activities to perfect your trip
          </p>
        </div>
        <Button onClick={onConfirm} disabled={isLoading} className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 h-11 shrink-0">
          {isLoading ? "Confirming..." : "Confirm Grouping"}
        </Button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* Navigation buttons */}
        <div className="flex items-center justify-between mb-4 shrink-0 px-2">
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

        {/* Day-based horizontal carousel */}
        <div
          ref={scrollContainerRef}
          className="flex-1 flex overflow-x-auto snap-x snap-mandatory scrollbar-none"
          style={{ scrollBehavior: 'smooth' }}
        >
          {groupedDays.map((day) => (
            <div key={day.dayNumber} className="w-full flex-shrink-0 snap-center px-2">
              <Card className="h-full border-t-4 flex flex-col" style={{ borderTopColor: getDayColor(day.dayNumber) }}>
                <CardHeader className="pb-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge className={`${getDayBadgeColors(day.dayNumber)} h-6 px-2`}>
                          Day {day.dayNumber}
                        </Badge>
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                          {day.activities.length} Activities
                        </span>
                      </div>
                      <CardTitle className="text-xl">{day.theme}</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full px-4 pb-6">
                    <div className="space-y-1">
                      {day.activities.map((activity) => (
                        <ActivityItem
                          key={activity.id}
                          activity={activity}
                          dayNumber={day.dayNumber}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          ))}
          {groupedDays.length === 0 && (
            <div className="w-full py-12 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed mx-2">
              <MapPin className="w-8 h-8 mb-2 opacity-20" />
              <p>No activities planned yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

