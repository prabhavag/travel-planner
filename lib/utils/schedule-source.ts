import type { DayGroup } from "@/lib/models/travel-plan";
import type { ScheduleState } from "@/lib/services/day-grouping";

export function chooseAuthoritativeScheduleBase({
  currentSchedule,
  legacyDayGroups,
  legacyUnassignedActivityIds,
}: {
  currentSchedule: ScheduleState | null | undefined;
  legacyDayGroups: DayGroup[];
  legacyUnassignedActivityIds: string[];
}): {
  dayGroups: DayGroup[];
  unassignedActivityIds: string[];
  source: "currentSchedule" | "legacy";
} {
  if (currentSchedule && currentSchedule.dayGroups.length > 0) {
    return {
      dayGroups: currentSchedule.dayGroups,
      unassignedActivityIds: currentSchedule.unassignedActivityIds,
      source: "currentSchedule",
    };
  }

  return {
    dayGroups: legacyDayGroups,
    unassignedActivityIds: legacyUnassignedActivityIds,
    source: "legacy",
  };
}
