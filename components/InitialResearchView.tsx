"use client";

import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ChevronUp, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ResearchOption, TripInfo, TripResearchBrief } from "@/lib/api-client";
import { ResearchOptionCard } from "@/components/ResearchOptionCard";

const HOURLY_TIME_OPTIONS = [
  "12:00 AM",
  "1:00 AM",
  "2:00 AM",
  "3:00 AM",
  "4:00 AM",
  "5:00 AM",
  "6:00 AM",
  "7:00 AM",
  "8:00 AM",
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
  "7:00 PM",
  "8:00 PM",
  "9:00 PM",
  "10:00 PM",
  "11:00 PM",
] as const;

function parseHourMinuteAmPmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  const minute = Number(match[2] || "0");
  if (match[3].toUpperCase() === "PM") hour += 12;
  if (minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

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
  onUpdateTravelLogistics: (updates: Partial<TripInfo>) => Promise<void>;
  canProceed?: boolean;
  isLoading?: boolean;
  headerActions?: ReactNode;
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
  onUpdateTravelLogistics,
  canProceed = true,
  isLoading = false,
  headerActions = null,
}: InitialResearchViewProps) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [activeInterest, setActiveInterest] = useState<string>("All");
  const [collapseSelectedCards, setCollapseSelectedCards] = useState(true);
  const [collapsedSelectedById, setCollapsedSelectedById] = useState<Record<string, boolean>>({});
  const [arrivalAirportInput, setArrivalAirportInput] = useState(tripInfo?.arrivalAirport || "");
  const [departureAirportInput, setDepartureAirportInput] = useState(tripInfo?.departureAirport || "");
  const selectedGridRef = useRef<HTMLDivElement | null>(null);
  const selectedCardRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const shouldAnimateSelectedGridRef = useRef(false);

  const scrollYRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (scrollYRef.current !== null) {
      window.scrollTo(0, scrollYRef.current);
      scrollYRef.current = null;
    }
  });

  useEffect(() => {
    setArrivalAirportInput(tripInfo?.arrivalAirport || "");
  }, [tripInfo?.arrivalAirport]);

  useEffect(() => {
    setDepartureAirportInput(tripInfo?.departureAirport || "");
  }, [tripInfo?.departureAirport]);

  const captureSelectedCardPositions = useCallback(() => {
    const grid = selectedGridRef.current;
    if (!grid) return;
    const nextRects = new Map<string, DOMRect>();
    const cards = grid.querySelectorAll<HTMLElement>("[data-selected-option-id]");
    cards.forEach((card) => {
      const optionId = card.dataset.selectedOptionId;
      if (!optionId) return;
      nextRects.set(optionId, card.getBoundingClientRect());
    });
    selectedCardRectsRef.current = nextRects;
    shouldAnimateSelectedGridRef.current = nextRects.size > 0;
  }, []);

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
  const selectedSet = useMemo(() => new Set(selectedOptionIds), [selectedOptionIds]);

  const overviewOpening = useMemo(() => {
    if (!researchBrief.summary) return "";
    const parts = researchBrief.summary
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.slice(0, 2).join(" ");
  }, [researchBrief.summary]);

  const logisticsAssumptions = useMemo(() => {
    const items: string[] = [];
    const transportMode = tripInfo?.transportMode || "flight";
    const arrivalTime = tripInfo?.arrivalTimePreference || "12:00 PM";
    const departureTime = tripInfo?.departureTimePreference || "6:00 PM";
    const arrivalMinutes = parseHourMinuteAmPmToMinutes(arrivalTime) ?? 12 * 60;

    if (transportMode === "flight") {
      const airportName = tripInfo?.arrivalAirport || tripInfo?.departureAirport || "the most common destination airport";
      items.push(`Assuming air travel via ${airportName}; you can edit this airport.`);
    } else {
      items.push(`Assuming intercity travel by ${transportMode}.`);
    }

    items.push(`Assumed arrival time: ${arrivalTime}.`);
    items.push(`Assumed departure time: ${departureTime}.`);

    if (arrivalMinutes < 12 * 60) {
      items.push(`Arrival at ${arrivalTime}: day 1 starts from the airport area.`);
    } else {
      items.push(`Arrival at ${arrivalTime}: check into hotel first, then add activities if time remains.`);
    }

    items.push(
      `Departure at ${departureTime}: reserve time for checkout and, if applicable, rental-car return before heading out.`
    );
    return items;
  }, [tripInfo?.arrivalAirport, tripInfo?.departureAirport, tripInfo?.transportMode, tripInfo?.arrivalTimePreference, tripInfo?.departureTimePreference]);

  const displayAssumptions = useMemo(() => {
    const combined = [...logisticsAssumptions, ...researchBrief.assumptions];
    return Array.from(new Set(combined.map((item) => item.trim()).filter(Boolean)));
  }, [logisticsAssumptions, researchBrief.assumptions]);

  const selectedArrivalTime = useMemo(() => {
    const value = tripInfo?.arrivalTimePreference || "12:00 PM";
    return HOURLY_TIME_OPTIONS.includes(value as (typeof HOURLY_TIME_OPTIONS)[number]) ? value : "12:00 PM";
  }, [tripInfo?.arrivalTimePreference]);

  const selectedDepartureTime = useMemo(() => {
    const value = tripInfo?.departureTimePreference || "6:00 PM";
    return HOURLY_TIME_OPTIONS.includes(value as (typeof HOURLY_TIME_OPTIONS)[number]) ? value : "6:00 PM";
  }, [tripInfo?.departureTimePreference]);

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

  const selectedVisibleOptions = useMemo(() => {
    const visibleById = new Map(visibleOptions.map((option) => [option.id, option]));
    const orderedSelected = selectedOptionIds
      .map((id) => visibleById.get(id))
      .filter((option): option is ResearchOption => Boolean(option));

    const collapsedQueue: ResearchOption[] = [];
    const expandedQueue: ResearchOption[] = [];

    orderedSelected.forEach((option) => {
      const isCollapsed = collapsedSelectedById[option.id] ?? collapseSelectedCards;
      if (isCollapsed) {
        collapsedQueue.push(option);
      } else {
        expandedQueue.push(option);
      }
    });

    return [...collapsedQueue, ...expandedQueue];
  }, [visibleOptions, selectedOptionIds, collapsedSelectedById, collapseSelectedCards]);
  const unselectedVisibleOptions = useMemo(
    () => visibleOptions.filter((option) => !selectedSet.has(option.id)),
    [visibleOptions, selectedSet]
  );

  useEffect(() => {
    setCollapsedSelectedById((prev) => {
      const next: Record<string, boolean> = {};
      selectedOptionIds.forEach((id) => {
        next[id] = prev[id] ?? collapseSelectedCards;
      });
      return next;
    });
  }, [selectedOptionIds, collapseSelectedCards]);

  useLayoutEffect(() => {
    if (!shouldAnimateSelectedGridRef.current) return;
    shouldAnimateSelectedGridRef.current = false;
    const grid = selectedGridRef.current;
    if (!grid) return;
    const prevRects = selectedCardRectsRef.current;
    if (!prevRects.size) return;

    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-selected-option-id]"));
    const movedCards: HTMLElement[] = [];

    cards.forEach((card) => {
      const optionId = card.dataset.selectedOptionId;
      if (!optionId) return;
      const previousRect = prevRects.get(optionId);
      if (!previousRect) return;
      const nextRect = card.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

      movedCards.push(card);
      card.style.transition = "none";
      card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      card.style.willChange = "transform";
    });

    if (!movedCards.length) return;

    requestAnimationFrame(() => {
      movedCards.forEach((card) => {
        card.style.transition = "transform 320ms cubic-bezier(0.22, 1, 0.36, 1) 120ms";
        card.style.transform = "translate(0, 0)";
        const clearStyles = () => {
          card.style.transition = "";
          card.style.transform = "";
          card.style.willChange = "";
        };
        card.addEventListener("transitionend", clearStyles, { once: true });
      });
    });
  }, [collapsedSelectedById, collapseSelectedCards, selectedVisibleOptions]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between bg-white py-2 px-4">
        <div>
          <h2 className="text-lg font-semibold">Let&apos;s plan your trip together</h2>
          <p className="text-sm text-gray-500">Select the cards that fit your trip, then continue to day grouping.</p>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
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
            {derivedDuration != null && currentDuration != null && derivedDuration > currentDuration
              ? `${derivedDuration} day(s) (including 2 travel days)`
              : derivedDuration != null
                ? `${derivedDuration} day(s)`
                : currentDuration != null
                  ? `${currentDuration} day(s)`
                  : "Not set"}
          </p>
          <p>
            <span className="text-gray-500">Pace:</span> {tripInfo?.activityLevel || "Not set"}
          </p>
          <p>
            <span className="text-gray-500">Dietary constraints:</span>{" "}
            {dietaryHints.length > 0 ? dietaryHints.join(", ") : "None specified"}
          </p>
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Travel Logistics</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <p className="text-xs text-gray-500 mb-1">Transport mode</p>
                <Select
                  value={tripInfo?.transportMode || "flight"}
                  onValueChange={(value) => onUpdateTravelLogistics({ transportMode: value as TripInfo["transportMode"] })}
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flight">Flight</SelectItem>
                    <SelectItem value="train">Train</SelectItem>
                    <SelectItem value="car">Car</SelectItem>
                    <SelectItem value="bus">Bus</SelectItem>
                    <SelectItem value="ferry">Ferry</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Arrival timing</p>
                <Select
                  value={selectedArrivalTime}
                  onValueChange={(value) =>
                    onUpdateTravelLogistics({ arrivalTimePreference: value })
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURLY_TIME_OPTIONS.map((option) => (
                      <SelectItem key={`arrival-${option}`} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Departure timing</p>
                <Select
                  value={selectedDepartureTime}
                  onValueChange={(value) =>
                    onUpdateTravelLogistics({ departureTimePreference: value })
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURLY_TIME_OPTIONS.map((option) => (
                      <SelectItem key={`departure-${option}`} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(tripInfo?.transportMode || "flight") === "flight" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Arrival airport</p>
                  <Input
                    value={arrivalAirportInput}
                    placeholder="Most common airport (editable)"
                    className="h-9"
                    onChange={(event) => setArrivalAirportInput(event.target.value)}
                    onBlur={() =>
                      onUpdateTravelLogistics({
                        arrivalAirport: arrivalAirportInput.trim() || null,
                      })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Departure airport</p>
                  <Input
                    value={departureAirportInput}
                    placeholder="Defaults to same airport"
                    className="h-9"
                    onChange={(event) => setDepartureAirportInput(event.target.value)}
                    onBlur={() =>
                      onUpdateTravelLogistics({
                        departureAirport: departureAirportInput.trim() || null,
                      })
                    }
                    disabled={isLoading}
                  />
                </div>
              </div>
            ) : null}
          </div>
          {displayAssumptions.length > 0 ? (
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
                  {displayAssumptions.map((item, idx) => (
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
          {selectedOptionIds.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                captureSelectedCardPositions();
                const nextCollapsed = !collapseSelectedCards;
                setCollapseSelectedCards(nextCollapsed);
                setCollapsedSelectedById((current) => {
                  const next = { ...current };
                  selectedOptionIds.forEach((id) => {
                    next[id] = nextCollapsed;
                  });
                  return next;
                });
              }}
              disabled={isLoading}
            >
              {collapseSelectedCards ? "Expand selected" : "Collapse selected"}
            </Button>
          ) : null}
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
          <div className="space-y-4">
            {selectedVisibleOptions.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">Selected ({selectedVisibleOptions.length})</p>
                <div ref={selectedGridRef} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedVisibleOptions.map((option) => (
                    <div key={option.id} data-selected-option-id={option.id}>
                      <ResearchOptionCard
                        option={option}
                        isSelected={true}
                        collapsed={collapsedSelectedById[option.id] ?? collapseSelectedCards}
                        onToggleCollapse={() => {
                          captureSelectedCardPositions();
                          const nextCollapsed = !(collapsedSelectedById[option.id] ?? collapseSelectedCards);
                          setCollapsedSelectedById((prev) => ({
                            ...prev,
                            [option.id]: nextCollapsed,
                          }));
                        }}
                        onToggleSelect={(id) => onSelectionChange(id, false)}
                        onDeepResearch={onDeepResearchOption}
                        onRemove={onRemoveOption}
                        deepResearchLoading={isLoading && deepResearchOptionId === option.id}
                        deepResearchDisabled={isLoading && deepResearchOptionId !== option.id}
                        lastDeepResearchAt={lastDeepResearchAtByOptionId[option.id]}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {unselectedVisibleOptions.map((option) => (
                <ResearchOptionCard
                  key={option.id}
                  option={option}
                  isSelected={false}
                  onToggleSelect={(id) => onSelectionChange(id, true)}
                  onDeepResearch={onDeepResearchOption}
                  onRemove={onRemoveOption}
                  deepResearchLoading={isLoading && deepResearchOptionId === option.id}
                  deepResearchDisabled={isLoading && deepResearchOptionId !== option.id}
                  lastDeepResearchAt={lastDeepResearchAtByOptionId[option.id]}
                />
              ))}
            </div>
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
