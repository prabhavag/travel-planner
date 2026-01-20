"use client";

import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/lib/utils/date";

interface DayTabsProps {
  days: { dayNumber: number; date: string }[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
  className?: string;
}

export function DayTabs({ days, selectedDay, onSelectDay, className }: DayTabsProps) {
  return (
    <div className={cn("flex overflow-x-auto no-scrollbar bg-white border-b border-gray-200 sticky top-0 z-20 p-1 gap-1", className)}>
      {days.map((day) => {
        const isSelected = selectedDay === day.dayNumber;
        return (
          <button
            key={day.dayNumber}
            onClick={() => onSelectDay(day.dayNumber)}
            className={cn(
              "flex flex-col items-center justify-center px-4 py-2 rounded-md transition-all min-w-[100px] flex-shrink-0",
              isSelected
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            )}
          >
            <span className="text-xs font-semibold uppercase tracking-wider">
              Day {day.dayNumber}
            </span>
            <span className={cn(
                "text-[10px] font-medium opacity-80",
                isSelected ? "text-blue-50" : "text-gray-500"
            )}>
              {formatDisplayDate(day.date)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
