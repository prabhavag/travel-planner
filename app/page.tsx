"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
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
  suggestAirport,
  type SessionResponse,
  type AiCheckResult,
  type TripInfo,
  type SuggestedActivity,
  type GroupedDay,
  type TripResearchBrief,
  type RestaurantSuggestion,
  type SubAgentStatus,
  type AccommodationOption,
  type FlightOption,
} from "@/lib/api-client";
import { InterestsPreferencesView } from "@/components/InterestsPreferencesView";
import {
  extractTimelineVisits,
  type TimelineAnalysisResponse,
  type TimelineMapPoint,
  type TimelineVisitedPlace,
} from "@/lib/timeline";

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

const TIMELINE_ANALYSIS_CACHE_VERSION = "v14";
const MAX_CLIENT_TIMELINE_GEOCODE_CLUSTERS = 40;
const ENABLE_CLIENT_TIMELINE_GEOCODING = false;
const TIMELINE_CACHE_KEY_PREFIX = "timeline-analysis:";
const CURRENT_TIMELINE_CACHE_KEY_PREFIX = `${TIMELINE_CACHE_KEY_PREFIX}${TIMELINE_ANALYSIS_CACHE_VERSION}:`;
const LAST_TIMELINE_CACHE_META_KEY = `timeline-analysis:${TIMELINE_ANALYSIS_CACHE_VERSION}:last-used`;

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

type TimelineCacheMetadata = {
  cacheKey: string;
  fileName: string | null;
};

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

type TimelineCluster = {
  lat: number;
  lng: number;
  visitCount: number;
  totalDurationMinutes: number;
  totalScore: number;
  points: TimelineMapPoint[];
};

function timelineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreTimelinePoint(point: TimelineMapPoint): number {
  return point.visitCount * 3 + Math.min(point.totalDurationMinutes / 60, 18);
}

function clusterTimelineTravelPoints(points: TimelineMapPoint[]): TimelineCluster[] {
  const clusters: TimelineCluster[] = [];

  for (const point of points
    .filter((point) => point.kind === "regional" || point.kind === "travel")
    .sort((a, b) => scoreTimelinePoint(b) - scoreTimelinePoint(a))) {
    const pointScore = scoreTimelinePoint(point);
    const existing = clusters.find((cluster) => timelineDistanceKm(cluster.lat, cluster.lng, point.lat, point.lng) <= 55);

    if (!existing) {
      clusters.push({
        lat: point.lat,
        lng: point.lng,
        visitCount: point.visitCount,
        totalDurationMinutes: point.totalDurationMinutes,
        totalScore: pointScore,
        points: [point],
      });
      continue;
    }

    const combinedScore = existing.totalScore + pointScore;
    existing.lat = (existing.lat * existing.totalScore + point.lat * pointScore) / combinedScore;
    existing.lng = (existing.lng * existing.totalScore + point.lng * pointScore) / combinedScore;
    existing.totalScore = combinedScore;
    existing.visitCount += point.visitCount;
    existing.totalDurationMinutes += point.totalDurationMinutes;
    existing.points.push(point);
  }

  return clusters.sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes || b.visitCount - a.visitCount);
}

function normalizeTimelineName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TIMELINE_COUNTRY_LABELS = new Set([
  "australia",
  "canada",
  "india",
  "mexico",
  "united states",
  "usa",
]);

function isUsefulTimelineDestinationLabel(label: string | null): label is string {
  if (!label) return false;
  const normalized = normalizeTimelineName(label);
  if (!normalized) return false;
  return !TIMELINE_COUNTRY_LABELS.has(normalized);
}

function extractLabelFromGeocoderResult(result: google.maps.GeocoderResult): string | null {
  const getComponent = (type: string) =>
    result.address_components.find((component) => component.types.includes(type))?.long_name;

  const locality = getComponent("locality") || getComponent("postal_town") || getComponent("administrative_area_level_2");
  const region = getComponent("administrative_area_level_1");
  if (locality && region && normalizeTimelineName(locality) !== normalizeTimelineName(region)) {
    return `${locality}, ${region}`;
  }
  return locality || region || null;
}

function pickTopTimelineLabel(labelScores: Map<string, number>): string | null {
  return [...labelScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function parseTimelineCacheMetadata(raw: string | null): TimelineCacheMetadata | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      cacheKey?: unknown;
      fileName?: unknown;
    };

    if (typeof parsed.cacheKey !== "string" || !parsed.cacheKey.trim()) {
      return null;
    }

    return {
      cacheKey: parsed.cacheKey,
      fileName: typeof parsed.fileName === "string" && parsed.fileName.trim() ? parsed.fileName.trim() : null,
    };
  } catch {
    return null;
  }
}

