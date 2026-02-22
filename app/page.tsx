"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, MessageSquare, Heart, ChevronLeft, ChevronRight, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import MapComponent from "@/components/MapComponent";
import { InitialResearchView } from "@/components/InitialResearchView";
import { DayGroupingView } from "@/components/DayGroupingView";
import { RestaurantSelectionView } from "@/components/RestaurantSelectionView";
import { DayItineraryView } from "@/components/DayItineraryView";
import {
  startSession,
  chat,
  finalize,
  generateResearchBrief,
  confirmResearchBrief,
  selectActivities,
  adjustDayGroups,
  confirmDayGrouping,
  getRestaurantSuggestions,
  setMealPreferences,
  updateTripInfo,
  updateWorkflowState,
  deepResearchOption,
  deepResearchSelectedOptions,
  enrichResearchPhotos,
  type TripInfo,
  type SuggestedActivity,
  type GroupedDay,
  type ResearchOptionPreference,
  type RestaurantSuggestion,
  type DayGroup,
  type TripResearchBrief,
} from "@/lib/api-client";
import { InterestsPreferencesView } from "@/components/InterestsPreferencesView";

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
  "Accommodation Suggestions",
  "Add Hotels & Flights",
  "Final Review",
];

const WORKFLOW_TO_UI_STAGE: Record<string, number> = {
  [WORKFLOW_STATES.INFO_GATHERING]: 0,
  [WORKFLOW_STATES.INITIAL_RESEARCH]: 1,
  [WORKFLOW_STATES.SUGGEST_ACTIVITIES]: 1,
  [WORKFLOW_STATES.SELECT_ACTIVITIES]: 1,
  [WORKFLOW_STATES.GROUP_DAYS]: 2,
  [WORKFLOW_STATES.DAY_ITINERARY]: 2,
  [WORKFLOW_STATES.MEAL_PREFERENCES]: 3,
  [WORKFLOW_STATES.REVIEW]: 4,
  [WORKFLOW_STATES.FINALIZE]: 5,
};

