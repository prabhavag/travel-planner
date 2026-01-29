"use client";

import { useState, useEffect, useMemo } from "react";
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
import {
  Clock,
  Star,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
  CheckCircle2,
} from "lucide-react";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";
import { getDayColor } from "@/lib/constants";
import { formatDisplayDate } from "@/lib/utils/date";

interface DayGroupingViewProps {
  groupedDays: GroupedDay[];
  onMoveActivity: (activityId: string, fromDay: number, toDay: number) => void;
  onConfirm: () => void;
  isLoading?: boolean;
  selectedDayNumber?: number;
  onSelectDay?: (dayNumber: number) => void;
}

export function DayGroupingView({
  groupedDays,
  onMoveActivity,
  onConfirm,
  isLoading = false,
  selectedDayNumber,
  onSelectDay,
}: DayGroupingViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const flattenedActivities = useMemo(() => {
    return groupedDays.flatMap(day =>
      day.activities.map(a => ({ ...a, dayNumber: day.dayNumber }))
    );
  }, [groupedDays]);

  const selectedDay = useMemo(() => {
    return groupedDays.find((d) => d.dayNumber === selectedDayNumber);
  }, [groupedDays, selectedDayNumber]);

  // Sync carousel position when the day tab changes externally
  useEffect(() => {
    const firstIdxOnDay = flattenedActivities.findIndex(a => a.dayNumber === selectedDayNumber);
    if (firstIdxOnDay !== -1) {
      const currentActivity = flattenedActivities[currentIndex];
      // Only jump to the first activity of the day if we aren't already viewing an activity on that day.
      if (!currentActivity || currentActivity.dayNumber !== selectedDayNumber) {
        setCurrentIndex(firstIdxOnDay);
      }
    }
  }, [selectedDayNumber, flattenedActivities]);
  // Note: We removed the Carousel -> Tab effect to prevent bidirectional loops.
  // Synchronization now happens imperatively in the navigation handlers.

  const nextActivity = () => {
    if (currentIndex < flattenedActivities.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);

      // Imperative sync to tab
      const nextActivity = flattenedActivities[nextIdx];
      if (nextActivity && nextActivity.dayNumber !== selectedDayNumber && onSelectDay) {
        onSelectDay(nextActivity.dayNumber);
      }
    }
  };

  const prevActivity = () => {
    if (currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);

      // Imperative sync to tab
      const prevActivity = flattenedActivities[prevIdx];
      if (prevActivity && prevActivity.dayNumber !== selectedDayNumber && onSelectDay) {
        onSelectDay(prevActivity.dayNumber);
      }
    }
  };

  const formatDate = (dateStr: string): string => {
    return formatDisplayDate(dateStr, { weekday: "long", month: "long", day: "numeric" });
  };

  if (!selectedDay || flattenedActivities.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-gray-400">
        <p className="text-xl font-medium">No activities to organize.</p>
      </div>
    );
  }

  const currentActivity = flattenedActivities[currentIndex];
  // Activities for indicators
  const activitiesOnThisDay = flattenedActivities.filter(a => a.dayNumber === selectedDay.dayNumber);
  const indexInDay = activitiesOnThisDay.findIndex(a => a.id === currentActivity.id);

  return (
    <div className="h-full flex flex-col relative bg-gray-50/50">
      {/* Immersive Header */}
      <div className="px-8 py-6 bg-white border-b border-gray-200 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-6">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg`}
            style={{ backgroundColor: getDayColor(selectedDay.dayNumber) }}>
            {selectedDay.dayNumber}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 leading-tight">Organize Your Trip</h2>
            <p className="text-sm font-medium text-blue-600 uppercase tracking-widest">{formatDate(selectedDay.date)}</p>
          </div>
        </div>
        <Button
          onClick={onConfirm}
          disabled={isLoading}
          size="lg"
          className="h-14 px-8 rounded-2xl font-bold text-lg bg-primary hover:bg-primary/90 shadow-xl shadow-primary/20 transition-all gap-2"
        >
          {isLoading ? "Saving..." : (
            <>
              <CheckCircle2 className="w-6 h-6" />
              Confirm All Days
            </>
          )}
        </Button>
      </div>

      <div className="flex-1 relative min-h-0">
        {/* Navigation Arrows - Fixed relative to the panel */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={prevActivity}
            disabled={currentIndex === 0}
            className="w-12 h-12 rounded-full bg-white shadow-xl hover:bg-gray-50 border border-gray-100 disabled:opacity-0 transition-all pointer-events-auto"
          >
            <ChevronLeft className="w-8 h-8 text-gray-800" />
          </Button>
        </div>

        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={nextActivity}
            disabled={currentIndex === flattenedActivities.length - 1}
            className="w-12 h-12 rounded-full bg-white shadow-xl hover:bg-gray-50 border border-gray-100 disabled:opacity-0 transition-all pointer-events-auto"
          >
            <ChevronRight className="w-8 h-8 text-gray-800" />
          </Button>
        </div>

        {/* Scrollable Content Viewport */}
        <div className="absolute inset-0 overflow-y-auto px-16 py-8 flex justify-center">
          {/* Large Focusing Card - Two Column Header */}
          <Card className="w-full max-w-4xl h-fit min-h-full overflow-hidden border-0 shadow-[0_30px_60px_rgba(0,0,0,0.12)] flex flex-col rounded-[2rem] bg-white">
            <div className="flex flex-col md:flex-row border-b border-gray-100">
              {/* Left Column: Image */}
              {currentActivity.photo_url ? (
                <div className="w-full md:w-64 h-[240px] md:h-auto overflow-hidden bg-gray-50 flex-shrink-0 relative group">
                  <img
                    src={currentActivity.photo_url}
                    alt={currentActivity.name}
                    className="w-full h-full object-cover transition-transform duration-[3000ms] group-hover:scale-105"
                  />
                </div>
              ) : (
                <div className="w-full md:w-64 h-40 md:h-auto bg-slate-900 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-10 h-10 text-slate-700" />
                </div>
              )}

              {/* Right Column: Title & Badge */}
              <div className="flex-1 p-6 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-3">
                  {currentActivity.categoryTag && (
                    <Badge className={`px-2 py-0.5 border-0 text-white font-bold uppercase tracking-widest text-[8px] ${currentActivity.categoryTag === "Popular Choice"
                        ? "bg-blue-600 hover:bg-blue-700"
                        : currentActivity.categoryTag.startsWith("Interest:")
                          ? "bg-green-600 hover:bg-green-700"
                          : "bg-purple-600 hover:bg-purple-700"
                      }`}>
                      {currentActivity.categoryTag}
                    </Badge>
                  )}
                  {currentActivity.rating && (
                    <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span className="text-xs font-medium text-amber-900">{currentActivity.rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">{currentActivity.name}</h1>
              </div>
            </div>
            <CardContent className="p-6 space-y-6">
              <section className="space-y-3">
                <h4 className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray-400">Activity Details</h4>
                <p className="text-sm text-gray-600 leading-relaxed font-normal">
                  {currentActivity.description}
                </p>
                {currentActivity.suggestionReason && (
                  <div className="mt-4 p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50">
                    <p className="text-xs font-bold text-blue-900 mb-1 uppercase tracking-wider">Why we suggested this:</p>
                    <p className="text-sm text-blue-800 leading-relaxed italic">
                      "{currentActivity.suggestionReason}"
                    </p>
                  </div>
                )}
              </section>

              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-xl border border-gray-100">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">{currentActivity.estimatedDuration}</span>
                </div>
              </div>

              {/* Organization Controls - Move Activity */}
              <div className="pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between p-6 bg-slate-50 rounded-[1.5rem] border-2 border-dashed border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-md flex items-center justify-center">
                      <ArrowRightLeft className="w-5 h-5 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-900">Move Activity</p>
                      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Change day</p>
                    </div>
                  </div>

                  <Select
                    onValueChange={(val) => onMoveActivity(currentActivity.id, currentActivity.dayNumber, parseInt(val))}
                    value={currentActivity.dayNumber.toString()}
                  >
                    <SelectTrigger className="w-36 h-12 text-sm font-bold rounded-xl border-2 border-slate-200 bg-white hover:border-primary transition-all shadow-sm">
                      <SelectValue placeholder="Move" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl p-1 border-2">
                      {groupedDays.map((day) => (
                        <SelectItem
                          key={day.dayNumber}
                          value={day.dayNumber.toString()}
                          className="text-sm font-bold py-2 rounded-lg"
                        >
                          Day {day.dayNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Progress Sync Footer */}
        <div className="absolute bottom-0 inset-x-0 p-6 bg-white/50 backdrop-blur-sm border-t border-gray-200 flex flex-col items-center gap-4 z-20">
          <div className="flex gap-2">
            {flattenedActivities.map((a, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentIndex(idx);
                  if (a.dayNumber !== selectedDayNumber && onSelectDay) {
                    onSelectDay(a.dayNumber);
                  }
                }}
                className={`transition-all duration-300 rounded-full h-3 ${idx === currentIndex
                  ? "w-14 bg-gray-900"
                  : a.dayNumber === selectedDay.dayNumber
                    ? "w-3 bg-gray-300 hover:bg-gray-400"
                    : "w-2 bg-gray-200"
                  }`}
              />
            ))}
          </div>
          <p className="text-xs font-medium text-gray-300 uppercase tracking-[0.2em]">
            Reviewing {indexInDay + 1} of {activitiesOnThisDay.length} Activities on Day {selectedDay.dayNumber}
          </p>
        </div>
      </div>
    </div>
  );
}