function isTimelineAnalysisResponse(value: unknown): value is TimelineAnalysisResponse {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const stats = candidate.stats as Record<string, unknown> | undefined;

  return (
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.preferences) &&
    Array.isArray(candidate.foodPreferences) &&
    Array.isArray(candidate.visitedDestinations) &&
    Array.isArray(candidate.visitedPlaces) &&
    Array.isArray(candidate.localSignals) &&
    Array.isArray(candidate.travelSignals) &&
    Array.isArray(candidate.mapPoints) &&
    typeof stats?.visitCount === "number" &&
    typeof stats?.recurringPlaceCount === "number" &&
    typeof stats?.localPlaceCount === "number" &&
    typeof stats?.travelPlaceCount === "number" &&
    typeof stats?.tripCount === "number"
  );
}

function findCachedTimelineMetadata(storage: Storage): TimelineCacheMetadata | null {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key || key === LAST_TIMELINE_CACHE_META_KEY) continue;
    if (!key.startsWith(CURRENT_TIMELINE_CACHE_KEY_PREFIX)) continue;
    if (key.endsWith(":last-used")) continue;

    const raw = storage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (!isTimelineAnalysisResponse(parsed)) continue;

      return {
        cacheKey: key,
        fileName: null,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function reverseGeocodeTimelineLocation(
  geocoder: google.maps.Geocoder,
  lat: number,
  lng: number
): Promise<string | null> {
  return new Promise((resolve) => {
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status !== "OK" || !results?.length) {
        resolve(null);
        return;
      }

      const prioritized =
        results.find((result) => result.types.includes("locality")) ||
        results.find((result) => result.types.includes("postal_town")) ||
        results.find((result) => result.types.includes("administrative_area_level_2")) ||
        results[0];

      const label = prioritized ? extractLabelFromGeocoderResult(prioritized) : null;
      resolve(isUsefulTimelineDestinationLabel(label) ? label : null);
    });
  });
}

async function reverseGeocodeTimelineCluster(
  geocoder: google.maps.Geocoder,
  cluster: TimelineCluster
): Promise<TimelineVisitedPlace | null> {
  const labelScores = new Map<string, number>();

  for (const point of [...cluster.points].sort((a, b) => scoreTimelinePoint(b) - scoreTimelinePoint(a)).slice(0, 6)) {
    const label = await reverseGeocodeTimelineLocation(geocoder, point.lat, point.lng);
    if (!label) continue;

    labelScores.set(
      label,
      (labelScores.get(label) || 0) + scoreTimelinePoint(point) * 2 + Math.min(point.visitCount, 4)
    );
  }

  if (labelScores.size === 0) {
    const centroidLabel = await reverseGeocodeTimelineLocation(geocoder, cluster.lat, cluster.lng);
    if (centroidLabel) {
      labelScores.set(centroidLabel, cluster.totalScore + Math.min(cluster.visitCount, 6));
    }
  }

  const label = pickTopTimelineLabel(labelScores);
  if (!label) return null;

  return {
    name: label,
    lat: cluster.lat,
    lng: cluster.lng,
    visitCount: cluster.visitCount,
    totalDurationMinutes: cluster.totalDurationMinutes,
  };
}

