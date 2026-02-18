"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { SuggestedActivity } from "@/lib/api-client";
import { ActivityCard } from "@/components/ActivityCard";

interface ActivitySelectionViewProps {
  activities: SuggestedActivity[];
  selectedIds: string[];
  userPreferences?: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  onConfirm: () => void;
  onRegenerate: () => void;
  onHoverActivity?: (id: string | null) => void;
  isLoading?: boolean;
}

export function ActivitySelectionView({
  activities,
  selectedIds,
  userPreferences = [],
  onSelectionChange,
  onConfirm,
  onRegenerate,
  onHoverActivity,
  isLoading = false,
}: ActivitySelectionViewProps) {
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set(selectedIds));

  const toggleActivity = (id: string) => {
    const newSelected = new Set(localSelectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setLocalSelectedIds(newSelected);
    onSelectionChange(Array.from(newSelected));
  };

  const handleConfirm = () => {
    onConfirm();
  };


  return (
    <div className="space-y-4">
      {/* Header with selection count */}
      <div className="flex items-center justify-between bg-white py-2 px-4">
        <div>
          <h2 className="text-lg font-semibold">Select Activities</h2>
          <p className="text-sm text-gray-500">
            {localSelectedIds.size} of {activities.length} selected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isLoading}
            className="text-gray-500"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Regenerate
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={localSelectedIds.size === 0 || isLoading}
            className="bg-primary text-white"
          >
            {isLoading ? (
              "Organizing..."
            ) : (
              `Continue with ${localSelectedIds.size} ${localSelectedIds.size === 1 ? "activity" : "activities"}`
            )}
          </Button>
        </div>
      </div>

      {/* Activity grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activities.map((activity, index) => {
          const isSelected = localSelectedIds.has(activity.id);
          return (
            <ActivityCard
              key={activity.id}
              activity={activity}
              index={index}
              isSelected={isSelected}
              userPreferences={userPreferences}
              onClick={() => toggleActivity(activity.id)}
              onHoverActivity={onHoverActivity}
            />
          );
        })}
      </div>
    </div>
  );
}
