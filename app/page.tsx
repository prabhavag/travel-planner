"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, MessageSquare, Heart, ChevronLeft, ChevronRight, RefreshCw, ChevronUp, ChevronDown, Sparkles, AlertTriangle, X } from "lucide-react";
import MapComponent from "@/components/MapComponent";
import { InitialResearchView } from "@/components/InitialResearchView";
import { DayGroupingView } from "@/components/DayGroupingView";
import { DayItineraryView } from "@/components/DayItineraryView";
import { RestaurantSelectionView } from "@/components/RestaurantSelectionView";
import { AccommodationSuggestionsView } from "@/components/AccommodationSuggestionsView";
import { FlightSuggestionsView } from "@/components/FlightSuggestionsView";
import { TimelineInsightsPanel } from "@/components/TimelineInsightsPanel";
import {
  analyzeTimeline,
  startSession,
  agentTurn,
  generateResearchBrief,
  confirmResearchBrief,
  selectActivities,
  adjustDayGroups,
  setMealPreferences,
  updateTripInfo,
  updateWorkflowState,
  removeCard,
  deepResearchOption,
  deepResearchSelectedOptions,
  enrichResearchPhotos,
  applyLlmRefinementCandidate,
  runLlmRefinementStep,
  resolveLlmRefinementPreview,
  suggestAirport,
  type SessionResponse,
  type AiCheckResult,
  type LlmRefinementResult,
  type LlmRefinementPreview,
  type TripInfo,
  type SuggestedActivity,
  type ActivityCostDebug,
  type ScheduleState,
  type GroupedDay,
  type TripResearchBrief,
  type RestaurantSuggestion,
  type SubAgentStatus,
  type AccommodationOption,
  type FlightOption,
  type DayGroup,
} from "@/lib/api-client";
import { InterestsPreferencesView } from "@/components/InterestsPreferencesView";
import {
  extractTimelineVisits,
  type TimelineAnalysisResponse,
  type TimelineMapView,
} from "@/lib/timeline";
import { chooseScheduleBackedRefinementTotals } from "@/lib/utils/schedule-cost";

// Workflow states
const WORKFLOW_STATES = {
  INFO_GATHERING: "INFO_GATHERING",
  INITIAL_RESEARCH: "INITIAL_RESEARCH",
  SUGGEST_ACTIVITIES: "SUGGEST_ACTIVITIES",
  SELECT_ACTIVITIES: "SELECT_ACTIVITIES",
  GROUP_DAYS: "GROUP_DAYS",
  DAY_ITINERARY: "DAY_ITINERARY",
  MEAL_PREFERENCES: "MEAL_PREFERENCES",
  REVIEW: "REVIEW",
  FINALIZE: "FINALIZE",
};

const WORKFLOW_ORDER = [
  WORKFLOW_STATES.INFO_GATHERING,
  WORKFLOW_STATES.INITIAL_RESEARCH,
  WORKFLOW_STATES.GROUP_DAYS,
  WORKFLOW_STATES.DAY_ITINERARY,
  WORKFLOW_STATES.MEAL_PREFERENCES,
  WORKFLOW_STATES.REVIEW,
  WORKFLOW_STATES.FINALIZE,
];

const UI_STAGE_LABELS = [
  "Trip Basics",
  "Select Your Activities",
  "Organize Your Days",
  "Restaurants",
  "Hotels & Flights",
  "Final Review",
];

const WORKFLOW_TO_UI_STAGE: Record<string, number> = {
  [WORKFLOW_STATES.INFO_GATHERING]: 0,
  [WORKFLOW_STATES.INITIAL_RESEARCH]: 1,
  [WORKFLOW_STATES.SUGGEST_ACTIVITIES]: 1,
  [WORKFLOW_STATES.SELECT_ACTIVITIES]: 1,
  [WORKFLOW_STATES.GROUP_DAYS]: 2,
  [WORKFLOW_STATES.DAY_ITINERARY]: 3,
  [WORKFLOW_STATES.MEAL_PREFERENCES]: 3,
  [WORKFLOW_STATES.REVIEW]: 4,
  [WORKFLOW_STATES.FINALIZE]: 5,
};

const UI_STAGE_TO_WORKFLOW: Record<number, string> = {
  0: WORKFLOW_STATES.INFO_GATHERING,
  1: WORKFLOW_STATES.INITIAL_RESEARCH,
  2: WORKFLOW_STATES.GROUP_DAYS,
  3: WORKFLOW_STATES.DAY_ITINERARY,
  4: WORKFLOW_STATES.REVIEW,
  5: WORKFLOW_STATES.FINALIZE,
};

const LEGACY_TIMELINE_CACHE_KEY_PREFIX = "timeline-analysis:";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type ApiWarningMessage = {
  id: string;
  message: string;
  endpoint: string;
};

type ApiWarningDetail = {
  url: string;
  message: string;
  status?: number;
  timestamp: string;
};

type MarkdownBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean);
  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return (
        <code key={index} className="rounded bg-gray-100 px-1 py-0.5 text-[0.95em] text-gray-900">
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    return <span key={index}>{token}</span>;
  });
}

function parseSimpleMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let currentListType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (currentListType && listItems.length > 0) {
      blocks.push({ type: currentListType, items: [...listItems] });
    }
    currentListType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: headingMatch[1].trim() });
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (currentListType !== "ul") {
        flushList();
        currentListType = "ul";
      }
      listItems.push(unorderedMatch[1].trim());
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (currentListType !== "ol") {
        flushList();
        currentListType = "ol";
      }
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderAiCommentary(content: string): ReactNode {
  const blocks = parseSimpleMarkdown(content);
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h4 key={index} className="text-sm font-semibold text-gray-900">
              {renderInlineMarkdown(block.text)}
            </h4>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={index} className="text-sm text-gray-800 leading-relaxed">
              {renderInlineMarkdown(block.text)}
            </p>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={index} className="list-disc pl-5 text-sm text-gray-800 space-y-1">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={index} className="list-decimal pl-5 text-sm text-gray-800 space-y-1">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}

const EMPTY_TRIP_INFO: TripInfo = {
  source: null,
  destination: null,
  startDate: null,
  endDate: null,
  durationDays: null,
  preferences: [],
  foodPreferences: [],
  visitedDestinations: [],
  activityLevel: "moderate",
  travelers: 1,
  budget: null,
  transportMode: "flight",
  arrivalAirport: null,
  departureAirport: null,
  arrivalTimePreference: "12:00 PM",
  departureTimePreference: "6:00 PM",
};

function defaultTimelineView(result: TimelineAnalysisResponse | null | undefined): TimelineMapView {
  if ((result?.cities?.length || 0) > 0) return "cities";
  if ((result?.trips?.length || 0) > 0) return "trips";
  return "countries";
}

function buildActivityNameLookup(
  activities: SuggestedActivity[],
  groupedDays: GroupedDay[]
): Map<string, string> {
  const byId = new Map<string, string>();
  activities.forEach((activity) => {
    if (activity.id && activity.name) {
      byId.set(activity.id, activity.name);
    }
  });
  groupedDays.forEach((day) => {
    day.activities.forEach((activity) => {
      if (activity.id && activity.name && !byId.has(activity.id)) {
        byId.set(activity.id, activity.name);
      }
    });
  });
  return byId;
}

function mapLlmSuggestedOperationsWithNames(
  operations: Array<Record<string, unknown>>,
  activityNameById: Map<string, string>
): Array<Record<string, unknown>> {
  return operations.map((operation) => {
    const activityIds = Array.isArray(operation.activityIds)
      ? operation.activityIds.filter((id): id is string => typeof id === "string")
      : [];
    if (activityIds.length === 0) {
      return operation;
    }
    const activityLabels = activityIds.map((id) => {
      const name = activityNameById.get(id);
      return name ? `${name} (${id})` : `(unknown activity: ${id})`;
    });
    return {
      ...operation,
      activityLabels,
    };
  });
}

function formatLlmRefinementPromptMessages(
  messages: Array<{ role: "system" | "user"; content: string }> | undefined
): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n---\n\n");
}

function parseManualJsonInput(value: string): unknown {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(normalized);
}

function extractManualSchedulePayload(
  payload: unknown
): { dayGroups: DayGroup[]; unassignedActivityIds: string[] | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  const dayGroups = Array.isArray(source.dayGroups)
    ? source.dayGroups
    : Array.isArray(source.candidateDayGroups)
      ? source.candidateDayGroups
      : null;
  if (!Array.isArray(dayGroups) || dayGroups.length === 0) return null;
  const unassigned = Array.isArray(source.unassignedActivityIds)
    ? source.unassignedActivityIds
    : Array.isArray(source.candidateUnassignedActivityIds)
      ? source.candidateUnassignedActivityIds
      : null;
  return {
    dayGroups: dayGroups as DayGroup[],
    unassignedActivityIds: Array.isArray(unassigned)
      ? unassigned.filter((id): id is string => typeof id === "string")
      : null,
  };
}

