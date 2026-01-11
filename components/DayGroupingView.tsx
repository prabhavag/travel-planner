"use client";

import { useState } from "react";
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
import { Clock, ChevronRight, Star, MapPin } from "lucide-react";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";
import { getDayBadgeColors, getDayColor } from "@/lib/constants";

interface DayGroupingViewProps {
  groupedDays: GroupedDay[];
  onMoveActivity: (activityId: string, fromDay: number, toDay: number) => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DayGroupingView({
  groupedDays,
  onMoveActivity,
  onConfirm,
  isLoading = false,
}: DayGroupingViewProps) {
  const [movingActivity, setMovingActivity] = useState<{
    id: string;
    fromDay: number;
  } | null>(null);

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

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
    index,
  }: {
    activity: SuggestedActivity;
    dayNumber: number;
    index: number;
  }) => {
    const isMoving = movingActivity?.id === activity.id;

    return (
      <div
        className={`p-3 bg-white rounded-lg border ${isMoving ? "ring-2 ring-primary bg-primary/5" : "hover:shadow-sm"
          }`}
        style={{ borderLeft: `4px solid ${getDayColor(dayNumber)}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-400 font-mono text-xs">#{index + 1}</span>
              <span className="font-medium text-sm truncate">{activity.name}</span>
              <Badge variant="secondary" className={`${getActivityTypeColor(activity.type)} text-xs`}>
                {activity.type}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{activity.estimatedDuration}</span>
              </div>
              {activity.rating && (
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  <span>{activity.rating.toFixed(1)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex-shrink-0">
            {isMoving ? (
              <div className="flex items-center gap-1">
                <Select onValueChange={(val) => handleMoveConfirm(parseInt(val))}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue placeholder="Move to" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupedDays.map((day) => (
                      <SelectItem key={day.dayNumber} value={day.dayNumber.toString()}>
                        Day {day.dayNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={handleMoveCancel} className="h-8 px-2">
                  ✕
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleMoveStart(activity.id, dayNumber)}
                className="h-8 px-2 text-xs text-gray-500 hover:text-gray-700"
              >
                Move
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 bg-white z-10 py-2">
        <div>
          <h2 className="text-lg font-semibold">Organize Your Days</h2>
          <p className="text-sm text-gray-500">
            Review the grouping or move activities between days
          </p>
        </div>
        <Button onClick={onConfirm} disabled={isLoading} className="bg-primary text-white">
          {isLoading ? "Confirming..." : "Confirm Grouping"}
        </Button>
      </div>

      {/* Days grid */}
      <div className="space-y-4">
        {groupedDays.map((day) => (
          <Card key={day.dayNumber} className="overflow-hidden">
            <CardHeader className="pb-2 bg-gray-50">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className={`${getDayBadgeColors(day.dayNumber)} rounded-full w-7 h-7 flex items-center justify-center text-sm`}>
                      {day.dayNumber}
                    </span>
                    <span>{day.theme}</span>
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-1">{formatDate(day.date)}</p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {day.activities.length} {day.activities.length === 1 ? "activity" : "activities"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              {day.activities.length === 0 ? (
                <div className="text-center py-4 text-gray-400 text-sm">
                  No activities - move some here
                </div>
              ) : (
                <div className="space-y-2">
                  {day.activities.map((activity, index) => (
                    <ActivityCard
                      key={activity.id}
                      activity={activity}
                      dayNumber={day.dayNumber}
                      index={index}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
