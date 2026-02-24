"use client";

import { useMemo, useState, useRef, useLayoutEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ChevronUp, RefreshCw } from "lucide-react";
import type { ResearchOption, TripInfo, TripResearchBrief } from "@/lib/api-client";
import { ResearchOptionCard } from "@/components/ResearchOptionCard";

interface InitialResearchViewProps {
  tripInfo: TripInfo | null;
  researchBrief: TripResearchBrief | null;
  selectedOptionIds: string[];
  onSelectionChange: (optionId: string, selected: boolean) => void;
  onResolveDurationConflict: (mode: "use_date_range" | "keep_requested_duration") => void;
  hasUnresolvedAssumptionConflicts: boolean;
  onRegenerate: () => void;
  onDeepResearchAll: () => void;
  onDeepResearchOption: (optionId: string) => void;
  onRemoveOption?: (optionId: string) => void;
  deepResearchOptionId?: string | null;
  lastDeepResearchAtByOptionId?: Record<string, string>;
  onProceed: () => void;
  canProceed?: boolean;
  isLoading?: boolean;
}

export function InitialResearchView({
  tripInfo,
  researchBrief,
  selectedOptionIds,
  onSelectionChange,
  onResolveDurationConflict,
  hasUnresolvedAssumptionConflicts,
  onRegenerate,
  onDeepResearchAll,
  onDeepResearchOption,
  onRemoveOption,
  deepResearchOptionId = null,
  lastDeepResearchAtByOptionId = {},
  onProceed,
  canProceed = true,
  isLoading = false,
}: InitialResearchViewProps) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [activeInterest, setActiveInterest] = useState<string>("All");

  const scrollYRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (scrollYRef.current !== null) {
      window.scrollTo(0, scrollYRef.current);
      scrollYRef.current = null;
    }
  });

  if (!researchBrief) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 text-center text-gray-600">
            Generate an initial research brief to review options before creating activities.
          </CardContent>
        </Card>
      </div>
    );
  }

  const getDerivedDurationFromDates = (): number | null => {
    if (!tripInfo?.startDate || !tripInfo?.endDate) return null;
    const start = new Date(tripInfo.startDate);
    const end = new Date(tripInfo.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  const derivedDuration = getDerivedDurationFromDates();
  const currentDuration = tripInfo?.durationDays ?? null;
  const hasDurationConflict =
    derivedDuration != null &&
    currentDuration != null &&
    derivedDuration > 0 &&
    currentDuration > 0 &&
    Math.abs(derivedDuration - currentDuration) > 1;
  const allPreferences = tripInfo?.preferences || [];
  const dietaryHints = allPreferences.filter((item) =>
    /vegetarian|vegan|no meat|no seafood|halal|kosher|gluten/i.test(item)
  );
  const selectedSet = new Set(selectedOptionIds);

  const overviewOpening = useMemo(() => {
    if (!researchBrief.summary) return "";
    const parts = researchBrief.summary
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.slice(0, 2).join(" ");
  }, [researchBrief.summary]);

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const matchesInterest = (option: ResearchOption, interest: string) => {
    if (interest === "All" || interest === "Other") return true;
    const normalizedPref = normalize(interest);
    const category = normalize(option.category);
    const why = normalize(option.whyItMatches || "");
    return category.includes(normalizedPref) || normalizedPref.includes(category) || why.includes(normalizedPref);
  };

  const interestTabsList = useMemo(() => {
    const tabs = new Set<string>(["All"]);
    researchBrief.popularOptions.forEach((option) => {
      allPreferences.forEach((pref) => {
        if (matchesInterest(option, pref)) {
          tabs.add(pref);
        }
      });
    });

    const hasOther = researchBrief.popularOptions.some((option) => {
      return !allPreferences.some((pref) => matchesInterest(option, pref));
    });

    if (hasOther) tabs.add("Other");
    return Array.from(tabs);
  }, [allPreferences, researchBrief.popularOptions]);

  const interestCounts = useMemo(() => {
    const counts: Record<string, number> = { All: researchBrief.popularOptions.length };
    interestTabsList.forEach((tab) => {
      if (tab === "All") return;
      counts[tab] = researchBrief.popularOptions.filter((opt) => {
        if (tab === "Other") {
          return !allPreferences.some((pref) => matchesInterest(opt, pref));
        }
        return matchesInterest(opt, tab);
      }).length;
    });
    return counts;
  }, [interestTabsList, researchBrief.popularOptions, allPreferences]);

  const visibleOptions = useMemo(() => {
    return researchBrief.popularOptions.filter((option) => {
      if (activeInterest === "All") return true;
      if (activeInterest === "Other") {
        return !allPreferences.some((pref) => matchesInterest(option, pref));
      }
      return matchesInterest(option, activeInterest);
    });
  }, [activeInterest, researchBrief.popularOptions, allPreferences]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between bg-white py-2 px-4">
        <div>
          <h2 className="text-lg font-semibold">Let&apos;s plan your trip together</h2>
          <p className="text-sm text-gray-500">Select the cards that fit your trip, then continue to day grouping.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isLoading}
            title="Uses current suggestions as context to generate better/new ones"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Update or get more suggestions
          </Button>
          <Button size="sm" onClick={onProceed} disabled={isLoading || hasUnresolvedAssumptionConflicts || !canProceed}>
            Proceed to organizing your trip
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      <Card className={hasUnresolvedAssumptionConflicts ? "border-amber-300 bg-amber-50/50" : ""}>
        <CardHeader>
          <CardTitle className="text-base">Trip Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-700">
          {overviewOpening ? <p className="text-sm leading-relaxed text-gray-800">{overviewOpening}</p> : null}
          <p>
            <span className="text-gray-500">Dates:</span>{" "}
            {tripInfo?.startDate && tripInfo?.endDate ? `${tripInfo.startDate} to ${tripInfo.endDate}` : "Not set"}
          </p>
          <p>
            <span className="text-gray-500">Trip length:</span>{" "}
            {currentDuration != null ? `${currentDuration} day(s)` : "Not set"}
            {derivedDuration != null ? ` (date range implies ${derivedDuration} day(s))` : ""}
          </p>
          <p>
            <span className="text-gray-500">Pace:</span> {tripInfo?.activityLevel || "Not set"}
          </p>
          <p>
            <span className="text-gray-500">Dietary constraints:</span>{" "}
            {dietaryHints.length > 0 ? dietaryHints.join(", ") : allPreferences.join(", ") || "None specified"}
          </p>
          {researchBrief.assumptions.length > 0 ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAssumptions((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
              >
                {showAssumptions ? "Hide assumptions" : "View assumptions"}
                {showAssumptions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showAssumptions ? (
                <ul className="mt-2 space-y-1">
                  {researchBrief.assumptions.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="text-sm text-gray-600 flex gap-1.5">
                      <span className="text-gray-400 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {hasDurationConflict ? (
            <div className="pt-2">
              <p className="text-amber-800 font-medium">Resolve duration conflict before generating activities.</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onResolveDurationConflict("use_date_range")}
                  disabled={isLoading || !derivedDuration}
                >
                  Use date range ({derivedDuration} days)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onResolveDurationConflict("keep_requested_duration")}
                  disabled={isLoading || !currentDuration}
                >
                  Keep requested duration ({currentDuration} days)
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-gray-900">Suggestions for you</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Tap cards to select the places you want included in your itinerary.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
            {selectedOptionIds.length} selected
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onDeepResearchAll}
            disabled={isLoading}
            title="Runs deeper web research for selected cards"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Research selected
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {interestTabsList.map((tab: string) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant={activeInterest === tab ? "default" : "outline"}
            onClick={() => {
              scrollYRef.current = window.scrollY;
              setActiveInterest(tab);
            }}
            className="whitespace-nowrap"
          >
            {tab} ({interestCounts[tab] || 0})
          </Button>
        ))}
        <span className="text-xs text-gray-500 ml-auto flex-shrink-0">Showing {visibleOptions.length} options</span>
      </div>

      <div className="min-h-[200px]">
        {visibleOptions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleOptions.map((option) => (
              <ResearchOptionCard
                key={option.id}
                option={option}
                isSelected={selectedSet.has(option.id)}
                onToggleSelect={(id) => onSelectionChange(id, !selectedSet.has(id))}
                onDeepResearch={onDeepResearchOption}
                onRemove={onRemoveOption}
                deepResearchLoading={isLoading && deepResearchOptionId === option.id}
                deepResearchDisabled={isLoading && deepResearchOptionId !== option.id}
                lastDeepResearchAt={lastDeepResearchAtByOptionId[option.id]}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center bg-gray-50/50 rounded-lg border border-dashed border-gray-200 h-full">
            <p className="text-gray-500 mb-3">
              No activities for <span className="font-medium text-gray-900">{activeInterest}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
