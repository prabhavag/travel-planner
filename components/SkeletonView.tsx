"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { TripInfo, Skeleton, ExpandedDay } from "@/lib/api-client";

interface SkeletonViewProps {
  skeleton: Skeleton;
  tripInfo: TripInfo | null;
  expandedDays: Record<number, ExpandedDay>;
  currentExpandDay: number | null;
  onExpandDay?: (dayNumber: number) => void;
}

export default function SkeletonView({
  skeleton,
  tripInfo,
  expandedDays,
  currentExpandDay,
  onExpandDay,
}: SkeletonViewProps) {
  if (!skeleton || !skeleton.days || skeleton.days.length === 0) {
    return null;
  }

  const isExpanded = (dayNumber: number) => {
    return expandedDays && expandedDays[dayNumber];
  };

  const isCurrent = (dayNumber: number) => {
    return dayNumber === currentExpandDay;
  };

  const getDayStatus = (dayNumber: number) => {
    if (isExpanded(dayNumber)) return "expanded";
    if (isCurrent(dayNumber)) return "current";
    return "pending";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "expanded":
        return "bg-green-500";
      case "current":
        return "bg-blue-500";
      case "pending":
        return "bg-gray-400";
      default:
        return "bg-gray-400";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "expanded":
        return "Planned";
      case "current":
        return "Planning";
      case "pending":
        return "Pending";
      default:
        return "Pending";
    }
  };

  const expandedCount = Object.keys(expandedDays || {}).length;
  const progressPercent = (expandedCount / skeleton.days.length) * 100;

  return (
    <div className="p-4 bg-gray-100">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Trip Overview</h2>

      {tripInfo && (
        <div className="mb-4">
          <p className="text-base font-semibold text-blue-600">
            {tripInfo.destination} | {tripInfo.durationDays} days
          </p>
          <p className="text-sm text-gray-500 mt-0.5">
            {tripInfo.startDate} to {tripInfo.endDate}
          </p>
        </div>
      )}

      <Progress value={progressPercent} className="h-2 mb-1" />
      <p className="text-xs text-gray-500 mb-4">
        {expandedCount} of {skeleton.days.length} days planned
      </p>

      <div className="space-y-3">
        {skeleton.days.map((day) => {
          const status = getDayStatus(day.dayNumber);
          const expanded = expandedDays?.[day.dayNumber];

          return (
            <Card
              key={day.dayNumber}
              className={`cursor-pointer transition-all hover:shadow-md ${
                isCurrent(day.dayNumber) ? "ring-2 ring-blue-500" : ""
              }`}
              onClick={() => onExpandDay?.(day.dayNumber)}
            >
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-blue-600">Day {day.dayNumber}</h3>
                    <Badge className={`${getStatusColor(status)} text-white text-xs`}>
                      {getStatusLabel(status)}
                    </Badge>
                  </div>
                  <span className="text-sm text-gray-500">{day.date}</span>
                </div>

                <p className="text-base font-semibold text-gray-700 mb-3">{day.theme}</p>

                <div className="bg-gray-50 p-3 rounded-lg">
                  {day.highlights.map((highlight, idx) => (
                    <div key={idx} className="flex items-start gap-2 mb-1 last:mb-0">
                      <span className="text-blue-500">•</span>
                      <span className="text-sm text-gray-600">{highlight}</span>
                    </div>
                  ))}
                </div>

                {expanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Today&apos;s Plan:</p>

                    {/* Breakfast */}
                    {expanded.breakfast && (
                      <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg mb-1.5">
                        <span className="text-lg">🍳</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">{expanded.breakfast.name}</p>
                          <p className="text-xs text-gray-500">{expanded.breakfast.timeSlot}</p>
                        </div>
                      </div>
                    )}

                    {/* Morning Activities */}
                    {expanded.morning?.map((act, idx) => (
                      <div key={`morning-${idx}`} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg mb-1.5">
                        <span className="text-lg">🌅</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">{act.name}</p>
                          <p className="text-xs text-blue-600">{act.time}</p>
                        </div>
                      </div>
                    ))}

                    {/* Lunch */}
                    {expanded.lunch && (
                      <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg mb-1.5">
                        <span className="text-lg">🍽️</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">{expanded.lunch.name}</p>
                          <p className="text-xs text-gray-500">{expanded.lunch.timeSlot}</p>
                        </div>
                      </div>
                    )}

                    {/* Afternoon Activities */}
                    {expanded.afternoon?.map((act, idx) => (
                      <div key={`afternoon-${idx}`} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg mb-1.5">
                        <span className="text-lg">☀️</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">{act.name}</p>
                          <p className="text-xs text-blue-600">{act.time}</p>
                        </div>
                      </div>
                    ))}

                    {/* Dinner */}
                    {expanded.dinner && (
                      <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg mb-1.5">
                        <span className="text-lg">🍷</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">{expanded.dinner.name}</p>
                          <p className="text-xs text-gray-500">{expanded.dinner.timeSlot}</p>
                        </div>
                      </div>
                    )}

                    {/* Evening Activities */}
                    {expanded.evening?.map((act, idx) => (
                      <div key={`evening-${idx}`} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg mb-1.5">
                        <span className="text-lg">🌙</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">{act.name}</p>
                          <p className="text-xs text-blue-600">{act.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