const UI_STAGE_TO_WORKFLOW: Record<number, string> = {
  0: WORKFLOW_STATES.INFO_GATHERING,
  1: WORKFLOW_STATES.INITIAL_RESEARCH,
  2: WORKFLOW_STATES.GROUP_DAYS,
  3: WORKFLOW_STATES.MEAL_PREFERENCES,
  4: WORKFLOW_STATES.REVIEW,
  5: WORKFLOW_STATES.FINALIZE,
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const EMPTY_TRIP_INFO: TripInfo = {
  destination: null,
  startDate: null,
  endDate: null,
  durationDays: null,
  preferences: [],
  activityLevel: "moderate",
  travelers: 1,
  budget: null,
};

export default function PlannerPage() {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState(WORKFLOW_STATES.INFO_GATHERING);

  // Trip data
  const [tripInfo, setTripInfo] = useState<TripInfo>(EMPTY_TRIP_INFO);
  const [tripResearchBrief, setTripResearchBrief] = useState<TripResearchBrief | null>(null);
  const [researchOptionSelections, setResearchOptionSelections] = useState<Record<string, ResearchOptionPreference>>({});
  const [researchMapFocusPreference, setResearchMapFocusPreference] = useState<"all" | "keep" | "maybe" | "reject">("all");

  // New activity-first flow state
  const [suggestedActivities, setSuggestedActivities] = useState<SuggestedActivity[]>([]);
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [dayGroups, setDayGroups] = useState<DayGroup[]>([]);
  const [groupedDays, setGroupedDays] = useState<GroupedDay[]>([]);
  const [restaurantSuggestions, setRestaurantSuggestions] = useState<RestaurantSuggestion[]>([]);
  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState<string[]>([]);
  const [maxReachedState, setMaxReachedState] = useState(WORKFLOW_STATES.INFO_GATHERING);
  const [lastGroupedActivityIds, setLastGroupedActivityIds] = useState<string[]>([]);

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
  const [tripBasicsPreferencesInput, setTripBasicsPreferencesInput] = useState("");
  const [deepResearchOptionId, setDeepResearchOptionId] = useState<string | null>(null);
  const [lastDeepResearchAtByOptionId, setLastDeepResearchAtByOptionId] = useState<Record<string, string>>({});
  const [photoEnrichmentInProgress, setPhotoEnrichmentInProgress] = useState(false);
  const photoEnrichmentSignatureRef = useRef<string>("");


  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const leftPanelScrollRef = useRef<HTMLDivElement>(null);

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
      setResearchOptionSelections({});
      setLastDeepResearchAtByOptionId({});
      return;
    }

    setResearchOptionSelections((prev) => {
      const next: Record<string, ResearchOptionPreference> = {};
      for (const option of tripResearchBrief.popularOptions) {
        next[option.id] = prev[option.id] || "maybe";
      }
      return next;
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

  // Handle chat messages
  const handleChat = async () => {
    if (!chatInput.trim() || !sessionId) return;

    const userMessage = chatInput;
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const response = await chat(sessionId, userMessage);
      if (response.success) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
        if (response.tripInfo) setTripInfo(response.tripInfo);
        if (response.tripResearchBrief) setTripResearchBrief(response.tripResearchBrief);
        if (response.researchOptionSelections) setResearchOptionSelections(response.researchOptionSelections);
        if (response.suggestedActivities) setSuggestedActivities(response.suggestedActivities);
        if (response.workflowState) {
          setWorkflowState(response.workflowState);
          updateMaxReachedState(response.workflowState);
        }
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
      const response = await chat(sessionId, userMessage);
      if (response.success) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
        if (response.tripInfo) setTripInfo(response.tripInfo);
        if (response.tripResearchBrief) setTripResearchBrief(response.tripResearchBrief);
        if (response.researchOptionSelections) setResearchOptionSelections(response.researchOptionSelections);
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
        if (response.researchOptionSelections) setResearchOptionSelections(response.researchOptionSelections);
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
    const confirmedSelectedActivityIds = Object.entries(researchOptionSelections)
      .filter(([, preference]) => preference === "keep")
      .map(([optionId]) => optionId);
    if (confirmedSelectedActivityIds.length === 0) {
      alert("Select at least one activity with Keep before organizing your trip.");
      return;
    }
    setLoading(true);
    try {
      const response = await confirmResearchBrief(sessionId, researchOptionSelections);
      if (!response.success) {
        throw new Error(response.message);
      }
      if (response.suggestedActivities) {
        setSuggestedActivities(response.suggestedActivities);
      }
      const selectedIds = response.selectedActivityIds || [];
      setSelectedActivityIds(selectedIds);
      const nextState = response.workflowState || WORKFLOW_STATES.GROUP_DAYS;
      setWorkflowState(nextState);
      updateMaxReachedState(nextState);
      setDayGroups(response.dayGroups || []);
      setGroupedDays(response.groupedDays || []);
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
      const nextState = selectResponse.workflowState || WORKFLOW_STATES.GROUP_DAYS;
      setWorkflowState(nextState);
      updateMaxReachedState(nextState);
      setDayGroups(selectResponse.dayGroups || []);
      setGroupedDays(selectResponse.groupedDays || []);
      setLastGroupedActivityIds([...ids]);
      setChatHistory((prev) => [...prev, { role: "assistant", content: selectResponse.message }]);
    } catch (error) {
      console.error("Group days error:", error);
      alert("Failed to organize activities. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResearchSelectionChange = (optionId: string, preference: ResearchOptionPreference) => {
    setResearchOptionSelections((prev) => ({
      ...prev,
      [optionId]: preference,
    }));
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
  const hasAnyKeptResearchOption = Object.values(researchOptionSelections).some((preference) => preference === "keep");

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

  // Handle activity selection change
  const handleActivitySelectionChange = (ids: string[]) => {
    setSelectedActivityIds(ids);
  };

  // Confirm activity selection and group into days
  const handleConfirmActivitySelection = async () => {
    handleConfirmActivitySelectionInternal(selectedActivityIds);
  };

  // Handle moving activity between days
  const handleMoveActivity = async (activityId: string, fromDay: number, toDay: number) => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await adjustDayGroups(sessionId, activityId, fromDay, toDay);
      if (response.success) {
        setDayGroups(response.dayGroups || []);
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
      const response = await confirmDayGrouping(sessionId);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.DAY_ITINERARY);
        updateMaxReachedState(WORKFLOW_STATES.DAY_ITINERARY);
        setGroupedDays(response.groupedDays || []);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Confirm grouping error:", error);
      alert("Failed to confirm day grouping. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Get restaurant suggestions
  const handleGetRestaurants = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await getRestaurantSuggestions(sessionId);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.MEAL_PREFERENCES);
        updateMaxReachedState(WORKFLOW_STATES.MEAL_PREFERENCES);
        setRestaurantSuggestions(response.restaurantSuggestions || []);
        setSelectedRestaurantIds([]);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Get restaurants error:", error);
      alert("Failed to find restaurants. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Handle restaurant selection change
  const handleRestaurantSelectionChange = (ids: string[]) => {
    setSelectedRestaurantIds(ids);
  };

  // Handle meal preferences (add restaurants or skip)
  const handleMealPreferences = async (wantsRestaurants: boolean) => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await setMealPreferences(
        sessionId,
        wantsRestaurants,
        wantsRestaurants ? selectedRestaurantIds : undefined
      );
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.REVIEW);
        updateMaxReachedState(WORKFLOW_STATES.REVIEW);
        setGroupedDays(response.groupedDays || []);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Meal preferences error:", error);
      alert("Failed to save preferences. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Skip restaurants and go to review
  const handleSkipRestaurants = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await setMealPreferences(sessionId, false);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.REVIEW);
        updateMaxReachedState(WORKFLOW_STATES.REVIEW);
        setGroupedDays(response.groupedDays || []);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Skip restaurants error:", error);
      alert("Failed to proceed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Finalize
  const handleFinalize = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await finalize(sessionId);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.FINALIZE);
        updateMaxReachedState(WORKFLOW_STATES.FINALIZE);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Finalize error:", error);
      alert("Failed to finalize itinerary. Please try again.");
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

  const persistTripInfoUpdate = async (updates: Partial<TripInfo>) => {
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
  };

  const handleTripFieldBlur = async (updates: Partial<TripInfo>) => {
    await persistTripInfoUpdate(updates);
  };

  const handleProceedFromTripBasics = async () => {
    if (!sessionId) return;
    const hasRequiredBasics =
      Boolean(tripInfo.destination?.trim()) && Boolean(tripInfo.startDate) && Boolean(tripInfo.endDate);
    if (!hasRequiredBasics) return;

    const synced = await persistTripInfoUpdate({
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

  const handleGoBack = async () => {
    if (!sessionId) return;
    const currentIndex = WORKFLOW_ORDER.indexOf(workflowState);
    if (currentIndex > 0) {
      const prevState = WORKFLOW_ORDER[currentIndex - 1];
      setLoading(true);
      try {
        await updateWorkflowState(sessionId, prevState);
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
      setLoading(true);
      try {
        await updateWorkflowState(sessionId, nextState);
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

    setLoading(true);
    try {
      await updateWorkflowState(sessionId, targetState);
      setWorkflowState(targetState);
    } catch (error) {
      console.error("Jump to stage error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Get state label
  const getStateLabel = () => {
    return UI_STAGE_LABELS[getCurrentUiStageIndex()] || "";
  };

  // Render left panel content based on state
  const renderLeftPanelContent = () => {
    const currentIndex = WORKFLOW_ORDER.indexOf(workflowState);
    const maxIndex = WORKFLOW_ORDER.indexOf(maxReachedState);
    const canGoBack = currentIndex > 1; // Don't go back to info gathering via buttons
    const canGoForward = currentIndex < maxIndex;

    const selectionsChanged =
      (workflowState === WORKFLOW_STATES.GROUP_DAYS || workflowState === WORKFLOW_STATES.DAY_ITINERARY) &&
      (selectedActivityIds.length !== lastGroupedActivityIds.length ||
        !selectedActivityIds.every(id => lastGroupedActivityIds.includes(id)));

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
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">Trip Basics</h2>
                        <p className="mt-1 text-sm text-gray-600">
                          Fill these details here or share them in chat. Both stay in sync.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                          Proceed to Next Stage
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
                    researchOptionSelections={researchOptionSelections}
                    onSelectionChange={handleResearchSelectionChange}
                    onResolveDurationConflict={handleResolveDurationConflict}
                    hasUnresolvedAssumptionConflicts={hasUnresolvedAssumptionConflicts}
                    onRegenerate={() => handleGenerateResearchBrief("deep", "augment")}
                    onDeepResearchAll={handleDeepResearchSelected}
                    onDeepResearchOption={handleDeepResearchOption}
                    deepResearchOptionId={deepResearchOptionId}
                    lastDeepResearchAtByOptionId={lastDeepResearchAtByOptionId}
                    onProceed={handleProceedFromResearch}
                    canProceed={hasAnyKeptResearchOption}
                    onStatusFocusChange={setResearchMapFocusPreference}
                    isLoading={loading}
                  />
                );


              case WORKFLOW_STATES.GROUP_DAYS:
                return (
                  <div className="p-4 overflow-hidden">
                    <DayGroupingView
                      groupedDays={groupedDays}
                      userPreferences={tripInfo?.preferences || []}
                      onMoveActivity={handleMoveActivity}
                      onConfirm={handleConfirmDayGrouping}
                      onDayChange={setActiveDay}
                      isLoading={loading}
                    />
                  </div>
                );

              case WORKFLOW_STATES.MEAL_PREFERENCES:
                return (
                  <div className="p-4">
                    <RestaurantSelectionView
                      restaurants={restaurantSuggestions}
                      selectedIds={selectedRestaurantIds}
                      onSelectionChange={handleRestaurantSelectionChange}
                      onConfirm={handleMealPreferences}
                      isLoading={loading}
                    />
                  </div>
                );

              case WORKFLOW_STATES.DAY_ITINERARY:
              case WORKFLOW_STATES.REVIEW:
              case WORKFLOW_STATES.FINALIZE:
                return (
                  <div className="p-4 overflow-hidden">
                    <DayItineraryView
                      groupedDays={groupedDays}
                      tripInfo={tripInfo || undefined}
                      onActivityHover={setHoveredActivityId}
                      onMoveActivity={handleMoveActivity}
                      onDayChange={setActiveDay}
                    />
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

  const isFinalized = workflowState === WORKFLOW_STATES.FINALIZE;

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
              <div className="relative grid grid-cols-6">
                {UI_STAGE_LABELS.map((label, index) => {
                  const current = getCurrentUiStageIndex();
                  const maxReached = getMaxReachedUiStageIndex();
                  const isCompleted = index < current;
                  const isCurrent = index === current;
                  const isClickable = index <= maxReached && !loading;
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
                        className={`z-10 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                          isCurrent
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
              researchOptionSelections={researchOptionSelections}
              researchFocusPreference={researchMapFocusPreference}
              suggestedActivities={suggestedActivities}
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
                        className={`p-3 rounded-2xl max-w-[85%] text-sm ${msg.role === "user" ? "bg-blue-500 text-white ml-auto" : "bg-gray-200 text-gray-800"
                          }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                      </div>
                    )}
                  </div>

                  {workflowState === WORKFLOW_STATES.INFO_GATHERING &&
                    chatHistory.length === 1 &&
                    !loading && (
                      <div className="mt-4 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <button
                          onClick={() => handleSuggestionClick("Plan a 4-day moderate trip to Maui from May 10th to May 14th 2026. I'm interested in snorkeling, hiking, and local seafood.")}
                          className="px-3 py-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors shadow-sm"
                        >
                          🌴 Maui: 4-day adventure
                        </button>
                        <button
                          onClick={() => handleSuggestionClick("Plan a 4-day relaxed trip to Switzerland from June 15th to June 19th 2026. I'm interested in scenic trains, chocolate, and mountain views.")}
                          className="px-3 py-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors shadow-sm"
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
