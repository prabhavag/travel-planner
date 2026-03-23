const fs = require('fs');

const path = 'components/DayGroupingView.tsx';
const content = fs.readFileSync(path, 'utf-8');
const lines = content.split('\n');

const startIdx = lines.findIndex(l => l.includes('const DayTimelineRows = ({'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l === '  };' && lines[i+2] === '  return (');

if (startIdx === -1 || endIdx === -1) {
  console.error("Could not find DayTimelineRows bounds", startIdx, endIdx);
  process.exit(1);
}

const functionBodyLines = lines.slice(startIdx, endIdx + 1);

// Remove the function body from DayGroupingView.tsx
const newViewLines = [
  ...lines.slice(0, startIdx),
  ...lines.slice(endIdx + 1)
];

// We need to transform the signature. The old signature spans multiple lines.
// We'll replace lines from 'const DayTimelineRows = ({' up to '  }) => {'
const sigEndIdx = functionBodyLines.findIndex(l => l.includes('  }) => {'));

const innerBody = functionBodyLines.slice(sigEndIdx + 1, functionBodyLines.length - 1).join('\n');

const newComponentContent = `import { useMemo, useEffect, type DragEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Home, AlertTriangle, Utensils } from "lucide-react";
import type { GroupedDay, SuggestedActivity } from "@/lib/api-client";
import { DayActivityItem } from "@/components/DayActivityItem";
import {
  type CommuteMode,
  formatHourLabel,
  toClockLabel,
  roundToQuarter,
  LUNCH_BLOCK_MINUTES,
} from "@/lib/utils/timeline-utils";

type DayTabKey = number | "unscheduled";

export interface DayTimelineRowsProps {
  day: GroupedDay;
  rawDay?: GroupedDay;
  dayIndex: number;
  startStayLabel?: string | null;
  endStayLabel?: string | null;
  startStayCoordinates?: { lat: number; lng: number } | null;
  endStayCoordinates?: { lat: number; lng: number } | null;
  
  // Callbacks and context from parent
  isFinalDepartureDay: boolean;
  startContext: any; // we'll type this as any to avoid exporting the type
  regroupSchedulableActivitiesForDay: (args: any) => { scheduledActivities: SuggestedActivity[], prunedActivities: SuggestedActivity[] };
  
  // State from parent
  unscheduledSyncSignatureByDayRef: React.MutableRefObject<Record<number, string>>;
  setUnscheduledByDay: React.Dispatch<React.SetStateAction<Record<number, SuggestedActivity[]>>>;
  
  // UI preferences and display state
  debugMode?: boolean;
  userPreferences?: string[];
  displayGroupedDays: GroupedDay[];
  collapsedActivityCards: Record<string, boolean>;
  movingActivity: { id: string; fromDay: number } | null;
  dragInsertion: { dayNumber: number; index: number } | null;
  draggedActivity: { id: string; dayNumber: number; index: number } | null;
  sourceDayByActivityId: Record<string, number>;
  
  // Handlers
  onDayDragOver: (event: DragEvent<HTMLDivElement>, dayNumber: number, activitiesLength: number) => void;
  onActivityDrop: (event: DragEvent<HTMLDivElement>, dayNumber: number, fallbackIndex: number) => void;
  onActivityDragStart: (event: DragEvent<HTMLDivElement>, activityId: string, dayNumber: number, index: number) => void;
  onActivityDragOver: (event: DragEvent<HTMLDivElement>, dayNumber: number, index: number) => void;
  onActivityDragEnd: () => void;
  onToggleCollapse: (activityId: string) => void;
  onMoveStart: (activityId: string, fromDay: number) => void;
  onMoveConfirm: (toDay: number) => void;
  onMoveCancel: () => void;
}

export function DayTimelineRows({
  day,
  rawDay,
  dayIndex,
  startStayLabel,
  endStayLabel,
  startStayCoordinates,
  endStayCoordinates,
  
  isFinalDepartureDay,
  startContext,
  regroupSchedulableActivitiesForDay,
  
  unscheduledSyncSignatureByDayRef,
  setUnscheduledByDay,
  
  debugMode,
  userPreferences,
  displayGroupedDays,
  collapsedActivityCards,
  movingActivity,
  dragInsertion,
  draggedActivity,
  sourceDayByActivityId,
  
  onDayDragOver: handleDayDragOver,
  onActivityDrop: handleActivityDrop,
  onActivityDragStart: handleActivityDragStart,
  onActivityDragOver: handleActivityDragOver,
  onActivityDragEnd: handleActivityDragEnd,
  onToggleCollapse: toggleActivityCollapse,
  onMoveStart: handleMoveStart,
  onMoveConfirm: handleMoveConfirm,
  onMoveCancel: handleMoveCancel,
}: DayTimelineRowsProps) {
${innerBody}
}
`;

fs.writeFileSync('components/DayTimelineRows.tsx', newComponentContent);

// Also insert the import at the top of DayGroupingView
const importIdx = newViewLines.findIndex(l => l.includes('import { DayActivityItem }'));
newViewLines.splice(importIdx + 1, 0, 'import { DayTimelineRows } from "@/components/DayTimelineRows";');

fs.writeFileSync('components/DayGroupingView.tsx', newViewLines.join('\n'));

console.log("Done extracting DayTimelineRows!");
