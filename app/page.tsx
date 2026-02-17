"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, MessageSquare, Heart, ChevronLeft, ChevronRight, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import MapComponent from "@/components/MapComponent";
import { ActivitySelectionView } from "@/components/ActivitySelectionView";
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
  answerResearchQuestions,
  suggestTopActivities,
  selectActivities,
  groupDays,
  adjustDayGroups,
  confirmDayGrouping,
  getRestaurantSuggestions,
  setMealPreferences,
  updateTripInfo,
  updateWorkflowState,
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
  WORKFLOW_STATES.SUGGEST_ACTIVITIES,
  WORKFLOW_STATES.GROUP_DAYS,
  WORKFLOW_STATES.DAY_ITINERARY,
  WORKFLOW_STATES.MEAL_PREFERENCES,
  WORKFLOW_STATES.REVIEW,
  WORKFLOW_STATES.FINALIZE,
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function PlannerPage() {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState(WORKFLOW_STATES.INFO_GATHERING);

  // Trip data
  const [tripInfo, setTripInfo] = useState<TripInfo | null>(null);
  const [tripResearchBrief, setTripResearchBrief] = useState<TripResearchBrief | null>(null);
  const [researchOptionSelections, setResearchOptionSelections] = useState<Record<string, ResearchOptionPreference>>({});

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
  const [canProceed, setCanProceed] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "interests">("chat");
  const [hoveredActivityId, setHoveredActivityId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(1);
  const [isChatMinimized, setIsChatMinimized] = useState(false);


  const chatScrollRef = useRef<HTMLDivElement>(null);

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
      return;
    }

    setResearchOptionSelections((prev) => {
      const next: Record<string, ResearchOptionPreference> = {};
      for (const option of tripResearchBrief.popularOptions) {
        next[option.id] = prev[option.id] || "maybe";
      }
      return next;
    });
  }, [tripResearchBrief]);

  const initializeSession = async () => {
    try {
      const response = await startSession();
      if (response.success) {
        setSessionId(response.sessionId);
        setWorkflowState(response.workflowState);
        setChatHistory([{ role: "assistant", content: response.message }]);
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
        if (response.canProceed !== undefined) setCanProceed(response.canProceed);
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
        if (response.canProceed !== undefined) setCanProceed(response.canProceed);
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

  // Suggest top 10 activities (streaming)
  const handleGenerateResearchBrief = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await generateResearchBrief(sessionId);
      if (response.success) {
        if (response.tripResearchBrief) setTripResearchBrief(response.tripResearchBrief);
        if (response.researchOptionSelections) setResearchOptionSelections(response.researchOptionSelections);
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
    setLoading(true);
    try {
      const response = await confirmResearchBrief(sessionId, researchOptionSelections);
      if (!response.success) {
        throw new Error(response.message);
      }
      if (response.workflowState) {
        setWorkflowState(response.workflowState);
        updateMaxReachedState(response.workflowState);
      }
      setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
    } catch (error) {
      console.error("Confirm research brief error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to confirm research brief. Please try again.";
      alert(errorMessage);
      setLoading(false);
      return;
    }
    setLoading(false);
    await handleSuggestActivities();
  };

  // Suggest top 10 activities (streaming)
  const handleSuggestActivities = async () => {
    if (!sessionId) return;
    setLoading(true);
    setWorkflowState(WORKFLOW_STATES.SUGGEST_ACTIVITIES);
    setSuggestedActivities([]); // Clear and prepare for streaming
    setSelectedActivityIds([]);

    try {
      await suggestTopActivities(
        sessionId,
        (activity) => {
          // Add each activity as it arrives
          setSuggestedActivities((prev) => [...prev, activity]);
        },
        (message) => {
          setChatHistory((prev) => [...prev, { role: "assistant", content: message }]);
          setLoading(false);
          updateMaxReachedState(WORKFLOW_STATES.SUGGEST_ACTIVITIES);
        },
        (error) => {
          console.error("Suggest activities error:", error);
          alert("Failed to suggest activities. Please try again.");
          setLoading(false);
        },
        (enrichedActivity) => {
          // Update activity with enrichment data (coordinates, rating, place_id)
          setSuggestedActivities((prev) =>
            prev.map((a) => (a.id === enrichedActivity.id ? enrichedActivity : a))
          );
        }
      );
    } catch (error) {
      console.error("Suggest activities error:", error);
      alert("Failed to suggest activities. Please try again.");
      setLoading(false);
    }
  };

  const handleAnswerResearchQuestions = async (answers: Record<string, string>) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await answerResearchQuestions(sessionId, answers);
      if (response.success && response.tripInfo) {
        setTripInfo(response.tripInfo);
      }
    } catch (error) {
      console.error("Answer research questions error:", error);
      alert("Failed to save answers. Please try again.");
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
    if (!sessionId || selectedActivityIds.length === 0) return;
    setLoading(true);

    try {
      // First save selections
      const selectResponse = await selectActivities(sessionId, selectedActivityIds);
      if (!selectResponse.success) {
        throw new Error(selectResponse.message);
      }

      // Then group into days
      const groupResponse = await groupDays(sessionId);
      if (groupResponse.success) {
        setWorkflowState(WORKFLOW_STATES.GROUP_DAYS);
        updateMaxReachedState(WORKFLOW_STATES.GROUP_DAYS);
        setDayGroups(groupResponse.dayGroups || []);
        setGroupedDays(groupResponse.groupedDays || []);
        setLastGroupedActivityIds([...selectedActivityIds]);
        setChatHistory((prev) => [...prev, { role: "assistant", content: groupResponse.message }]);
      }
    } catch (error) {
      console.error("Group days error:", error);
      alert("Failed to organize activities. Please try again.");
    } finally {
      setLoading(false);
    }
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

  const handleRegenerateActivities = async () => {
    if (!sessionId) return;
    setSuggestedActivities([]);
    handleSuggestActivities();
  };

  // Update preferences
  const handleUpdatePreferences = async (newPreferences: string[]) => {
    if (!sessionId || !tripInfo) return;

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

  // Get state label
  const getStateLabel = () => {
    switch (workflowState) {
      case WORKFLOW_STATES.INFO_GATHERING:
        return "Gathering Info";
      case WORKFLOW_STATES.INITIAL_RESEARCH:
        return "Initial Research";
      case WORKFLOW_STATES.SUGGEST_ACTIVITIES:
        return "Select Activities";
      case WORKFLOW_STATES.SELECT_ACTIVITIES:
        return "Select Activities";
      case WORKFLOW_STATES.GROUP_DAYS:
        return "Organize Days";
      case WORKFLOW_STATES.DAY_ITINERARY:
        return "Your Itinerary";
      case WORKFLOW_STATES.MEAL_PREFERENCES:
        return "Add Restaurants";
      case WORKFLOW_STATES.REVIEW:
        return "Review";
      case WORKFLOW_STATES.FINALIZE:
        return "Finalized";
      default:
        return "";
    }
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

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {(() => {
            switch (workflowState) {
              case WORKFLOW_STATES.INITIAL_RESEARCH:
                return (
                  <InitialResearchView
                    tripInfo={tripInfo}
                    researchBrief={tripResearchBrief}
                    researchOptionSelections={researchOptionSelections}
                    onSelectionChange={handleResearchSelectionChange}
                    onResolveDurationConflict={handleResolveDurationConflict}
                    hasUnresolvedAssumptionConflicts={hasUnresolvedAssumptionConflicts}
                    onRegenerate={handleGenerateResearchBrief}
                    onProceed={handleProceedFromResearch}
                    onAnswerQuestions={handleAnswerResearchQuestions}
                    isLoading={loading}
                  />
                );

              case WORKFLOW_STATES.SUGGEST_ACTIVITIES:
                return (
                  <div className="p-4">
                    <ActivitySelectionView
                      activities={suggestedActivities}
                      selectedIds={selectedActivityIds}
                      userPreferences={tripInfo?.preferences || []}
                      onSelectionChange={handleActivitySelectionChange}
                      onConfirm={handleConfirmActivitySelection}
                      onRegenerate={handleRegenerateActivities}
                      onHoverActivity={setHoveredActivityId}
                      isLoading={loading}
                    />
                  </div>
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

  // Render action button
  const renderActionButton = () => {
    switch (workflowState) {
      case WORKFLOW_STATES.INFO_GATHERING:
        return canProceed ? (
          <Button onClick={handleGenerateResearchBrief} disabled={loading} className="w-full mt-4">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Create Initial Research Brief
          </Button>
        ) : null;

      case WORKFLOW_STATES.INITIAL_RESEARCH:
        return (
          <Button
            onClick={handleProceedFromResearch}
            disabled={loading || hasUnresolvedAssumptionConflicts}
            className="w-full mt-4"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {hasUnresolvedAssumptionConflicts ? "Resolve Assumptions to Continue" : "Generate Top Activities"}
          </Button>
        );

      case WORKFLOW_STATES.DAY_ITINERARY:
        return (
          <div className="flex gap-2 mt-4">
            <Button onClick={handleGetRestaurants} disabled={loading} className="flex-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Add Restaurants
            </Button>
            <Button onClick={handleSkipRestaurants} disabled={loading} variant="outline" className="flex-1">
              Skip to Review
            </Button>
          </div>
        );

      case WORKFLOW_STATES.REVIEW:
        return (
          <Button
            onClick={handleFinalize}
            disabled={loading}
            className="w-full mt-4 bg-green-600 hover:bg-green-700"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Finalize Itinerary
          </Button>
        );

      default:
        return null;
    }
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
      <div className="flex h-full flex-col lg:flex-row">
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
            />
          </div>

          {/* AI Travel Companion */}
          <div
            className={`absolute bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-[380px] ${isChatMinimized ? "h-[56px]" : "h-[40%] min-h-[260px] max-h-[420px]"
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
                <Badge className="bg-blue-500">{getStateLabel()}</Badge>
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

                  {renderActionButton()}
                </ScrollArea>

                <div className="p-3 border-t border-gray-100 flex gap-2 flex-shrink-0">
                  <Input
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
  );
}
