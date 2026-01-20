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
            className="w-16 h-16 rounded-full bg-white shadow-xl hover:bg-gray-50 border border-gray-100 disabled:opacity-0 transition-all pointer-events-auto"
          >
            <ChevronLeft className="w-10 h-10 text-gray-800" />
          </Button>
        </div>

        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={nextActivity}
            disabled={currentIndex === flattenedActivities.length - 1}
            className="w-16 h-16 rounded-full bg-white shadow-xl hover:bg-gray-50 border border-gray-100 disabled:opacity-0 transition-all pointer-events-auto"
          >
            <ChevronRight className="w-10 h-10 text-gray-800" />
          </Button>
        </div>

        {/* Scrollable Content Viewport */}
        <div className="absolute inset-0 overflow-y-auto px-20 py-10 flex justify-center">
          {/* Large Focusing Card - Two Column Header */}
          <Card className="w-full max-w-[95%] h-fit min-h-full overflow-hidden border-0 shadow-[0_30px_60px_rgba(0,0,0,0.12)] flex flex-col rounded-[2.5rem] bg-white">
            <div className="flex flex-col md:flex-row border-b border-gray-100">
              {/* Left Column: Image */}
              {currentActivity.photo_url ? (
                <div className="w-full md:w-[400px] h-[300px] md:h-auto overflow-hidden bg-gray-50 flex-shrink-0 relative group">
                  <img
                    src={currentActivity.photo_url}
                    alt={currentActivity.name}
                    className="w-full h-full object-cover transition-transform duration-[3000ms] group-hover:scale-105"
                  />
                </div>
              ) : (
                <div className="w-full md:w-[400px] h-48 md:h-auto bg-slate-900 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-12 h-12 text-slate-700" />
                </div>
              )}

              {/* Right Column: Title & Badge */}
              <div className="flex-1 p-8 flex flex-col justify-center">
                <div className="flex items-center gap-3 mb-4">
                  <Badge className="px-3 py-1 bg-gray-900 hover:bg-black border-0 text-white font-bold uppercase tracking-widest text-[10px]">
                    {currentActivity.type}
                  </Badge>
                  {currentActivity.rating && (
                    <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1 rounded-full border border-amber-100">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-medium text-amber-900">{currentActivity.rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>
                <h1 className="text-4xl font-bold text-gray-900 leading-tight">{currentActivity.name}</h1>
              </div>
            </div>
            <CardContent className="p-8 space-y-10">
              <section className="space-y-4">
                <h4 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-400">Activity Details</h4>
                <p className="text-xl text-gray-600 leading-relaxed font-normal">
                  {currentActivity.description}
                </p>
              </section>

              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-3 px-6 py-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <Clock className="w-6 h-6 text-gray-400" />
                  <span className="text-lg font-medium text-gray-700">{currentActivity.estimatedDuration}</span>
                </div>
              </div>

              {/* Organization Controls - Move Activity */}
              <div className="pt-10 border-t border-gray-100">
                <div className="flex items-center justify-between p-8 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-white shadow-md flex items-center justify-center">
                      <ArrowRightLeft className="w-7 h-7 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">Move Activity</p>
                      <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Change which day this belongs to</p>
                    </div>
                  </div>

                  <Select
                    onValueChange={(val) => onMoveActivity(currentActivity.id, currentActivity.dayNumber, parseInt(val))}
                    value={currentActivity.dayNumber.toString()}
                  >
                    <SelectTrigger className="w-48 h-16 text-lg font-bold rounded-2xl border-2 border-slate-200 bg-white hover:border-primary transition-all shadow-sm">
                      <SelectValue placeholder="Move to Day" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl p-2 border-2">
                      {groupedDays.map((day) => (
                        <SelectItem
                          key={day.dayNumber}
                          value={day.dayNumber.toString()}
                          className="text-lg font-bold py-3 rounded-xl"
                        >
                          Move to Day {day.dayNumber}
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