function extractOverallDebugCostFromDays(days: GroupedDay[] | null | undefined): number | null {
  if (!Array.isArray(days)) return null;
  for (const day of days) {
    const value = day.debugCost?.overallTripCost;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function extractGlobalDebugCostSummary(days: GroupedDay[] | null | undefined): {
  total: number | null;
  base: number | null;
  commuteImbalance: number | null;
  nearbySplit: number | null;
  durationMismatch: number | null;
} {
  if (!Array.isArray(days) || days.length === 0) {
    return {
      total: null,
      base: null,
      commuteImbalance: null,
      nearbySplit: null,
      durationMismatch: null,
    };
  }
  const debugCost = days.find((day) => day.debugCost)?.debugCost;
  if (!debugCost) {
    return {
      total: null,
      base: null,
      commuteImbalance: null,
      nearbySplit: null,
      durationMismatch: null,
    };
  }
  return {
    total: debugCost.overallTripCost ?? null,
    base: debugCost.baseCost ?? null,
    commuteImbalance: debugCost.commuteImbalancePenalty ?? null,
    nearbySplit: debugCost.nearbySplitPenalty ?? null,
    durationMismatch: debugCost.durationMismatchPenalty ?? null,
  };
}

function uniqueOrderedIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  ids.forEach((id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  });
  return ordered;
}

export default function PlannerPage() {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState(WORKFLOW_STATES.INFO_GATHERING);

  // Trip data
  const [tripInfo, setTripInfo] = useState<TripInfo>(EMPTY_TRIP_INFO);
  const [tripResearchBrief, setTripResearchBrief] = useState<TripResearchBrief | null>(null);
  const [selectedResearchOptionIds, setSelectedResearchOptionIds] = useState<string[]>([]);

  // New activity-first flow state
  const [suggestedActivities, setSuggestedActivities] = useState<SuggestedActivity[]>([]);
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [groupedDays, setGroupedDays] = useState<GroupedDay[]>([]);
  const [unassignedActivityIds, setUnassignedActivityIds] = useState<string[]>([]);
  const [activityCostDebugById, setActivityCostDebugById] = useState<Record<string, ActivityCostDebug>>({});
  const [currentSchedule, setCurrentSchedule] = useState<ScheduleState | null>(null);
  const [tentativeSchedule, setTentativeSchedule] = useState<ScheduleState | null>(null);
  const [llmRefinementResult, setLlmRefinementResult] = useState<LlmRefinementResult | null>(null);
  const [llmRefinementPreview, setLlmRefinementPreview] = useState<LlmRefinementPreview | null>(null);
  const [llmRefinementDiffOpen, setLlmRefinementDiffOpen] = useState(false);
  const [llmRefinementManualResponse, setLlmRefinementManualResponse] = useState("");
  const [llmRefinementPromptDebug, setLlmRefinementPromptDebug] = useState("");
  const [groupingDebugTotalCost, setGroupingDebugTotalCost] = useState<number | null>(null);
  const [restaurantSuggestions, setRestaurantSuggestions] = useState<RestaurantSuggestion[]>([]);
  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState<string[]>([]);
  const [accommodationStatus, setAccommodationStatus] = useState<SubAgentStatus>("idle");
  const [flightStatus, setFlightStatus] = useState<SubAgentStatus>("idle");
  const [accommodationError, setAccommodationError] = useState<string | null>(null);
  const [flightError, setFlightError] = useState<string | null>(null);
  const [accommodationOptions, setAccommodationOptions] = useState<AccommodationOption[]>([]);
  const [flightOptions, setFlightOptions] = useState<FlightOption[]>([]);
  const [selectedAccommodationOptionId, setSelectedAccommodationOptionId] = useState<string | null>(null);
  const [selectedFlightOptionId, setSelectedFlightOptionId] = useState<string | null>(null);
  const [wantsAccommodation, setWantsAccommodation] = useState<boolean | null>(null);
  const [wantsFlight, setWantsFlight] = useState<boolean | null>(null);
  const [reviewOfferTab, setReviewOfferTab] = useState<"hotels" | "flights">("hotels");
  const [accommodationLastSearchedAt, setAccommodationLastSearchedAt] = useState<string | null>(null);
  const [flightLastSearchedAt, setFlightLastSearchedAt] = useState<string | null>(null);
  const [aiCheckResult, setAiCheckResult] = useState<AiCheckResult | null>(null);
  const [isAiCheckCollapsed, setIsAiCheckCollapsed] = useState(true);
  const [maxReachedState, setMaxReachedState] = useState(WORKFLOW_STATES.INFO_GATHERING);
  const [lastGroupedActivityIds, setLastGroupedActivityIds] = useState<string[]>([]);
  const [llmRefinementDiffOffset, setLlmRefinementDiffOffset] = useState({ x: 0, y: 0 });

  // Timeline State
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineAnalysis, setTimelineAnalysis] = useState<TimelineAnalysisResponse | null>(null);
  const [timelineFileName, setTimelineFileName] = useState<string | null>(null);
  const [activeTimelineView, setActiveTimelineView] = useState<TimelineMapView>("cities");

  // UI state
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "interests">("chat");
  const [hoveredActivityId, setHoveredActivityId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(1);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  const [tripBasicsSaving, setTripBasicsSaving] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [tripBasicsPreferencesInput, setTripBasicsPreferencesInput] = useState("");
  const [deepResearchOptionId, setDeepResearchOptionId] = useState<string | null>(null);
  const [lastDeepResearchAtByOptionId, setLastDeepResearchAtByOptionId] = useState<Record<string, string>>({});
  const [photoEnrichmentInProgress, setPhotoEnrichmentInProgress] = useState(false);
  const [apiWarnings, setApiWarnings] = useState<ApiWarningMessage[]>([]);
  const photoEnrichmentSignatureRef = useRef<string>("");
  const lastSeenAiCheckAtRef = useRef<string | null>(null);


  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const leftPanelScrollRef = useRef<HTMLDivElement>(null);
  const aiInsightPopupRef = useRef<HTMLDivElement>(null);
  const llmRefinementDiffOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    llmRefinementDiffOffsetRef.current = llmRefinementDiffOffset;
  }, [llmRefinementDiffOffset]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onApiWarning = (event: Event) => {
      const customEvent = event as CustomEvent<ApiWarningDetail>;
      const detail = customEvent.detail;
      if (!detail?.message) return;
      const endpoint = detail.url.replace(/^\/api\//, "");
      const id = `${detail.timestamp}:${detail.url}:${detail.message}`;
      setApiWarnings((prev) => {
        if (prev.some((warning) => warning.id === id)) return prev;
        const next = [{ id, message: detail.message, endpoint }, ...prev];
        return next.slice(0, 5);
      });
    };

    window.addEventListener("travel-planner:api-warning", onApiWarning as EventListener);
    return () => {
      window.removeEventListener("travel-planner:api-warning", onApiWarning as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const keysToRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LEGACY_TIMELINE_CACHE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  }, []);

  useEffect(() => {
    if (isAiCheckCollapsed) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && aiInsightPopupRef.current?.contains(target)) return;
      setIsAiCheckCollapsed(true);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAiCheckCollapsed(true);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAiCheckCollapsed]);

  const applyTimelineAnalysisResult = useCallback(async (result: TimelineAnalysisResponse) => {
    setTimelineAnalysis(result);
    setActiveTimelineView(defaultTimelineView(result));

    const mergedPreferences = Array.from(
      new Set([...(tripInfo.preferences || []), ...result.preferences])
    );
    const mergedFoodPreferences = Array.from(
      new Set([...(tripInfo.foodPreferences || []), ...(result.foodPreferences || [])])
    );
    const mergedVisitedDestinations = Array.from(
      new Set([...(tripInfo.visitedDestinations || []), ...result.visitedDestinations])
    );

    setTripInfo((prev) => ({
      ...prev,
      preferences: mergedPreferences,
      foodPreferences: mergedFoodPreferences,
      visitedDestinations: mergedVisitedDestinations,
    }));
    setTripBasicsPreferencesInput(mergedPreferences.join(", "));
    await persistTripInfoUpdate({
      preferences: mergedPreferences,
      foodPreferences: mergedFoodPreferences,
      visitedDestinations: mergedVisitedDestinations,
    });
  }, [persistTripInfoUpdate, tripInfo.foodPreferences, tripInfo.preferences, tripInfo.visitedDestinations]);

  const handleTimelineUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setTimelineFileName(file.name);
    setTimelineLoading(true);
    setTimelineAnalysis(null);

    try {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder().decode(buffer);
      const json = JSON.parse(text);
      const visits = extractTimelineVisits(json);

      if (visits.length === 0) {
        setTimelineAnalysis({
          summary: "This file parsed correctly, but it did not include any usable place visits to learn from.",
          preferences: [],
          foodPreferences: [],
          visitedDestinations: [],
          places: [],
          cities: [],
          countries: [],
          trips: [],
          mapPoints: {
            cities: [],
            places: [],
            trips: [],
            countries: [],
          },
          verification: {
            checks: [],
          },
          stats: {
            visitCount: 0,
            placeCount: 0,
            cityCount: 0,
            countryCount: 0,
            tripCount: 0,
          },
        });
        return;
      }

      const result = await analyzeTimeline({ visits });
      await applyTimelineAnalysisResult(result);
    } catch (error) {
      console.error("Error processing timeline:", error);
      alert("Failed to process timeline file.");
    } finally {
      setTimelineLoading(false);
      event.target.value = "";
    }
  };

  // Auto-focus chat input when loading finishes
  useEffect(() => {
    if (!loading && activeTab === "chat" && !isChatMinimized) {
      chatInputRef.current?.focus();
    }
  }, [loading, activeTab, isChatMinimized]);

  // Auto-scroll chat
  useEffect(() => {
    if (!chatScrollRef.current || activeTab !== "chat" || isChatMinimized) return;

    const container = chatScrollRef.current;
    const viewport = container.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    const scrollTarget = viewport || container;

    const scrollToBottom = () => {
      scrollTarget.scrollTo({
        top: scrollTarget.scrollHeight,
        behavior: "smooth",
      });
    };

    const timeoutId = window.setTimeout(scrollToBottom, 50);
    return () => window.clearTimeout(timeoutId);
  }, [chatHistory, activeTab, isChatMinimized]);

  // Initialize session on mount
  useEffect(() => {
    initializeSession();
  }, []);

  useEffect(() => {
    if (!tripResearchBrief) {
      setSelectedResearchOptionIds([]);
      setLastDeepResearchAtByOptionId({});
      return;
    }

    setSelectedResearchOptionIds((prev) => {
      const validIds = new Set(tripResearchBrief.popularOptions.map((option) => option.id));
      return prev.filter((id) => validIds.has(id));
    });

    // Keep timestamps only for currently visible options.
    const validIds = new Set(tripResearchBrief.popularOptions.map((option) => option.id));
    setLastDeepResearchAtByOptionId((prev) => {
      const next: Record<string, string> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (validIds.has(id)) next[id] = value;
      }
      return next;
    });
  }, [tripResearchBrief]);

  useEffect(() => {
    setTripBasicsPreferencesInput((tripInfo.preferences || []).join(", "));
  }, [tripInfo.preferences]);

  useEffect(() => {
    if (
      !sessionId ||
      !tripInfo.destination ||
      tripInfo.transportMode !== "flight" ||
      !!tripInfo.arrivalAirport
    ) {
      return;
    }

    let cancelled = false;
    const populateDefaultAirport = async () => {
      try {
        const suggestion = await suggestAirport(sessionId);
        if (!suggestion.success || !suggestion.airportName || cancelled) return;
        const response = await updateTripInfo(sessionId, {
          arrivalAirport: suggestion.airportName,
          departureAirport: tripInfo.departureAirport || suggestion.airportName,
        });
        if (response.success && response.tripInfo && !cancelled) {
          setTripInfo(response.tripInfo);
        }
      } catch (error) {
        console.warn("Failed to auto-suggest airport:", error);
      }
    };

    void populateDefaultAirport();
    return () => {
      cancelled = true;
    };
  }, [sessionId, tripInfo.destination, tripInfo.transportMode, tripInfo.arrivalAirport, tripInfo.departureAirport]);

  useEffect(() => {
    if (selectedAccommodationOptionId && !accommodationOptions.some((option) => option.id === selectedAccommodationOptionId)) {
      setSelectedAccommodationOptionId(null);
      if (wantsAccommodation) setWantsAccommodation(null);
    }
  }, [accommodationOptions, selectedAccommodationOptionId, wantsAccommodation]);

  useEffect(() => {
    if (selectedFlightOptionId && !flightOptions.some((option) => option.id === selectedFlightOptionId)) {
      setSelectedFlightOptionId(null);
      if (wantsFlight) setWantsFlight(null);
    }
  }, [flightOptions, selectedFlightOptionId, wantsFlight]);

  const triggerPhotoEnrichment = useCallback(async () => {
    if (!sessionId || !tripResearchBrief || photoEnrichmentInProgress) return;
    const missingIds = tripResearchBrief.popularOptions
      .filter(
        (option) =>
          !option.photoUrls ||
          option.photoUrls.length === 0 ||
          !option.coordinates ||
          typeof option.coordinates.lat !== "number" ||
          typeof option.coordinates.lng !== "number"
      )
      .map((option) => option.id)
      .sort();
    if (missingIds.length === 0) return;

    const signature = `${sessionId}:${missingIds.join("|")}`;
    if (photoEnrichmentSignatureRef.current === signature) return;
    const previousSignature = photoEnrichmentSignatureRef.current;
    photoEnrichmentSignatureRef.current = signature;

    setPhotoEnrichmentInProgress(true);
    try {
      const response = await enrichResearchPhotos(sessionId);
      if (response.success && response.tripResearchBrief) {
        setTripResearchBrief(response.tripResearchBrief);
      }
    } catch (error) {
      console.error("Photo enrichment error:", error);
      // Allow retries after failures.
      if (photoEnrichmentSignatureRef.current === signature) {
        photoEnrichmentSignatureRef.current = previousSignature;
      }
    } finally {
      setPhotoEnrichmentInProgress(false);
    }
  }, [photoEnrichmentInProgress, sessionId, tripResearchBrief]);

  useEffect(() => {
    void triggerPhotoEnrichment();
  }, [triggerPhotoEnrichment]);

  const runWithPreservedLeftPanelScroll = useCallback(async (work: () => Promise<void>) => {
    const container = leftPanelScrollRef.current;
    const previousTop = container?.scrollTop ?? 0;
    const previousLeft = container?.scrollLeft ?? 0;
    await work();
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTo({ top: previousTop, left: previousLeft, behavior: "auto" });
      });
    }
  }, []);

  const initializeSession = async () => {
    try {
      const response = await startSession();
      if (response.success) {
        setSessionId(response.sessionId);
        setWorkflowState(response.workflowState);
        setChatHistory([{ role: "assistant", content: response.message }]);
        setTripInfo(response.tripInfo || EMPTY_TRIP_INFO);
      }
    } catch (error) {
      console.error("Failed to start session:", error);
      alert("Failed to start planning session. Please try again.");
    } finally {
      setInitializing(false);
    }
  };

  const applySessionResponse = (response: SessionResponse, appendMessage = true) => {
    if (response.researchOptionSelections) {
      const selectedIds = Object.entries(response.researchOptionSelections)
        .filter(([, value]) => value === "selected" || value === "keep")
        .map(([id]) => id);
      setSelectedResearchOptionIds(selectedIds);
    }
    if (response.tripInfo) setTripInfo(response.tripInfo);
    if ("tripResearchBrief" in response) {
      setTripResearchBrief(response.tripResearchBrief ?? null);
    }
    if (response.suggestedActivities !== undefined) setSuggestedActivities(response.suggestedActivities);
    if (response.selectedActivityIds !== undefined) setSelectedActivityIds(response.selectedActivityIds);
    if (response.currentSchedule !== undefined) {
      const schedule = response.currentSchedule;
      setCurrentSchedule(schedule);
      setGroupedDays(schedule.groupedDays);
      setUnassignedActivityIds(schedule.unassignedActivityIds);
      setActivityCostDebugById(schedule.activityCostDebugById);
    } else if (response.groupedDays !== undefined) {
      setGroupedDays(response.groupedDays);
    }
    if (response.tentativeSchedule !== undefined) setTentativeSchedule(response.tentativeSchedule);
    if (response.currentSchedule === undefined && response.unassignedActivityIds !== undefined) {
      setUnassignedActivityIds(response.unassignedActivityIds);
    }
    if (response.currentSchedule === undefined && response.activityCostDebugById !== undefined) setActivityCostDebugById(response.activityCostDebugById);
    if (response.llmRefinementResult !== undefined) {
      const result = response.llmRefinementResult ?? null;
      setLlmRefinementResult(result);
      setLlmRefinementPromptDebug(formatLlmRefinementPromptMessages(result?.llmRequestMessages));
    }
    if (response.llmRefinementPreview !== undefined) {
      const preview = response.llmRefinementPreview ?? null;
      setLlmRefinementPreview(preview);
      setLlmRefinementDiffOpen(Boolean(preview));
    }
    if (response.restaurantSuggestions !== undefined) setRestaurantSuggestions(response.restaurantSuggestions);
    if (response.selectedRestaurantIds !== undefined) setSelectedRestaurantIds(response.selectedRestaurantIds);
    if (response.accommodationStatus !== undefined) setAccommodationStatus(response.accommodationStatus);
    if (response.flightStatus !== undefined) setFlightStatus(response.flightStatus);
    if (response.accommodationError !== undefined) setAccommodationError(response.accommodationError ?? null);
    if (response.flightError !== undefined) setFlightError(response.flightError ?? null);
    if (response.accommodationOptions !== undefined) setAccommodationOptions(response.accommodationOptions);
    if (response.flightOptions !== undefined) setFlightOptions(response.flightOptions);
    if (response.selectedAccommodationOptionId !== undefined) {
      setSelectedAccommodationOptionId(response.selectedAccommodationOptionId ?? null);
    }
    if (response.selectedFlightOptionId !== undefined) {
      setSelectedFlightOptionId(response.selectedFlightOptionId ?? null);
    }
    if (response.wantsAccommodation !== undefined) {
      setWantsAccommodation(response.wantsAccommodation ?? null);
    }
    if (response.wantsFlight !== undefined) {
      setWantsFlight(response.wantsFlight ?? null);
    }
    if (response.accommodationLastSearchedAt !== undefined) setAccommodationLastSearchedAt(response.accommodationLastSearchedAt ?? null);
    if (response.flightLastSearchedAt !== undefined) setFlightLastSearchedAt(response.flightLastSearchedAt ?? null);
    if (response.aiCheckResult !== undefined) {
      const incomingAiCheck = response.aiCheckResult ?? null;
      setAiCheckResult(incomingAiCheck);
      if (incomingAiCheck && incomingAiCheck.checkedAt !== lastSeenAiCheckAtRef.current) {
        setIsAiCheckCollapsed(true);
        lastSeenAiCheckAtRef.current = incomingAiCheck.checkedAt;
      }
      if (!incomingAiCheck) {
        lastSeenAiCheckAtRef.current = null;
      }
    }
    if (response.workflowState) {
      setWorkflowState(response.workflowState);
      updateMaxReachedState(response.workflowState);
    }
    if (appendMessage && response.message) {
      setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
    }
  };

  // Handle chat messages
  const handleChat = async () => {
    if (!chatInput.trim() || !sessionId) return;

    const userMessage = chatInput;
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const response = await agentTurn(sessionId, "user_message", userMessage);
      if (response.success) {
        applySessionResponse(response, true);
      } else {
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Chat error:", error);
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Handle suggestion chips
  const handleSuggestionClick = async (suggestion: string) => {
    if (!sessionId || loading) return;

    const userMessage = suggestion;
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const response = await agentTurn(sessionId, "user_message", userMessage);
      if (response.success) {
        applySessionResponse(response, true);
      } else {
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Suggestion chat error:", error);
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I had trouble processing that suggestion." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Generate initial research brief
  const handleGenerateResearchBrief = async (
    depth: "fast" | "deep" = "fast",
    mode: "refresh" | "augment" = "refresh"
  ) => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await generateResearchBrief(sessionId, depth, mode);
      if (response.success) {
        if (response.tripResearchBrief) setTripResearchBrief(response.tripResearchBrief);
        if (response.researchOptionSelections) {
          const selectedIds = Object.entries(response.researchOptionSelections)
            .filter(([, value]) => value === "selected" || value === "keep")
            .map(([id]) => id);
          setSelectedResearchOptionIds(selectedIds);
        }
        if (depth === "deep" && response.tripResearchBrief) {
          const timestamp = new Date().toISOString();
          const ids = response.tripResearchBrief.popularOptions.map((option) => option.id);
          setLastDeepResearchAtByOptionId((prev) => {
            const next = { ...prev };
            for (const id of ids) next[id] = timestamp;
            return next;
          });
        }
        if (response.workflowState) {
          setWorkflowState(response.workflowState);
          updateMaxReachedState(response.workflowState);
        }
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Generate research brief error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to generate research brief. Please try again.";
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleProceedFromResearch = async () => {
    if (!sessionId || hasUnresolvedAssumptionConflicts) return;
    const confirmedSelectedActivityIds = [...selectedResearchOptionIds];
    if (confirmedSelectedActivityIds.length === 0) {
      alert("Select at least one activity before organizing your trip.");
      return;
    }
    setLoading(true);
    try {
      const response = await confirmResearchBrief(sessionId, {
        selectedResearchOptionIds: confirmedSelectedActivityIds,
      });
      if (!response.success) {
        throw new Error(response.message);
      }
      applySessionResponse(response, false);
      const selectedIds = response.selectedActivityIds || [];
      setLastGroupedActivityIds([...selectedIds]);
      setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
    } catch (error) {
      console.error("Confirm research brief error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to confirm research brief. Please try again.";
      alert(errorMessage);
      setLoading(false);
      return;
    }
    setLoading(false);
  };

  const handleDeepResearchOption = async (optionId: string) => {
    if (!sessionId) return;
    setDeepResearchOptionId(optionId);
    setLoading(true);
    try {
      await runWithPreservedLeftPanelScroll(async () => {
        const response = await deepResearchOption(sessionId, optionId);
        if (!response.success) {
          throw new Error(response.message);
        }
        if (response.tripResearchBrief) {
          setTripResearchBrief((prev) => {
            if (!prev) return response.tripResearchBrief || null;
            const byId = new Map(response.tripResearchBrief?.popularOptions.map((option) => [option.id, option]));
            return {
              ...prev,
              popularOptions: prev.popularOptions.map((option) => byId.get(option.id) || option),
            };
          });
        }
        // Keep existing selections exactly as-is; deep research should only refresh card content.
        setLastDeepResearchAtByOptionId((prev) => ({
          ...prev,
          [optionId]: new Date().toISOString(),
        }));
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      });
    } catch (error) {
      console.error("Deep research option error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to run deep research for this option.";
      alert(errorMessage);
    } finally {
      setDeepResearchOptionId(null);
      setLoading(false);
    }
  };

  const handleDeepResearchSelected = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await runWithPreservedLeftPanelScroll(async () => {
        const response = await deepResearchSelectedOptions(sessionId);
        if (!response.success) {
          throw new Error(response.message);
        }
        if (response.tripResearchBrief) {
          setTripResearchBrief((prev) => {
            if (!prev) return response.tripResearchBrief || null;
            const byId = new Map(response.tripResearchBrief?.popularOptions.map((option) => [option.id, option]));
            return {
              ...prev,
              popularOptions: prev.popularOptions.map((option) => byId.get(option.id) || option),
            };
          });
        }
        // Keep existing selections exactly as-is; deep research should only refresh card content.
        if (response.deepResearchedOptionIds && response.deepResearchedOptionIds.length > 0) {
          const timestamp = new Date().toISOString();
          setLastDeepResearchAtByOptionId((prev) => {
            const next = { ...prev };
            for (const id of response.deepResearchedOptionIds || []) {
              next[id] = timestamp;
            }
            return next;
          });
        }
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      });
    } catch (error) {
      console.error("Deep research selected error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to run deep research for selected cards.";
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmActivitySelectionInternal = async (ids: string[]) => {
    if (!sessionId || ids.length === 0) return;
    setLoading(true);

    try {
      const selectResponse = await selectActivities(sessionId, ids);
      if (!selectResponse.success) {
        throw new Error(selectResponse.message);
      }
      applySessionResponse(selectResponse, true);
      setLlmRefinementResult(null);
      setLlmRefinementPreview(null);
      setLlmRefinementDiffOpen(false);
      setLastGroupedActivityIds([...ids]);
    } catch (error) {
      console.error("Group days error:", error);
      alert("Failed to organize activities. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResearchSelectionChange = (optionId: string, selected: boolean) => {
    setSelectedResearchOptionIds((prev) => {
      if (selected) {
        if (prev.includes(optionId)) return prev;
        return [...prev, optionId];
      }
      return prev.filter((id) => id !== optionId);
    });
  };

  const handleRemoveResearchOption = async (optionId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await removeCard(sessionId, "research_option", optionId);
      if (response.success) {
        delete response.researchOptionSelections;
        applySessionResponse(response, false);
        setSelectedResearchOptionIds((prev) => prev.filter((id) => id !== optionId));
        setLastDeepResearchAtByOptionId((prev) => {
          const next = { ...prev };
          delete next[optionId];
          return next;
        });
      }
    } catch (error) {
      console.error("Remove research option error:", error);
      alert("Failed to remove activity card. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const getDerivedDurationFromDates = (info: TripInfo | null): number | null => {
    if (!info?.startDate || !info?.endDate) return null;
    const start = new Date(info.startDate);
    const end = new Date(info.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  const derivedDuration = getDerivedDurationFromDates(tripInfo);
  const hasDurationConflict =
    derivedDuration != null &&
    tripInfo?.durationDays != null &&
    derivedDuration > 0 &&
    tripInfo.durationDays > 0 &&
    Math.abs(derivedDuration - tripInfo.durationDays) > 1;
  const hasUnresolvedAssumptionConflicts = workflowState === WORKFLOW_STATES.INITIAL_RESEARCH && hasDurationConflict;
  const hasAnySelectedResearchOption = selectedResearchOptionIds.length > 0;

  const handleResolveDurationConflict = async (mode: "use_date_range" | "keep_requested_duration") => {
    if (!sessionId || !tripInfo) return;
    const requestedDuration = tripInfo.durationDays;
    const derived = getDerivedDurationFromDates(tripInfo);
    const updates: Partial<TripInfo> = {};

    if (mode === "use_date_range") {
      if (!derived) return;
      updates.durationDays = derived;
    } else {
      if (!tripInfo.startDate || !requestedDuration || requestedDuration < 1) return;
      const start = new Date(tripInfo.startDate);
      if (Number.isNaN(start.getTime())) return;
      const end = new Date(start);
      end.setDate(start.getDate() + requestedDuration - 1);
      updates.endDate = end.toISOString().slice(0, 10);
      updates.durationDays = requestedDuration;
    }

    setLoading(true);
    try {
      const response = await updateTripInfo(sessionId, updates);
      if (response.success && response.tripInfo) {
        setTripInfo(response.tripInfo);
      }
    } catch (error) {
      console.error("Resolve duration conflict error:", error);
      alert("Failed to update duration. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTravelLogistics = async (updates: Partial<TripInfo>) => {
    if (!sessionId) return;
    try {
      const response = await updateTripInfo(sessionId, updates);
      if (response.success && response.tripInfo) {
        setTripInfo(response.tripInfo);
      }
    } catch (error) {
      console.error("Update travel logistics error:", error);
    }
  };

  // Confirm activity selection and group into days
  const handleConfirmActivitySelection = async () => {
    handleConfirmActivitySelectionInternal(selectedActivityIds);
  };

  // Handle moving activity between days
  const handleMoveActivity = async (activityId: string, fromDay: number, toDay: number, targetIndex?: number) => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await adjustDayGroups(sessionId, activityId, fromDay, toDay, targetIndex);
      if (response.success) {
        applySessionResponse(response, false);
      }
    } catch (error) {
      console.error("Move activity error:", error);
      alert("Failed to move activity. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Confirm day grouping
  const handleConfirmDayGrouping = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const scheduleForConfirmation = currentSchedule;
      const selectedActivityIdsOverride = uniqueOrderedIds([
        ...(scheduleForConfirmation?.dayGroups ?? groupedDays).flatMap((day) =>
          "activityIds" in day ? day.activityIds : day.activities.map((activity) => activity.id)
        ),
        ...(scheduleForConfirmation?.unassignedActivityIds ?? unassignedActivityIds),
      ]);
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "confirm_grouping",
        payload: {
          selectedActivityIdsOverride,
        },
      });
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Confirm grouping error:", error);
      alert("Failed to confirm day grouping. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const llmRefinementRequestBaseGroupedDays = currentSchedule?.groupedDays ?? groupedDays;
  const llmRefinementRequestBaseUnassignedIds = useMemo(() => {
    return uniqueOrderedIds(currentSchedule?.unassignedActivityIds ?? unassignedActivityIds);
  }, [currentSchedule, unassignedActivityIds]);

  const handleLlmRefineStep = async () => {
    if (!sessionId) return;
    if (llmRefinementPreview) {
      setLlmRefinementDiffOpen(true);
      return;
    }
    setLoading(true);
    try {
      setLlmRefinementDiffOffset({ x: 0, y: 0 });
      const response = await runLlmRefinementStep(
        sessionId,
        llmRefinementManualResponse.trim() ? llmRefinementManualResponse : null
      );
      if (response.success) {
        if (response.llmRefinementResult) {
          const namedSuggestions = mapLlmSuggestedOperationsWithNames(
            Array.isArray(response.llmRefinementResult.suggestedOperations)
              ? response.llmRefinementResult.suggestedOperations
              : [],
            buildActivityNameLookup(suggestedActivities, llmRefinementRequestBaseGroupedDays)
          );
          console.debug("[LLM Refine] Operation summary:", response.llmRefinementResult.operationSummary);
          console.debug("[LLM Refine] Suggested operations (named):", namedSuggestions);
          if (response.llmRefinementResult.llmRequestMessages) {
            console.debug(
              "[LLM Refine] Exact prompt payload sent to model:",
              JSON.stringify(response.llmRefinementResult.llmRequestMessages, null, 2)
            );
          }
        }
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("LLM refine step error:", error);
      alert("Failed to run LLM refinement step. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleUseManualLlmJson = async () => {
    if (!sessionId || !llmRefinementManualResponse.trim()) return;
    setLoading(true);
    try {
      const parsedManualPayload = parseManualJsonInput(llmRefinementManualResponse);
      const manualSchedule = extractManualSchedulePayload(parsedManualPayload);

      if (manualSchedule) {
        const response = await applyLlmRefinementCandidate(
          sessionId,
          manualSchedule.dayGroups,
          manualSchedule.unassignedActivityIds
            ?? uniqueOrderedIds(currentSchedule?.unassignedActivityIds ?? unassignedActivityIds),
          llmRefinementResult
            ? {
              ...llmRefinementResult,
              accepted: true,
              reason: llmRefinementResult.reason ?? "Applied from manual JSON schedule.",
            }
            : null
        );
        if (response.success) {
          applySessionResponse(response, true);
          setLlmRefinementPreview(null);
          setLlmRefinementDiffOpen(false);
          setLlmRefinementDiffOffset({ x: 0, y: 0 });
        }
        return;
      }

      const refineResponse = await runLlmRefinementStep(sessionId, llmRefinementManualResponse);
      if (!refineResponse.success) {
        throw new Error(refineResponse.message || "Manual JSON refinement failed.");
      }
      const scheduleToAccept = refineResponse.llmRefinementPreview?.tentativeSchedule ?? refineResponse.tentativeSchedule;
      const candidateDayGroups = scheduleToAccept?.dayGroups ?? refineResponse.llmRefinementPreview?.candidateDayGroups;
      const candidateUnassignedActivityIds =
        scheduleToAccept?.unassignedActivityIds
        ?? refineResponse.llmRefinementPreview?.candidateUnassignedActivityIds;

      if (!candidateDayGroups || !candidateUnassignedActivityIds) {
        applySessionResponse(refineResponse, true);
        alert("Manual JSON was parsed but did not produce a candidate schedule to apply.");
        return;
      }

      const applyResponse = await applyLlmRefinementCandidate(
        sessionId,
        candidateDayGroups,
        candidateUnassignedActivityIds,
        refineResponse.llmRefinementResult
          ? {
            ...refineResponse.llmRefinementResult,
            accepted: true,
            reason: refineResponse.llmRefinementResult.reason ?? "Applied from manual JSON response.",
          }
          : null
      );
      if (applyResponse.success) {
        applySessionResponse(applyResponse, true);
        setLlmRefinementPreview(null);
        setLlmRefinementDiffOpen(false);
        setLlmRefinementDiffOffset({ x: 0, y: 0 });
      }
    } catch (error) {
      console.error("Manual LLM JSON apply error:", error);
      alert("Failed to apply manual JSON. Ensure it is valid JSON for either schedule or operations payload.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseLlmRefinementPreview = () => {
    setLlmRefinementDiffOpen(false);
  };

  const handleRejectLlmRefinementPreview = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await resolveLlmRefinementPreview(sessionId, "reject");
      if (response.success) {
        applySessionResponse(response, false);
        setLlmRefinementDiffOpen(false);
      }
    } catch (error) {
      console.error("LLM refinement reject error:", error);
      alert("Failed to reject LLM refinement preview. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptLlmRefinementPreview = async () => {
    const scheduleToAccept = llmRefinementPreview?.tentativeSchedule ?? tentativeSchedule;
    const candidateDayGroups = scheduleToAccept?.dayGroups ?? llmRefinementPreview?.candidateDayGroups;
    const candidateUnassignedActivityIds = scheduleToAccept?.unassignedActivityIds ?? llmRefinementPreview?.candidateUnassignedActivityIds;
    if (!sessionId || !candidateDayGroups || !candidateUnassignedActivityIds) {
      return;
    }
    setLoading(true);
    try {
      const response = await applyLlmRefinementCandidate(
        sessionId,
        candidateDayGroups,
        candidateUnassignedActivityIds,
        llmRefinementResult
          ? {
            ...llmRefinementResult,
            accepted: true,
          }
          : null
      );
      if (response.success) {
        applySessionResponse(response, true);
        setLlmRefinementPreview(null);
        setLlmRefinementDiffOpen(false);
        setLlmRefinementDiffOffset({ x: 0, y: 0 });
      }
    } catch (error) {
      console.error("LLM refinement apply error:", error);
      alert("Failed to apply LLM refinement candidate. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGroupingDebugTotalCostChange = useCallback((totalCost: number | null) => {
    setGroupingDebugTotalCost(totalCost);
  }, []);

  const handleLlmRefinementDiffDragStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();

    const origin = llmRefinementDiffOffsetRef.current;
    const startX = event.clientX;
    const startY = event.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextX = origin.x + (moveEvent.clientX - startX);
      const nextY = origin.y + (moveEvent.clientY - startY);
      setLlmRefinementDiffOffset({ x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  const handleRefreshAccommodationSearch = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "refresh_accommodation_search",
      });
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Refresh accommodation error:", error);
      alert("Failed to refresh accommodation search. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleContinueToRestaurants = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "continue_to_restaurants",
      });
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Continue to restaurants error:", error);
      alert("Failed to load restaurant suggestions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipRestaurantsFromStage = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await setMealPreferences(sessionId, false, []);
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Skip restaurants error:", error);
      alert("Failed to skip restaurants. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRestaurantSelectionChange = (ids: string[]) => {
    setSelectedRestaurantIds(ids);
  };

  const handleRemoveRestaurant = async (restaurantId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await removeCard(sessionId, "restaurant", restaurantId);
      if (response.success) {
        delete response.selectedRestaurantIds;
        applySessionResponse(response, false);
        setSelectedRestaurantIds((prev) => prev.filter((id) => id !== restaurantId));
      }
    } catch (error) {
      console.error("Remove restaurant error:", error);
      alert("Failed to remove restaurant card. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMealPreferences = async (shouldAddRestaurants: boolean) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, shouldAddRestaurants
        ? {
          type: "add_restaurants",
          payload: { selectedRestaurantIds },
        }
        : {
          type: "skip_restaurants",
        });
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Set meal preferences error:", error);
      alert("Failed to save restaurant selection. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshFlightSearch = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "refresh_flight_search",
      });
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Refresh flights error:", error);
      alert("Failed to refresh flight search. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAccommodation = async (optionId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "select_accommodation",
        payload: { optionId },
      });
      if (response.success) {
        applySessionResponse(response, true);
        const flightMade = response.wantsFlight === false || response.selectedFlightOptionId != null;
        if (!flightMade) {
          setReviewOfferTab("flights");
        }
      }
    } catch (error) {
      console.error("Select accommodation error:", error);
      alert("Failed to save hotel selection. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipAccommodation = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "skip_accommodation",
      });
      if (response.success) {
        applySessionResponse(response, true);
        const flightMade = response.wantsFlight === false || response.selectedFlightOptionId != null;
        if (!flightMade) {
          setReviewOfferTab("flights");
        }
      }
    } catch (error) {
      console.error("Skip accommodation error:", error);
      alert("Failed to skip hotels. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAccommodationOption = async (optionId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await removeCard(sessionId, "accommodation", optionId);
      if (response.success) {
        applySessionResponse(response, false);
      }
    } catch (error) {
      console.error("Remove accommodation option error:", error);
      alert("Failed to remove hotel card. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFlight = async (optionId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "select_flight",
        payload: { optionId },
      });
      if (response.success) {
        applySessionResponse(response, true);
        const accMade = response.wantsAccommodation === false || response.selectedAccommodationOptionId != null;
        if (!accMade) {
          setReviewOfferTab("hotels");
        }
      }
    } catch (error) {
      console.error("Select flight error:", error);
      alert("Failed to save flight selection. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipFlight = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "skip_flight",
      });
      if (response.success) {
        applySessionResponse(response, true);
        const accMade = response.wantsAccommodation === false || response.selectedAccommodationOptionId != null;
        if (!accMade) {
          setReviewOfferTab("hotels");
        }
      }
    } catch (error) {
      console.error("Skip flight error:", error);
      alert("Failed to skip flights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFlightOption = async (optionId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await removeCard(sessionId, "flight", optionId);
      if (response.success) {
        applySessionResponse(response, false);
      }
    } catch (error) {
      console.error("Remove flight option error:", error);
      alert("Failed to remove flight card. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Finalize
  const handleFinalize = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "finalize_trip",
      });
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Finalize error:", error);
      alert("Failed to finalize itinerary. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRunAiCheck = async () => {
    if (!sessionId || loading || workflowState === WORKFLOW_STATES.FINALIZE) return;
    setLoading(true);
    try {
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "run_ai_check",
      });
      if (response.success) {
        applySessionResponse(response, true);
      }
    } catch (error) {
      console.error("Run AI check error:", error);
      alert("Failed to run AI check. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Update preferences
  const handleUpdatePreferences = async (newPreferences: string[]) => {
    if (!sessionId) return;

    // Optimistic update
    const updatedTripInfo = { ...tripInfo, preferences: newPreferences };
    setTripInfo(updatedTripInfo);
    setLoading(true);

    try {
      const response = await updateTripInfo(sessionId, { preferences: newPreferences });
      if (response.success && response.tripInfo) {
        setTripInfo(response.tripInfo);
      }
    } catch (error) {
      console.error("Failed to update preferences:", error);
      alert("Failed to save preferences. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const parsePreferencesFromInput = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  async function persistTripInfoUpdate(updates: Partial<TripInfo>) {
    if (!sessionId) return true;
    setTripBasicsSaving(true);
    try {
      const response = await updateTripInfo(sessionId, updates);
      if (response.success && response.tripInfo) {
        setTripInfo(response.tripInfo);
      }
      return true;
    } catch (error) {
      console.error("Failed to update trip basics:", error);
      return false;
    } finally {
      setTripBasicsSaving(false);
    }
  }

  const handleTripFieldBlur = async (updates: Partial<TripInfo>) => {
    await persistTripInfoUpdate(updates);
  };

  const handleProceedFromTripBasics = async () => {
    if (!sessionId) return;
    const hasRequiredBasics =
      Boolean(tripInfo.destination?.trim()) && Boolean(tripInfo.startDate) && Boolean(tripInfo.endDate);
    if (!hasRequiredBasics) return;

    const synced = await persistTripInfoUpdate({
      source: tripInfo.source,
      destination: tripInfo.destination,
      startDate: tripInfo.startDate,
      endDate: tripInfo.endDate,
      durationDays: tripInfo.durationDays,
      travelers: tripInfo.travelers,
      activityLevel: tripInfo.activityLevel,
      budget: tripInfo.budget,
      preferences: tripInfo.preferences,
    });
    if (!synced) {
      alert("Could not save trip basics. Please try again.");
      return;
    }
    await handleGenerateResearchBrief("fast");
  };

  const updateMaxReachedState = (state: string) => {
    setMaxReachedState((currentMax) => {
      const currentIndex = WORKFLOW_ORDER.indexOf(state);
      const maxIndex = WORKFLOW_ORDER.indexOf(currentMax);
      return currentIndex > maxIndex ? state : currentMax;
    });
  };

  const accommodationDecisionMade = wantsAccommodation === false || selectedAccommodationOptionId != null;
  const flightDecisionMade = wantsFlight === false || selectedFlightOptionId != null;
  const travelOfferReadyForFinalize = accommodationDecisionMade && flightDecisionMade;

  const requiresTravelOfferCompletion = (state: string) =>
    state === WORKFLOW_STATES.FINALIZE;

  const selectedAccommodationOption =
    selectedAccommodationOptionId != null
      ? accommodationOptions.find((option) => option.id === selectedAccommodationOptionId) || null
      : null;

  const selectedFlightOption =
    selectedFlightOptionId != null
      ? flightOptions.find((option) => option.id === selectedFlightOptionId) || null
      : null;

  const handleGoBack = async () => {
    if (!sessionId) return;
    const currentIndex = WORKFLOW_ORDER.indexOf(workflowState);
    if (currentIndex > 0) {
      const prevState = WORKFLOW_ORDER[currentIndex - 1];
      setLoading(true);
      try {
        await updateWorkflowState(sessionId, prevState, { transitionOwner: "UI" });
        setWorkflowState(prevState);
      } catch (error) {
        console.error("Go back error:", error);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleGoForward = async () => {
    if (!sessionId) return;
    const currentIndex = WORKFLOW_ORDER.indexOf(workflowState);
    const maxIndex = WORKFLOW_ORDER.indexOf(maxReachedState);
    if (currentIndex < maxIndex) {
      const nextState = WORKFLOW_ORDER[currentIndex + 1];
      if (requiresTravelOfferCompletion(nextState) && !travelOfferReadyForFinalize) {
        alert("Select or skip one hotel and one flight before continuing.");
        return;
      }
      setLoading(true);
      try {
        await updateWorkflowState(sessionId, nextState, { transitionOwner: "UI" });
        setWorkflowState(nextState);
      } catch (error) {
        console.error("Go forward error:", error);
      } finally {
        setLoading(false);
      }
    }
  };


  // Handle clicking activity on map
  const handleMapActivityClick = (activityId: string) => {
    if (workflowState === WORKFLOW_STATES.SUGGEST_ACTIVITIES) {
      // Toggle selection
      setSelectedActivityIds((prev) =>
        prev.includes(activityId) ? prev.filter((id) => id !== activityId) : [...prev, activityId]
      );
    }
  };

  const getCurrentUiStageIndex = () => {
    return WORKFLOW_TO_UI_STAGE[workflowState] ?? 0;
  };

  const getMaxReachedUiStageIndex = () => {
    return WORKFLOW_TO_UI_STAGE[maxReachedState] ?? 0;
  };

  const handleUiStageClick = async (stageIndex: number) => {
    if (!sessionId || loading) return;
    const maxStage = getMaxReachedUiStageIndex();
    if (stageIndex > maxStage) return;

    const targetState = UI_STAGE_TO_WORKFLOW[stageIndex];
    if (!targetState || targetState === workflowState) return;
    if (requiresTravelOfferCompletion(targetState) && !travelOfferReadyForFinalize) {
      alert("Select or skip one hotel and one flight before moving to this stage.");
      return;
    }

    setLoading(true);
    try {
      await updateWorkflowState(sessionId, targetState, { transitionOwner: "UI" });
      setWorkflowState(targetState);
    } catch (error) {
      console.error("Jump to stage error:", error);
    } finally {
      setLoading(false);
    }
  };

  const activeTimelineLocations = timelineAnalysis?.mapPoints?.[activeTimelineView] || [];
  const isFinalized = workflowState === WORKFLOW_STATES.FINALIZE;
  const selectedActivitiesForGrouping = useMemo(
    () => suggestedActivities.filter((activity) => selectedActivityIds.includes(activity.id)),
    [suggestedActivities, selectedActivityIds]
  );
  const activityNameById = useMemo(
    () => buildActivityNameLookup(suggestedActivities, groupedDays),
    [suggestedActivities, groupedDays]
  );
  const llmRefineSuggestedOperationsWithNames = useMemo(() => {
    const rawSuggestions = Array.isArray(llmRefinementResult?.suggestedOperations)
      ? llmRefinementResult.suggestedOperations
      : [];
    return mapLlmSuggestedOperationsWithNames(rawSuggestions, activityNameById);
  }, [llmRefinementResult, activityNameById]);
  const llmRefinementBeforeDays = llmRefinementPreview?.currentSchedule?.groupedDays ?? llmRefinementPreview?.beforeGroupedDays ?? groupedDays;
  const llmRefinementAfterDays = llmRefinementPreview?.tentativeSchedule?.groupedDays ?? llmRefinementPreview?.afterGroupedDays ?? null;
  const llmRefinementBeforeTotal =
    extractOverallDebugCostFromDays(llmRefinementBeforeDays)
    ?? groupingDebugTotalCost;
  const llmRefinementCandidateTotal =
    extractOverallDebugCostFromDays(llmRefinementAfterDays);
  const {
    beforeTotal: llmRefinementDisplayedBeforeTotal,
    candidateTotal: llmRefinementDisplayedCandidateTotal,
  } = chooseScheduleBackedRefinementTotals({
    beforeScheduleTotal: llmRefinementBeforeTotal,
    candidateScheduleTotal: llmRefinementCandidateTotal,
    resultBeforeTotal: llmRefinementResult?.beforeTotalCost,
    resultCandidateTotal: llmRefinementResult?.candidateTotalCost,
  });
  const llmRefinementTotalDelta =
    llmRefinementDisplayedBeforeTotal != null && llmRefinementDisplayedCandidateTotal != null
      ? llmRefinementDisplayedCandidateTotal - llmRefinementDisplayedBeforeTotal
      : null;
  const llmRefinementImproves = llmRefinementTotalDelta != null
    ? llmRefinementTotalDelta < 0
    : false;
  const llmRefinementBeforeUnassignedIds = useMemo(() => {
    return uniqueOrderedIds(
      llmRefinementPreview?.currentSchedule?.unassignedActivityIds
      ?? llmRefinementPreview?.beforeUnassignedActivityIds
      ?? llmRefinementRequestBaseUnassignedIds
    );
  }, [llmRefinementPreview, llmRefinementRequestBaseUnassignedIds]);
  const llmRefinementAfterUnassignedIds = useMemo(() => {
    return uniqueOrderedIds(
      llmRefinementPreview?.tentativeSchedule?.unassignedActivityIds
      ?? llmRefinementPreview?.afterUnassignedActivityIds
      ?? []
    );
  }, [llmRefinementPreview]);
  const llmRefinementBeforeUnassignedNames = useMemo(
    () => llmRefinementBeforeUnassignedIds.map((id) => activityNameById.get(id) ?? id),
    [llmRefinementBeforeUnassignedIds, activityNameById]
  );
  const llmRefinementAfterUnassignedNames = useMemo(
    () => llmRefinementAfterUnassignedIds.map((id) => activityNameById.get(id) ?? id),
    [llmRefinementAfterUnassignedIds, activityNameById]
  );
  const llmRefinementDayRows = useMemo(() => {
    if (!llmRefinementBeforeDays || !llmRefinementAfterDays) return [];
    const beforeByDay = new Map(llmRefinementBeforeDays.map((day) => [day.dayNumber, day]));
    const afterByDay = new Map(llmRefinementAfterDays.map((day) => [day.dayNumber, day]));
    const dayNumbers = Array.from(new Set([...beforeByDay.keys(), ...afterByDay.keys()])).sort((a, b) => a - b);
    return dayNumbers.map((dayNumber) => {
      const beforeDay = beforeByDay.get(dayNumber);
      const afterDay = afterByDay.get(dayNumber);
      const beforeIds = beforeDay ? beforeDay.activities.map((activity) => activity.id) : [];
      const afterIds = afterDay ? afterDay.activities.map((activity) => activity.id) : [];
      const beforeSet = new Set(beforeIds);
      const afterSet = new Set(afterIds);
      const addedIds = afterIds.filter((id) => !beforeSet.has(id));
      const removedIds = beforeIds.filter((id) => !afterSet.has(id));
      const addedNames = addedIds.map((id) => activityNameById.get(id) ?? id);
      const removedNames = removedIds.map((id) => activityNameById.get(id) ?? id);
      const beforeActivityNames = beforeIds.map((id) => activityNameById.get(id) ?? id);
      const afterActivityNames = afterIds.map((id) => activityNameById.get(id) ?? id);
      const beforeNightStay = beforeDay?.nightStay?.label ?? null;
      const afterNightStay = afterDay?.nightStay?.label ?? null;
      const nightStayChanged = beforeNightStay !== afterNightStay;
      const hasChanges = addedNames.length > 0 || removedNames.length > 0 || nightStayChanged;
      return {
        dayNumber,
        beforeActivityNames,
        afterActivityNames,
        addedNames,
        removedNames,
        beforeNightStay,
        afterNightStay,
        nightStayChanged,
        beforeDayCost: beforeDay?.debugCost?.dayCost ?? null,
        afterDayCost: afterDay?.debugCost?.dayCost ?? null,
        hasChanges,
        unchanged: !hasChanges,
      };
    });
  }, [llmRefinementBeforeDays, llmRefinementAfterDays, activityNameById]);
  const llmRefinementBeforeCostSummary = useMemo(
    () => extractGlobalDebugCostSummary(llmRefinementBeforeDays),
    [llmRefinementBeforeDays]
  );
  const llmRefinementAfterCostSummary = useMemo(
    () => extractGlobalDebugCostSummary(llmRefinementAfterDays),
    [llmRefinementAfterDays]
  );

  // Render left panel content based on state
  const renderLeftPanelContent = () => {
    const currentIndex = WORKFLOW_ORDER.indexOf(workflowState);
    const maxIndex = WORKFLOW_ORDER.indexOf(maxReachedState);
    const canGoBack = currentIndex > 1; // Don't go back to info gathering via buttons
    const rawCanGoForward = currentIndex < maxIndex;
    const nextState = rawCanGoForward ? WORKFLOW_ORDER[currentIndex + 1] : null;
    const canGoForward =
      rawCanGoForward && (!nextState || !requiresTravelOfferCompletion(nextState) || travelOfferReadyForFinalize);

    const selectionsChanged =
      (workflowState === WORKFLOW_STATES.GROUP_DAYS || workflowState === WORKFLOW_STATES.DAY_ITINERARY) &&
      (selectedActivityIds.length !== lastGroupedActivityIds.length ||
        !selectedActivityIds.every(id => lastGroupedActivityIds.includes(id)));

    const aiCheckInsightTone =
      aiCheckResult?.status === "ERROR"
        ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
        : "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100";
    const aiCheckDetailTone =
      aiCheckResult?.status === "ERROR"
        ? "border-red-200 bg-red-50"
        : "border-sky-200 bg-sky-50";
    const aiCheckCheckedLabel = aiCheckResult
      ? new Date(aiCheckResult.checkedAt).toLocaleString()
      : null;
    const aiCheckPreview = aiCheckResult
      ? aiCheckResult.summary
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => Boolean(line)) || "AI commentary available."
      : null;
    const showAiCheckInHeaderActionBars =
      workflowState === WORKFLOW_STATES.INITIAL_RESEARCH || workflowState === WORKFLOW_STATES.GROUP_DAYS;
    const aiInlineActions = !isFinalized && showAiCheckInHeaderActionBars ? (
      <div className="relative flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRunAiCheck}
          disabled={loading || !sessionId}
          className="h-8 px-2 text-xs text-gray-500 hover:text-gray-800"
        >
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Run check
        </Button>
        {aiCheckResult ? (
          <div ref={aiInsightPopupRef} className="relative">
            <button
              type="button"
              onClick={() => setIsAiCheckCollapsed((current) => !current)}
              className={`inline-flex max-w-[280px] items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${aiCheckInsightTone}`}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">AI insight: {aiCheckPreview}</span>
              {isAiCheckCollapsed ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              )}
            </button>
            {!isAiCheckCollapsed ? (
              <div
                className={`absolute right-0 top-full z-50 mt-2 w-[min(36rem,calc(100vw-2rem))] rounded-lg border px-4 py-3 shadow-lg ${aiCheckDetailTone}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-gray-700">
                    AI insight{aiCheckCheckedLabel ? ` (${aiCheckCheckedLabel})` : ""}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAiCheckCollapsed(true)}
                    className="h-7 px-2 text-xs text-gray-600 hover:text-gray-900"
                  >
                    Hide <ChevronUp className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-2 max-h-[50vh] overflow-y-auto pr-1">{renderAiCommentary(aiCheckResult.summary)}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

    return (
      <div className="flex h-full min-h-0 flex-col bg-gray-100">
        {/* Navigation Bar */}
        {(canGoBack || canGoForward || selectionsChanged) && (
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 sticky top-0 z-20">
            <div className="flex gap-2">
              {canGoBack && (
                <Button variant="ghost" size="sm" onClick={handleGoBack} disabled={loading} className="text-gray-500">
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              )}
              {canGoForward && (
                <Button variant="ghost" size="sm" onClick={handleGoForward} disabled={loading} className="text-gray-500">
                  Forward
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
            {selectionsChanged && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleConfirmActivitySelection}
                disabled={loading}
                className="text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Selections changed – Reorganize?
              </Button>
            )}
            {rawCanGoForward && !canGoForward && (
              <span className="text-xs text-amber-700">
                Complete accommodation and flight searches to continue.
              </span>
            )}
          </div>
        )}

        <div ref={leftPanelScrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {(() => {
            switch (workflowState) {
              case WORKFLOW_STATES.INFO_GATHERING: {
                const hasRequiredBasics =
                  Boolean(tripInfo.destination?.trim()) && Boolean(tripInfo.startDate) && Boolean(tripInfo.endDate);

                return (
                  <div className="p-4">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900">Trip Basics</h2>
                          <p className="mt-1 text-sm text-gray-600">
                            Fill these details here or share them in chat. Both stay in sync.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={debugMode ? "default" : "outline"}
                          onClick={() => setDebugMode((prev) => !prev)}
                          disabled={loading || tripBasicsSaving}
                        >
                          {debugMode ? "Debug mode: on" : "Debug mode: off"}
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Source
                          </label>
                          <Input
                            value={tripInfo.source || ""}
                            onChange={(e) => setTripInfo((prev) => ({ ...prev, source: e.target.value || null }))}
                            onBlur={(e) => handleTripFieldBlur({ source: e.target.value.trim() || null })}
                            placeholder="e.g. San Francisco"
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Destination
                          </label>
                          <Input
                            value={tripInfo.destination || ""}
                            onChange={(e) => setTripInfo((prev) => ({ ...prev, destination: e.target.value || null }))}
                            onBlur={(e) => handleTripFieldBlur({ destination: e.target.value.trim() || null })}
                            placeholder="e.g. Maui"
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Start Date
                          </label>
                          <Input
                            type="date"
                            value={tripInfo.startDate || ""}
                            onChange={(e) => setTripInfo((prev) => ({ ...prev, startDate: e.target.value || null }))}
                            onBlur={(e) => handleTripFieldBlur({ startDate: e.target.value || null })}
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            End Date
                          </label>
                          <Input
                            type="date"
                            value={tripInfo.endDate || ""}
                            onChange={(e) => setTripInfo((prev) => ({ ...prev, endDate: e.target.value || null }))}
                            onBlur={(e) => handleTripFieldBlur({ endDate: e.target.value || null })}
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Duration (Days)
                          </label>
                          <Input
                            type="number"
                            min={1}
                            value={tripInfo.durationDays ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTripInfo((prev) => ({
                                ...prev,
                                durationDays: value ? Number(value) : null,
                              }));
                            }}
                            onBlur={(e) => {
                              const value = e.target.value;
                              handleTripFieldBlur({ durationDays: value ? Number(value) : null });
                            }}
                            placeholder="e.g. 5"
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Travelers
                          </label>
                          <Input
                            type="number"
                            min={1}
                            value={tripInfo.travelers ?? 1}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTripInfo((prev) => ({
                                ...prev,
                                travelers: value ? Number(value) : 1,
                              }));
                            }}
                            onBlur={(e) => {
                              const value = e.target.value;
                              handleTripFieldBlur({ travelers: value ? Number(value) : 1 });
                            }}
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Activity Level
                          </label>
                          <select
                            value={tripInfo.activityLevel || "moderate"}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTripInfo((prev) => ({ ...prev, activityLevel: value }));
                              handleTripFieldBlur({ activityLevel: value });
                            }}
                            disabled={loading || tripBasicsSaving}
                            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="relaxed">Relaxed</option>
                            <option value="moderate">Moderate</option>
                            <option value="active">Active</option>
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Budget
                          </label>
                          <Input
                            value={tripInfo.budget || ""}
                            onChange={(e) => setTripInfo((prev) => ({ ...prev, budget: e.target.value || null }))}
                            onBlur={(e) => handleTripFieldBlur({ budget: e.target.value.trim() || null })}
                            placeholder="e.g. mid-range"
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                            Interests & Preferences
                          </label>
                          <Input
                            value={tripBasicsPreferencesInput}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTripBasicsPreferencesInput(value);
                            }}
                            onBlur={(e) => {
                              const parsedPreferences = parsePreferencesFromInput(e.target.value);
                              setTripInfo((prev) => ({
                                ...prev,
                                preferences: parsedPreferences,
                              }));
                              handleTripFieldBlur({ preferences: parsedPreferences });
                            }}
                            placeholder="snorkeling, hiking, local food"
                            disabled={loading || tripBasicsSaving}
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <TimelineInsightsPanel
                            timelineLoading={timelineLoading}
                            timelineFileName={timelineFileName}
                            timelineAnalysis={timelineAnalysis}
                            activeView={activeTimelineView}
                            onViewChange={setActiveTimelineView}
                            onUpload={handleTimelineUpload}
                          />
                        </div>
                      </div>

                      <div className="mt-5 flex items-center justify-between gap-3">
                        <p className="text-xs text-gray-500">
                          Required: destination, start date, end date
                        </p>
                        <Button
                          onClick={handleProceedFromTripBasics}
                          disabled={!hasRequiredBasics || loading || tripBasicsSaving}
                        >
                          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Proceed to activities
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }

              case WORKFLOW_STATES.INITIAL_RESEARCH:
                return (
                  <InitialResearchView
                    tripInfo={tripInfo}
                    researchBrief={tripResearchBrief}
                    selectedOptionIds={selectedResearchOptionIds}
                    onSelectionChange={handleResearchSelectionChange}
                    onRemoveOption={handleRemoveResearchOption}
                    onResolveDurationConflict={handleResolveDurationConflict}
                    onUpdateTravelLogistics={handleUpdateTravelLogistics}
                    hasUnresolvedAssumptionConflicts={hasUnresolvedAssumptionConflicts}
                    onRegenerate={() => handleGenerateResearchBrief("deep", "augment")}
                    onDeepResearchAll={handleDeepResearchSelected}
                    onDeepResearchOption={handleDeepResearchOption}
                    deepResearchOptionId={deepResearchOptionId}
                    lastDeepResearchAtByOptionId={lastDeepResearchAtByOptionId}
                    onProceed={handleProceedFromResearch}
                    canProceed={hasAnySelectedResearchOption}
                    isLoading={loading}
                    headerActions={aiInlineActions}
                    debugMode={debugMode}
                    onToggleDebugMode={() => setDebugMode((prev) => !prev)}
                  />
                );


              case WORKFLOW_STATES.GROUP_DAYS:
                return (
                  <div className="p-4 h-full min-h-0 flex flex-col">
                    <DayGroupingView
                      groupedDays={groupedDays}
                      userPreferences={tripInfo?.preferences || []}
                      debugMode={debugMode}
                      destination={tripInfo?.destination || null}
                      tripInfo={tripInfo || undefined}
                      onMoveActivity={handleMoveActivity}
                      onConfirm={handleConfirmDayGrouping}
                      onDayChange={setActiveDay}
                      onOverallDebugCostChange={handleGroupingDebugTotalCostChange}
                      isLoading={loading}
                      availableActivities={selectedActivitiesForGrouping}
                      initialUnscheduledActivityIds={unassignedActivityIds}
                      activityCostDebugById={activityCostDebugById}
                      headerActions={
                        <div className="flex items-start gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleLlmRefineStep}
                            disabled={loading || !sessionId}
                            className="h-8 px-3 text-xs"
                          >
                            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                            LLM Refine
                          </Button>
                          <details className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700">
                            <summary className="cursor-pointer font-medium text-gray-800">LLM Debug</summary>
                            <div className="mt-2 space-y-2">
                              <label className="block text-[11px] font-medium text-gray-700">
                                Manual LLM response (JSON)
                                <textarea
                                  value={llmRefinementManualResponse}
                                  onChange={(event) => setLlmRefinementManualResponse(event.target.value)}
                                  placeholder='{"operations":[{"type":"no_op","reason":"..."}]}'
                                  className="mt-1 h-24 w-[360px] rounded border border-gray-300 px-2 py-1 font-mono text-[10px] leading-4 text-gray-900"
                                />
                              </label>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] text-gray-500">
                                  When this field is non-empty, refinement uses this JSON instead of calling the LLM.
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={handleUseManualLlmJson}
                                  disabled={loading || !sessionId || !llmRefinementManualResponse.trim()}
                                  className="h-7 px-2 text-[10px]"
                                >
                                  Use Manual JSON
                                </Button>
                              </div>
                              <label className="block text-[11px] font-medium text-gray-700">
                                Last prompt sent to LLM
                                <textarea
                                  value={llmRefinementPromptDebug}
                                  readOnly
                                  className="mt-1 h-28 w-[360px] rounded border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-[10px] leading-4 text-gray-900"
                                />
                              </label>
                            </div>
                          </details>
                          {llmRefinementResult ? (
                            <div
                              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                                llmRefinementResult.accepted
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : "border-amber-200 bg-amber-50 text-amber-800"
                              }`}
                              title={llmRefinementResult.reason || llmRefinementResult.operationSummary || ""}
                            >
                              Total trip cost: {llmRefinementDisplayedBeforeTotal != null ? llmRefinementDisplayedBeforeTotal.toFixed(2) : "N/A"}
                              {" → "}
                              {llmRefinementDisplayedCandidateTotal != null ? llmRefinementDisplayedCandidateTotal.toFixed(2) : "N/A"}
                              {llmRefinementDisplayedBeforeTotal != null && llmRefinementDisplayedCandidateTotal != null
                                ? ` (${(llmRefinementDisplayedCandidateTotal - llmRefinementDisplayedBeforeTotal).toFixed(2)})`
                                : ""}
                              {" · "}
                              {llmRefinementResult.operationCount > 0 ? `${llmRefinementResult.operationCount} op${llmRefinementResult.operationCount === 1 ? "" : "s"}` : "0 ops"}
                              {" · "}
                              {llmRefinementPreview ? "Pending" : llmRefinementResult.accepted ? "Accepted" : "Rejected"}
                              {llmRefinementResult.candidateTotalCost != null ? (
                                <span className="block">
                                  Candidate: {llmRefinementResult.candidateTotalCost.toFixed(2)}
                                </span>
                              ) : null}
                              {llmRefinementResult.operationSummary ? (
                                <span className="block">
                                  LLM plan: {llmRefinementResult.operationSummary}
                                </span>
                              ) : null}
                              {llmRefineSuggestedOperationsWithNames.length > 0 ? (
                                <details open className="mt-1 text-[10px] leading-4">
                                  <summary className="cursor-pointer">LLM suggestions</summary>
                                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-black/10 bg-white/70 p-1">
                                    {JSON.stringify(llmRefineSuggestedOperationsWithNames, null, 2)}
                                  </pre>
                                </details>
                              ) : null}
                            </div>
                          ) : null}
                          {aiInlineActions}
                        </div>
                      }
                    />
                  </div>
                );

              case WORKFLOW_STATES.DAY_ITINERARY:
                return (
                  <div className="p-4">
                    <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Restaurants</p>
                        <p className="text-xs text-gray-600">
                          Add nearby restaurants before moving to Hotels & Flights.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={handleContinueToRestaurants} disabled={loading}>
                          Find nearby restaurants
                        </Button>
                        <Button variant="outline" onClick={handleSkipRestaurantsFromStage} disabled={loading}>
                          Skip restaurants
                        </Button>
                      </div>
                    </div>
                  </div>
                );

              case WORKFLOW_STATES.MEAL_PREFERENCES:
                return (
                  <div className="p-4">
                    <RestaurantSelectionView
                      restaurants={restaurantSuggestions}
                      selectedIds={selectedRestaurantIds}
                      onSelectionChange={handleRestaurantSelectionChange}
                      onRemoveRestaurant={handleRemoveRestaurant}
                      onConfirm={handleMealPreferences}
                      isLoading={loading}
                    />
                  </div>
                );

              case WORKFLOW_STATES.REVIEW:
                return (
                  <div className="p-4 h-full flex flex-col gap-3">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <h2 className="text-lg font-semibold text-gray-900">Hotels & Flights</h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Review accommodation and flight suggestions for your trip, one tab at a time.
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={reviewOfferTab === "hotels" ? "default" : "outline"}
                          onClick={() => setReviewOfferTab("hotels")}
                          disabled={loading}
                        >
                          Hotels
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={reviewOfferTab === "flights" ? "default" : "outline"}
                          onClick={() => setReviewOfferTab("flights")}
                          disabled={loading}
                        >
                          Flights
                        </Button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      {reviewOfferTab === "hotels" ? (
                        <AccommodationSuggestionsView
                          status={accommodationStatus}
                          error={accommodationError}
                          options={accommodationOptions}
                          selectedOptionId={selectedAccommodationOptionId}
                          wantsAccommodation={wantsAccommodation}
                          lastSearchedAt={accommodationLastSearchedAt}
                          onRefresh={handleRefreshAccommodationSearch}
                          onConfirmSelection={handleSelectAccommodation}
                          onRemoveOption={handleRemoveAccommodationOption}
                          onSkip={handleSkipAccommodation}
                          isLoading={loading}
                        />
                      ) : (
                        <FlightSuggestionsView
                          status={flightStatus}
                          error={flightError}
                          options={flightOptions}
                          selectedOptionId={selectedFlightOptionId}
                          wantsFlight={wantsFlight}
                          lastSearchedAt={flightLastSearchedAt}
                          onRefresh={handleRefreshFlightSearch}
                          onConfirmSelection={handleSelectFlight}
                          onRemoveOption={handleRemoveFlightOption}
                          onSkip={handleSkipFlight}
                          isLoading={loading}
                        />
                      )}
                    </div>
                    <div>
                      <Button onClick={handleFinalize} disabled={loading || !travelOfferReadyForFinalize}>
                        Continue to Final Review
                      </Button>
                      {!travelOfferReadyForFinalize ? (
                        <p className="mt-2 text-xs text-amber-700">
                          Select or skip one hotel and one flight before final review.
                        </p>
                      ) : null}
                    </div>
                  </div>
                );

              case WORKFLOW_STATES.FINALIZE:
                return (
                  <div className="p-4 overflow-hidden h-full flex flex-col gap-3">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <h2 className="text-lg font-semibold text-gray-900">Final Review</h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Your itinerary includes {accommodationOptions.length} accommodation options and {flightOptions.length} flight options.
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <DayItineraryView
                        groupedDays={groupedDays}
                        selectedAccommodation={selectedAccommodationOption}
                        selectedFlight={selectedFlightOption}
                        tripInfo={tripInfo || undefined}
                        onActivityHover={setHoveredActivityId}
                        onMoveActivity={handleMoveActivity}
                        onDayChange={setActiveDay}
                      />
                    </div>
                  </div>
                );

              default:
                return null;
            }
          })()}
        </div>
      </div>
    );
  };

  if (initializing) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
          <span className="text-gray-600">Starting your planning session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-gray-100">
      <div className="flex h-full flex-col">
        <div className="border-b border-gray-200 bg-white px-4 py-2">
          <div className="overflow-x-auto">
            <div className="relative min-w-[760px] px-2 pb-0.5 pt-1">
              <div className="absolute left-6 right-6 top-5 h-px bg-gray-300" />
              <div
                className="absolute left-6 top-5 h-px bg-blue-500 transition-all"
                style={{
                  width: `calc((100% - 3rem) * ${getCurrentUiStageIndex() / (UI_STAGE_LABELS.length - 1)})`,
                }}
              />
              <div
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${UI_STAGE_LABELS.length}, minmax(0, 1fr))` }}
              >
                {UI_STAGE_LABELS.map((label, index) => {
                  const current = getCurrentUiStageIndex();
                  const maxReached = getMaxReachedUiStageIndex();
                  const isCompleted = index < current;
                  const isCurrent = index === current;
                  const candidateState = UI_STAGE_TO_WORKFLOW[index];
                  const blockedBySearch =
                    candidateState && requiresTravelOfferCompletion(candidateState) && !travelOfferReadyForFinalize;
                  const isClickable = index <= maxReached && !loading && !blockedBySearch;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleUiStageClick(index)}
                      disabled={!isClickable}
                      className={`flex flex-col items-center gap-2 px-1 text-center ${isClickable ? "cursor-pointer" : "cursor-not-allowed"}`}
                      title={isClickable ? `Go to ${label}` : `Complete earlier stages to unlock ${label}`}
                    >
                      <span
                        className={`z-10 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${isCurrent
                          ? "border-blue-600 bg-blue-600 text-white"
                          : isCompleted
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-gray-300 bg-white text-gray-500"
                          }`}
                      >
                        {isCompleted ? "✓" : index + 1}
                      </span>
                      <span className={`text-[11px] font-medium leading-tight ${isCurrent ? "text-blue-700" : "text-gray-600"}`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {apiWarnings.length > 0 ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
            <div className="space-y-2">
              {apiWarnings.map((warning) => (
                <div
                  key={warning.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-white/80 px-3 py-2"
                >
                  <div className="flex items-start gap-2 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-semibold">API warning ({warning.endpoint || "unknown endpoint"})</p>
                      <p className="text-amber-800">{warning.message}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-amber-700 hover:bg-amber-100"
                    onClick={() => setApiWarnings((prev) => prev.filter((item) => item.id !== warning.id))}
                    aria-label="Dismiss API warning"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Left Panel: Itinerary / Workflow Content */}
          <div className="w-full lg:w-[55%] h-full min-h-0 flex flex-col bg-gray-100">
            <div className="flex-1 min-h-0 bg-gray-100">
              {renderLeftPanelContent()}
            </div>
          </div>

          {/* Right Panel: Map with AI Companion overlay */}
          <div className="w-full lg:w-[45%] h-full relative bg-gray-100 border-l border-gray-200">
            <div className="absolute inset-0">
              <MapComponent
                destination={tripInfo?.destination}
                tripResearchBrief={tripResearchBrief}
                researchOptionSelections={Object.fromEntries(
                  selectedResearchOptionIds.map((id) => [id, "selected" as const])
                )}
                suggestedActivities={
                  workflowState === WORKFLOW_STATES.SUGGEST_ACTIVITIES ||
                    workflowState === WORKFLOW_STATES.SELECT_ACTIVITIES
                    ? suggestedActivities
                    : undefined
                }
                selectedActivityIds={selectedActivityIds}
                groupedDays={
                  workflowState === WORKFLOW_STATES.GROUP_DAYS ||
                    workflowState === WORKFLOW_STATES.DAY_ITINERARY ||
                    workflowState === WORKFLOW_STATES.MEAL_PREFERENCES ||
                    workflowState === WORKFLOW_STATES.REVIEW ||
                    workflowState === WORKFLOW_STATES.FINALIZE
                    ? groupedDays
                    : undefined
                }
                onActivityClick={handleMapActivityClick}
                hoveredActivityId={hoveredActivityId}
                highlightedDay={activeDay}
                timelineLocations={
                  workflowState === WORKFLOW_STATES.INFO_GATHERING
                    ? activeTimelineLocations
                    : []
                }
                timelineLabel={
                  workflowState === WORKFLOW_STATES.INFO_GATHERING && timelineAnalysis
                    ? `${activeTimelineView.charAt(0).toUpperCase()}${activeTimelineView.slice(1)}`
                    : undefined
                }
              />
            </div>

            {/* AI Travel Companion */}
            <div
              className={`absolute bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-[380px] ${isChatMinimized ? "h-[56px]" : "h-[43%] min-h-[280px] max-h-[440px]"
                } bg-white/95 backdrop-blur border border-gray-200 shadow-xl rounded-2xl flex flex-col overflow-hidden transition-all duration-300`}
            >
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">AI Travel Companion</p>
                  <h1 className="text-sm font-semibold text-gray-800">
                    {tripInfo?.destination || "Planning Your Trip"}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsChatMinimized((prev) => !prev)}
                    className="h-7 w-7 text-gray-400 hover:text-gray-700"
                    title={isChatMinimized ? "Expand" : "Minimize"}
                  >
                    {isChatMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {/* Tab Switcher */}
              <div className={`flex border-b border-gray-100 ${isChatMinimized ? "hidden" : ""}`}>
                <button
                  onClick={() => setActiveTab("chat")}
                  className={`flex-1 py-2 px-3 text-xs font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "chat"
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab("interests")}
                  className={`flex-1 py-2 px-3 text-xs font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "interests"
                    ? "text-rose-600 border-b-2 border-rose-600 bg-rose-50/50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    }`}
                >
                  <Heart className="w-3.5 h-3.5" />
                  Interests
                  {tripInfo?.preferences && tripInfo.preferences.length > 0 && (
                    <Badge className="ml-1 px-1.5 py-0 min-w-[18px] h-[18px] bg-rose-100 text-rose-700 hover:bg-rose-100">
                      {tripInfo.preferences.length}
                    </Badge>
                  )}
                </button>
              </div>

              {!isChatMinimized && activeTab === "chat" ? (
                <>
                  <ScrollArea className="flex-1 p-3" ref={chatScrollRef}>
                    <div className="space-y-3">
                      {chatHistory.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-2xl max-w-[85%] text-sm ${msg.role === "user" ? "bg-blue-300 text-slate-900 ml-auto" : "bg-gray-200 text-gray-800"
                            }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      ))}
                      {loading && (
                        <div className="flex justify-center">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                        </div>
                      )}
                    </div>

                    {workflowState === WORKFLOW_STATES.INFO_GATHERING &&
                      chatHistory.length === 1 &&
                      !loading && (
                        <div className="mt-4 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                          <button
                            onClick={() => handleSuggestionClick("Plan a 4-day moderate trip to Maui from San Francisco from May 10th to May 14th 2026. I'm interested in snorkeling, hiking, and visting local places.")}
                            className="px-3 py-2 rounded-full border border-blue-200 bg-blue-100/80 text-blue-800 text-xs font-medium hover:bg-blue-200/80 transition-colors shadow-sm"
                          >
                            🌴 Maui: 4-day adventure
                          </button>
                          <button
                            onClick={() => handleSuggestionClick("Plan a 4-day relaxed trip to Switzerland from San Francisco from June 15th to June 19th 2026. I'm interested in scenic trains, chocolate, and mountain views.")}
                            className="px-3 py-2 rounded-full border border-blue-200 bg-blue-100/80 text-blue-800 text-xs font-medium hover:bg-blue-200/80 transition-colors shadow-sm"
                          >
                            🏔️ Switzerland: 4-day escape
                          </button>
                        </div>
                      )}

                  </ScrollArea>

                  <div className="p-3 border-t border-gray-100 flex gap-2 flex-shrink-0">
                    <Input
                      ref={chatInputRef}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={
                        workflowState === WORKFLOW_STATES.INFO_GATHERING
                          ? "Tell me about your trip..."
                          : "Ask questions or request changes..."
                      }
                      onKeyDown={(e) => e.key === "Enter" && handleChat()}
                      disabled={loading || isFinalized}
                      className="flex-1 h-9 text-sm"
                    />
                    <Button onClick={handleChat} disabled={loading || !chatInput.trim() || isFinalized} size="icon" className="h-9 w-9">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </>
              ) : null}

              {!isChatMinimized && activeTab === "interests" ? (
                <InterestsPreferencesView
                  preferences={tripInfo?.preferences || []}
                  onUpdatePreferences={handleUpdatePreferences}
                  isLoading={loading}
                />
              ) : null}
            </div>
          </div>
        </div>

        {llmRefinementDiffOpen && llmRefinementPreview ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
            <div
              className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
              style={{ transform: `translate(${llmRefinementDiffOffset.x}px, ${llmRefinementDiffOffset.y}px)` }}
            >
              <div
                className="flex cursor-move items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 select-none"
                onMouseDown={handleLlmRefinementDiffDragStart}
              >
                <div>
                  <h3 className="text-base font-semibold text-gray-900">LLM Refine Diff</h3>
                  <p className="text-xs text-gray-600">
                    Review the proposed itinerary changes and choose whether to apply them.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleCloseLlmRefinementPreview}
                  disabled={loading}
                  aria-label="Close refinement diff"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="max-h-[calc(85vh-8.5rem)] overflow-y-auto px-4 py-3">
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
                  <p>
                    Recommendation:{" "}
                    <span className={llmRefinementImproves ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                      {llmRefinementImproves
                        ? "Accept (total trip cost decreases)"
                        : "Review carefully (total trip cost does not decrease)"}
                    </span>
                  </p>
                  <p>
                    Total trip cost:{" "}
                    {llmRefinementDisplayedBeforeTotal != null ? llmRefinementDisplayedBeforeTotal.toFixed(2) : "N/A"}
                    {" → "}
                    {llmRefinementDisplayedCandidateTotal != null ? llmRefinementDisplayedCandidateTotal.toFixed(2) : "N/A"}
                    {llmRefinementTotalDelta != null ? ` (${llmRefinementTotalDelta.toFixed(2)})` : ""}
                  </p>
                  {llmRefinementResult?.reason ? (
                    <p className="text-xs text-gray-600">Note: {llmRefinementResult.reason}</p>
                  ) : null}
                </div>

                {Array.isArray(llmRefineSuggestedOperationsWithNames) && llmRefineSuggestedOperationsWithNames.length > 0 ? (
                  <div className="mt-3 rounded-md border border-gray-200 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">LLM Suggestions</p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-700">
                      {JSON.stringify(llmRefineSuggestedOperationsWithNames, null, 2)}
                    </pre>
                  </div>
                ) : null}

                {llmRefinementPreview.afterGroupedDays ? (
                  <div className="mt-3 space-y-3">
                    {llmRefinementDayRows.length > 0 ? (
                      llmRefinementDayRows.map((row) => (
                        <div key={row.dayNumber} className="rounded-md border border-gray-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900">Day {row.dayNumber}</p>
                            <span className={`text-xs font-medium ${row.unchanged ? "text-gray-500" : "text-blue-700"}`}>
                              {row.unchanged ? "Unchanged" : "Changed"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-700">
                            Before: {row.beforeActivityNames.length > 0 ? row.beforeActivityNames.join(", ") : "None"}
                          </p>
                          <p className="text-xs text-gray-700">
                            After: {row.afterActivityNames.length > 0 ? row.afterActivityNames.join(", ") : "None"}
                          </p>
                          {row.addedNames.length > 0 ? (
                            <p className="text-xs text-emerald-700">Added: {row.addedNames.join(", ")}</p>
                          ) : null}
                          {row.removedNames.length > 0 ? (
                            <p className="text-xs text-rose-700">Removed: {row.removedNames.join(", ")}</p>
                          ) : null}
                          {row.nightStayChanged ? (
                            <p className="text-xs text-blue-700">
                              Night stay: {row.beforeNightStay || "None"} → {row.afterNightStay || "None"}
                            </p>
                          ) : null}
                          {row.unchanged ? (
                            <p className="text-xs text-gray-500">No itinerary changes for this day.</p>
                          ) : null}
                          {debugMode ? (
                            <p className="text-xs text-gray-600">
                              Day cost: {row.beforeDayCost != null ? row.beforeDayCost.toFixed(2) : "N/A"} →{" "}
                              {row.afterDayCost != null ? row.afterDayCost.toFixed(2) : "N/A"}
                            </p>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        No itinerary differences were detected.
                      </div>
                    )}

                    <div className="rounded-md border border-gray-200 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Unscheduled</p>
                      <p className="text-xs text-gray-700">
                        Before: {llmRefinementBeforeUnassignedNames.length > 0 ? llmRefinementBeforeUnassignedNames.join(", ") : "None"}
                      </p>
                      <p className="text-xs text-gray-700">
                        After: {llmRefinementAfterUnassignedNames.length > 0 ? llmRefinementAfterUnassignedNames.join(", ") : "None"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No applicable candidate itinerary was produced in this iteration.
                  </div>
                )}

                {debugMode ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <p className="font-semibold text-slate-900">Before Costs</p>
                      <p>Total: {llmRefinementBeforeCostSummary.total != null ? llmRefinementBeforeCostSummary.total.toFixed(2) : "N/A"}</p>
                      <p>Base: {llmRefinementBeforeCostSummary.base != null ? llmRefinementBeforeCostSummary.base.toFixed(2) : "N/A"}</p>
                      <p>Commute imbalance: {llmRefinementBeforeCostSummary.commuteImbalance != null ? llmRefinementBeforeCostSummary.commuteImbalance.toFixed(2) : "N/A"}</p>
                      <p>Nearby split: {llmRefinementBeforeCostSummary.nearbySplit != null ? llmRefinementBeforeCostSummary.nearbySplit.toFixed(2) : "N/A"}</p>
                      <p>Duration mismatch: {llmRefinementBeforeCostSummary.durationMismatch != null ? llmRefinementBeforeCostSummary.durationMismatch.toFixed(2) : "N/A"}</p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <p className="font-semibold text-slate-900">After Costs</p>
                      <p>Total: {llmRefinementAfterCostSummary.total != null ? llmRefinementAfterCostSummary.total.toFixed(2) : "N/A"}</p>
                      <p>Base: {llmRefinementAfterCostSummary.base != null ? llmRefinementAfterCostSummary.base.toFixed(2) : "N/A"}</p>
                      <p>Commute imbalance: {llmRefinementAfterCostSummary.commuteImbalance != null ? llmRefinementAfterCostSummary.commuteImbalance.toFixed(2) : "N/A"}</p>
                      <p>Nearby split: {llmRefinementAfterCostSummary.nearbySplit != null ? llmRefinementAfterCostSummary.nearbySplit.toFixed(2) : "N/A"}</p>
                      <p>Duration mismatch: {llmRefinementAfterCostSummary.durationMismatch != null ? llmRefinementAfterCostSummary.durationMismatch.toFixed(2) : "N/A"}</p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 md:col-span-2">
                      <p className="font-semibold text-slate-900">Per-day Debug Costs (Before → After)</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2">
                          {JSON.stringify(
                            llmRefinementBeforeDays.map((day) => ({ dayNumber: day.dayNumber, debugCost: day.debugCost })),
                            null,
                            2
                          )}
                        </pre>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2">
                          {JSON.stringify(
                            (llmRefinementAfterDays ?? []).map((day) => ({ dayNumber: day.dayNumber, debugCost: day.debugCost })),
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRejectLlmRefinementPreview}
                  disabled={loading}
                >
                  Reject
                </Button>
                <Button
                  type="button"
                  onClick={handleAcceptLlmRefinementPreview}
                  disabled={loading || !llmRefinementPreview.hasCandidate}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Accept
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
