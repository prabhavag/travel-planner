import type { ScheduleState } from "@/lib/services/day-grouping";

function idsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function schedulesHaveSamePlacements(left: ScheduleState, right: ScheduleState): boolean {
  if (!idsEqual(left.unassignedActivityIds, right.unassignedActivityIds)) return false;
  if (left.dayGroups.length !== right.dayGroups.length) return false;

  return left.dayGroups.every((leftDay, index) => {
    const rightDay = right.dayGroups[index];
    if (!rightDay) return false;
    if (leftDay.dayNumber !== rightDay.dayNumber) return false;
    if (!idsEqual(leftDay.activityIds, rightDay.activityIds)) return false;
    return (leftDay.nightStay?.label ?? null) === (rightDay.nightStay?.label ?? null);
  });
}