function mergeTimelineDestinations(
  existing: TimelineVisitedPlace[],
  geocoded: TimelineVisitedPlace[]
): TimelineVisitedPlace[] {
  const merged = new Map<string, TimelineVisitedPlace>();

  for (const place of [...existing, ...geocoded]) {
    const normalized = normalizeTimelineName(place.name);
    if (!normalized) continue;

    const current = merged.get(normalized);
    if (current) {
      const combinedVisits = current.visitCount + place.visitCount;
      const combinedDuration = current.totalDurationMinutes + place.totalDurationMinutes;
      current.lat = (current.lat * current.visitCount + place.lat * place.visitCount) / combinedVisits;
      current.lng = (current.lng * current.visitCount + place.lng * place.visitCount) / combinedVisits;
      current.visitCount = combinedVisits;
      current.totalDurationMinutes = combinedDuration;
      continue;
    }

    merged.set(normalized, { ...place });
  }

  return [...merged.values()].sort((a, b) =>
    b.totalDurationMinutes - a.totalDurationMinutes || b.visitCount - a.visitCount
  );
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

  // Timeline State
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineAnalysis, setTimelineAnalysis] = useState<TimelineAnalysisResponse | null>(null);
  const [timelineFileName, setTimelineFileName] = useState<string | null>(null);
  const [timelineLoadedFromCache, setTimelineLoadedFromCache] = useState(false);
  const [timelineCacheKey, setTimelineCacheKey] = useState<string | null>(null);
  const [timelineLocations, setTimelineLocations] = useState<TimelineMapPoint[]>([]);
  const [timelineDestinationsRefined, setTimelineDestinationsRefined] = useState(false);
  const [cachedTimelineMeta, setCachedTimelineMeta] = useState<TimelineCacheMetadata | null>(null);

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
  const [mapsReady, setMapsReady] = useState(false);
  const [apiWarnings, setApiWarnings] = useState<ApiWarningMessage[]>([]);
  const photoEnrichmentSignatureRef = useRef<string>("");
  const lastSeenAiCheckAtRef = useRef<string | null>(null);


  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const leftPanelScrollRef = useRef<HTMLDivElement>(null);
  const aiInsightPopupRef = useRef<HTMLDivElement>(null);

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

  const clearLastTimelineCacheMetadata = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LAST_TIMELINE_CACHE_META_KEY);
    setCachedTimelineMeta(null);
  }, []);

  const persistLastTimelineCacheMetadata = useCallback((cacheKey: string, fileName: string | null) => {
    if (typeof window === "undefined") return;

    const metadata: TimelineCacheMetadata = {
      cacheKey,
      fileName,
    };

    window.localStorage.setItem(LAST_TIMELINE_CACHE_META_KEY, JSON.stringify(metadata));
    setCachedTimelineMeta(metadata);
  }, []);

  const applyTimelineAnalysisResult = useCallback(async (result: TimelineAnalysisResponse) => {
    setTimelineAnalysis(result);
    setTimelineLocations(result.mapPoints);
    setTimelineDestinationsRefined(false);

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

  const computeTimelineCacheKey = async (buffer: ArrayBuffer) => {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `timeline-analysis:${TIMELINE_ANALYSIS_CACHE_VERSION}:${hash}`;
  };

  const handleTimelineUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setTimelineFileName(file.name);
    setTimelineLoading(true);
    setTimelineAnalysis(null);
    setTimelineLoadedFromCache(false);
    setTimelineLocations([]);

    try {
      const buffer = await file.arrayBuffer();
      const cacheKey = await computeTimelineCacheKey(buffer);
      setTimelineCacheKey(cacheKey);
      const cachedValue = window.localStorage.getItem(cacheKey);
      if (cachedValue) {
        const cachedResult = JSON.parse(cachedValue) as TimelineAnalysisResponse;
        setTimelineLoadedFromCache(true);
        persistLastTimelineCacheMetadata(cacheKey, file.name);
        await applyTimelineAnalysisResult(cachedResult);
        return;
      }

      const text = new TextDecoder().decode(buffer);
      const json = JSON.parse(text);
      const visits = extractTimelineVisits(json);

      if (visits.length === 0) {
        setTimelineAnalysis({
          summary: "This file parsed correctly, but it did not include any usable place visits to learn from.",
          preferences: [],
          foodPreferences: [],
          visitedDestinations: [],
          visitedPlaces: [],
          localSignals: [],
          travelSignals: [],
          mapPoints: [],
          stats: {
            visitCount: 0,
            recurringPlaceCount: 0,
            localPlaceCount: 0,
            travelPlaceCount: 0,
            tripCount: 0,
          },
        });
        return;
      }

      const result = await analyzeTimeline({ visits });
      window.localStorage.setItem(cacheKey, JSON.stringify(result));
      persistLastTimelineCacheMetadata(cacheKey, file.name);
      await applyTimelineAnalysisResult(result);
    } catch (error) {
      console.error("Error processing timeline:", error);
      alert("Failed to process timeline file.");
    } finally {
      setTimelineLoading(false);
      event.target.value = "";
    }
  };

  const handleUseCachedTimeline = useCallback(async () => {
    if (typeof window === "undefined") return;

    const metadata = cachedTimelineMeta || findCachedTimelineMetadata(window.localStorage);
    if (!metadata) {
      clearLastTimelineCacheMetadata();
      alert("No cached timeline analysis was found.");
      return;
    }

    const cachedValue = window.localStorage.getItem(metadata.cacheKey);
    if (!cachedValue) {
      clearLastTimelineCacheMetadata();
      alert("No cached timeline analysis was found.");
      return;
    }

    setTimelineLoading(true);
    setTimelineLoadedFromCache(true);
    setTimelineCacheKey(metadata.cacheKey);
    setTimelineFileName(metadata.fileName);

    try {
      const cachedResult = JSON.parse(cachedValue) as TimelineAnalysisResponse;
      persistLastTimelineCacheMetadata(metadata.cacheKey, metadata.fileName);
      await applyTimelineAnalysisResult(cachedResult);
    } catch (error) {
      console.error("Error loading cached timeline:", error);
      alert("Failed to load cached timeline analysis.");
    } finally {
      setTimelineLoading(false);
    }
  }, [applyTimelineAnalysisResult, cachedTimelineMeta, clearLastTimelineCacheMetadata, persistLastTimelineCacheMetadata]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const metadata = parseTimelineCacheMetadata(window.localStorage.getItem(LAST_TIMELINE_CACHE_META_KEY));
    if (metadata && window.localStorage.getItem(metadata.cacheKey)) {
      setCachedTimelineMeta(metadata);
      return;
    }

    const discovered = findCachedTimelineMetadata(window.localStorage);
    if (discovered) {
      persistLastTimelineCacheMetadata(discovered.cacheKey, discovered.fileName);
      return;
    }

    window.localStorage.removeItem(LAST_TIMELINE_CACHE_META_KEY);
    setCachedTimelineMeta(null);
  }, [persistLastTimelineCacheMetadata]);

  useEffect(() => {
    if (
      !ENABLE_CLIENT_TIMELINE_GEOCODING ||
      !mapsReady ||
      !timelineAnalysis ||
      timelineDestinationsRefined ||
      typeof window === "undefined" ||
      !window.google?.maps?.Geocoder
    ) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      const geocoder = new window.google.maps.Geocoder();
      const clusters = clusterTimelineTravelPoints(timelineAnalysis.mapPoints)
        .filter((cluster) => cluster.totalDurationMinutes >= 90 || cluster.visitCount >= 3 || cluster.points.length >= 3)
        .slice(0, MAX_CLIENT_TIMELINE_GEOCODE_CLUSTERS);
      const geocodedDestinations: TimelineVisitedPlace[] = [];

      for (const cluster of clusters) {
        const geocoded = await reverseGeocodeTimelineCluster(geocoder, cluster);
        if (!geocoded) continue;
        geocodedDestinations.push(geocoded);
      }

      if (cancelled) return;

      const mergedVisitedPlaces = mergeTimelineDestinations(
        timelineAnalysis.visitedPlaces,
        geocodedDestinations
      );
      const mergedVisitedDestinationNames = Array.from(
        new Set([
          ...timelineAnalysis.visitedDestinations,
          ...mergedVisitedPlaces.map((place) => place.name),
        ])
      );

      const changed =
        mergedVisitedPlaces.length !== timelineAnalysis.visitedPlaces.length ||
        mergedVisitedDestinationNames.length !== timelineAnalysis.visitedDestinations.length;

      setTimelineDestinationsRefined(true);

      if (!changed) return;

      const refinedAnalysis: TimelineAnalysisResponse = {
        ...timelineAnalysis,
        visitedPlaces: mergedVisitedPlaces,
        visitedDestinations: mergedVisitedDestinationNames,
      };

      setTimelineAnalysis(refinedAnalysis);

      const mergedTripVisitedDestinations = Array.from(
        new Set([...(tripInfo.visitedDestinations || []), ...mergedVisitedDestinationNames])
      );
      setTripInfo((prev) => ({
        ...prev,
        visitedDestinations: mergedTripVisitedDestinations,
      }));
      await persistTripInfoUpdate({
        visitedDestinations: mergedTripVisitedDestinations,
      });

      if (timelineCacheKey) {
        window.localStorage.setItem(timelineCacheKey, JSON.stringify(refinedAnalysis));
        persistLastTimelineCacheMetadata(timelineCacheKey, timelineFileName);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [
    mapsReady,
    persistTripInfoUpdate,
    persistLastTimelineCacheMetadata,
    timelineAnalysis,
    timelineCacheKey,
    timelineDestinationsRefined,
    timelineFileName,
    tripInfo.visitedDestinations,
  ]);

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
    if (response.groupedDays !== undefined) setGroupedDays(response.groupedDays);
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
        setGroupedDays(response.groupedDays || []);
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
      const response = await agentTurn(sessionId, "ui_action", undefined, {
        type: "confirm_grouping",
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

  const isFinalized = workflowState === WORKFLOW_STATES.FINALIZE;

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
    const displayedTimelineDestinations = timelineAnalysis
      ? Array.from(
        new Set([
          ...timelineAnalysis.visitedPlaces.map((place) => place.name),
          ...timelineAnalysis.visitedDestinations,
        ])
      )
      : [];

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

                        <div className="sm:col-span-2 mt-4 rounded-xl border border-dashed border-gray-300 p-4 bg-gray-50">
                          <label className="mb-2 block text-sm font-medium text-gray-900">
                            Personalize with Maps Timeline (Optional)
                          </label>
                          <p className="mb-3 text-xs text-gray-500">
                            Upload your Google Maps Timeline export to infer repeat travel patterns, food habits, and trip style from where you actually spend time.
                          </p>
                          <div className="flex flex-wrap items-center gap-3">
                            <Input
                              type="file"
                              accept=".json"
                              onChange={handleTimelineUpload}
                              disabled={timelineLoading}
                              className="max-w-xs text-xs bg-white"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleUseCachedTimeline}
                              disabled={timelineLoading || !cachedTimelineMeta}
                              className="text-xs"
                            >
                              Use cached
                            </Button>
                            {timelineLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                          </div>
                          {cachedTimelineMeta && (
                            <p className="mt-2 text-xs text-gray-500">
                              Cached timeline ready
                              {cachedTimelineMeta.fileName ? `: ${cachedTimelineMeta.fileName}` : "."}
                            </p>
                          )}
                          {timelineFileName && (
                            <p className="mt-2 text-xs text-gray-500">
                              Uploaded: {timelineFileName}
                            </p>
                          )}
                          {timelineAnalysis && (
                            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                              <p className="font-semibold">Timeline Analysis</p>
                              <p className="mt-1 text-xs text-blue-700">
                                Learned from {timelineAnalysis.stats.visitCount} visits across{" "}
                                {timelineAnalysis.stats.recurringPlaceCount} recurring places and{" "}
                                {timelineAnalysis.stats.tripCount} travel bursts.
                              </p>
                              {timelineLoadedFromCache && (
                                <p className="mt-1 text-xs text-blue-700">
                                  Loaded cached analysis for this same timeline export.
                                </p>
                              )}
                              <p className="mt-2">{timelineAnalysis.summary}</p>

                              {timelineAnalysis.preferences.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {timelineAnalysis.preferences.map((preference) => (
                                    <Badge
                                      key={preference}
                                      variant="secondary"
                                      className="border border-blue-200 bg-white text-blue-800"
                                    >
                                      {preference}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {timelineAnalysis.foodPreferences.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                                    Food Context
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {timelineAnalysis.foodPreferences.map((preference) => (
                                      <Badge
                                        key={preference}
                                        variant="secondary"
                                        className="border border-blue-200 bg-white text-blue-800"
                                      >
                                        {preference}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {displayedTimelineDestinations.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                                    Travel Destinations ({displayedTimelineDestinations.length})
                                  </p>
                                  <ScrollArea className="mt-2 max-h-32 rounded-md border border-blue-100 bg-white/60 p-2">
                                    <div className="flex flex-wrap gap-2">
                                      {displayedTimelineDestinations.map((destination) => (
                                        <Badge
                                          key={destination}
                                          variant="secondary"
                                          className="border border-blue-200 bg-blue-100/60 text-blue-900"
                                        >
                                          {destination}
                                        </Badge>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </div>
                              )}

                              {timelineAnalysis.localSignals.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                                    Local Pattern
                                  </p>
                                  <p className="mt-1 text-xs text-blue-800">
                                    {timelineAnalysis.localSignals.join(" ")}
                                  </p>
                                </div>
                              )}

                              {timelineAnalysis.travelSignals.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                                    Travel Pattern
                                  </p>
                                  <p className="mt-1 text-xs text-blue-800">
                                    {timelineAnalysis.travelSignals.join(" ")}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
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
                      isLoading={loading}
                      headerActions={aiInlineActions}
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
                onGoogleMapsReady={() => setMapsReady(true)}
                hoveredActivityId={hoveredActivityId}
                highlightedDay={activeDay}
                timelineLocations={
                  workflowState === WORKFLOW_STATES.INFO_GATHERING
                    ? timelineLocations
                    : []
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
      </div>
    </div>
  );
}
