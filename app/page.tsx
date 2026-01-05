"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send } from "lucide-react";
import MapComponent from "@/components/MapComponent";
import { ActivitySelectionView } from "@/components/ActivitySelectionView";
import { DayGroupingView } from "@/components/DayGroupingView";
import { RestaurantSelectionView } from "@/components/RestaurantSelectionView";
import { DayItineraryView } from "@/components/DayItineraryView";
import {
  startSession,
  chat,
  finalize,
  suggestTopActivities,
  selectActivities,
  groupDays,
  adjustDayGroups,
  confirmDayGrouping,
  getRestaurantSuggestions,
  setMealPreferences,
  updateTripInfo,
  type TripInfo,
  type SuggestedActivity,
  type GroupedDay,
  type RestaurantSuggestion,
  type DayGroup,
} from "@/lib/api-client";
import { ConstraintsView } from "@/components/ConstraintsView";
import { MessageSquare, ListChecks } from "lucide-react";


// Workflow states
const WORKFLOW_STATES = {
  INFO_GATHERING: "INFO_GATHERING",
  SUGGEST_ACTIVITIES: "SUGGEST_ACTIVITIES",
  SELECT_ACTIVITIES: "SELECT_ACTIVITIES",
  GROUP_DAYS: "GROUP_DAYS",
  DAY_ITINERARY: "DAY_ITINERARY",
  MEAL_PREFERENCES: "MEAL_PREFERENCES",
  REVIEW: "REVIEW",
  FINALIZE: "FINALIZE",
};

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

  // New activity-first flow state
  const [suggestedActivities, setSuggestedActivities] = useState<SuggestedActivity[]>([]);
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [dayGroups, setDayGroups] = useState<DayGroup[]>([]);
  const [groupedDays, setGroupedDays] = useState<GroupedDay[]>([]);
  const [restaurantSuggestions, setRestaurantSuggestions] = useState<RestaurantSuggestion[]>([]);
  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState<string[]>([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [canProceed, setCanProceed] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "constraints">("chat");
  const [hoveredActivityId, setHoveredActivityId] = useState<string | null>(null);


  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      setTimeout(() => {
        chatScrollRef.current?.scrollTo({
          top: chatScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
    }
  }, [chatHistory]);

  // Initialize session on mount
  useEffect(() => {
    initializeSession();
  }, []);

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
        if (response.canProceed !== undefined) setCanProceed(response.canProceed);
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

  // Suggest top 15 activities
  const handleSuggestActivities = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await suggestTopActivities(sessionId);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.SUGGEST_ACTIVITIES);
        setSuggestedActivities(response.suggestedActivities || []);
        setSelectedActivityIds([]);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Suggest activities error:", error);
      alert("Failed to suggest activities. Please try again.");
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
        setDayGroups(groupResponse.dayGroups || []);
        setGroupedDays(groupResponse.groupedDays || []);
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
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Finalize error:", error);
      alert("Failed to finalize itinerary. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Update constraints
  const handleUpdateConstraints = async (newConstraints: string[]) => {
    if (!sessionId || !tripInfo) return;

    // Optimistic update
    const updatedTripInfo = { ...tripInfo, constraints: newConstraints };
    setTripInfo(updatedTripInfo);
    setLoading(true);

    try {
      const response = await updateTripInfo(sessionId, { constraints: newConstraints });
      if (response.success && response.tripInfo) {
        setTripInfo(response.tripInfo);
      }
    } catch (error) {
      console.error("Failed to update constraints:", error);
      alert("Failed to save constraints. Please try again.");
    } finally {
      setLoading(false);
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
    switch (workflowState) {
      case WORKFLOW_STATES.SUGGEST_ACTIVITIES:
      case WORKFLOW_STATES.SELECT_ACTIVITIES:
        return (
          <div className="p-4">
            <ActivitySelectionView
              activities={suggestedActivities}
              selectedIds={selectedActivityIds}
              onSelectionChange={handleActivitySelectionChange}
              onConfirm={handleConfirmActivitySelection}
              onHoverActivity={setHoveredActivityId}
              isLoading={loading}
            />
          </div>
        );

      case WORKFLOW_STATES.GROUP_DAYS:
        return (
          <div className="p-4">
            <DayGroupingView
              groupedDays={groupedDays}
              onMoveActivity={handleMoveActivity}
              onConfirm={handleConfirmDayGrouping}
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
          <div className="p-4">
            <DayItineraryView groupedDays={groupedDays} tripInfo={tripInfo || undefined} />
          </div>
        );

      default:
        return null;
    }
  };

  // Render action button
  const renderActionButton = () => {
    switch (workflowState) {
      case WORKFLOW_STATES.INFO_GATHERING:
        return canProceed ? (
          <Button onClick={handleSuggestActivities} disabled={loading} className="w-full mt-4">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Find Top Activities
          </Button>
        ) : null;

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
  const showMap =
    workflowState === WORKFLOW_STATES.INFO_GATHERING ||
    suggestedActivities.length > 0 ||
    groupedDays.length > 0;

  return (
    <div className="h-screen overflow-hidden bg-gray-100">
      <div className="flex h-full">
        {/* Left Panel: Map + Content View */}
        <div className="w-[60%] h-full overflow-y-auto">
          {/* Map */}
          <div className="h-[400px] min-h-[300px]">
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
            />
          </div>

          {/* State-specific content */}
          {renderLeftPanelContent()}
        </div>

        {/* Right Panel: Chat */}
        <div className="w-[40%] h-full bg-white border-l border-gray-200 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 text-center flex-shrink-0">
            <h1 className="text-xl font-bold text-gray-800">
              {tripInfo?.destination || "Planning Your Trip"}
            </h1>
            {tripInfo?.startDate && tripInfo?.endDate && (
              <p className="text-sm text-gray-500">
                {tripInfo.startDate} - {tripInfo.endDate}
              </p>
            )}
            <Badge className="mt-2 bg-blue-500">{getStateLabel()}</Badge>
          </div>

          {/* Tab Switcher */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "chat"
                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button
              onClick={() => setActiveTab("constraints")}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "constraints"
                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
            >
              <ListChecks className="w-4 h-4" />
              Constraints
              {tripInfo?.constraints && tripInfo.constraints.length > 0 && (
                <Badge className="ml-1 px-1.5 py-0 min-w-[18px] h-[18px] bg-blue-100 text-blue-700 hover:bg-blue-100">
                  {tripInfo.constraints.length}
                </Badge>
              )}
            </button>
          </div>

          {activeTab === "chat" ? (
            <>
              {/* Chat Messages */}
              <ScrollArea className="flex-1 p-4" ref={chatScrollRef}>
                <div className="space-y-3">
                  {chatHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-2xl max-w-[85%] ${msg.role === "user" ? "bg-blue-500 text-white ml-auto" : "bg-gray-200 text-gray-800"
                        }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                    </div>
                  )}
                </div>

                {/* Suggestion Chips */}
                {workflowState === WORKFLOW_STATES.INFO_GATHERING &&
                  chatHistory.length === 1 &&
                  !loading && (
                    <div className="mt-4 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <button
                        onClick={() => handleSuggestionClick("Plan a 4-day moderate trip to Maui from May 10th to May 14th 2026. I'm interested in snorkeling, hiking, and local seafood.")}
                        className="px-4 py-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors shadow-sm"
                      >
                        🌴 Maui: 4-day adventure
                      </button>
                      <button
                        onClick={() => handleSuggestionClick("Plan a 4-day relaxed trip to Switzerland from June 15th to June 19th 2026. I'm interested in scenic trains, chocolate, and mountain views.")}
                        className="px-4 py-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors shadow-sm"
                      >
                        🏔️ Switzerland: 4-day escape
                      </button>
                    </div>
                  )}

                {/* Action Button */}
                {renderActionButton()}
              </ScrollArea>

              {/* Chat Input */}
              <div className="p-4 border-t border-gray-200 flex gap-2 flex-shrink-0">
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
                  className="flex-1"
                />
                <Button onClick={handleChat} disabled={loading || !chatInput.trim() || isFinalized} size="icon">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </>
          ) : (
            <ConstraintsView
              constraints={tripInfo?.constraints || []}
              onUpdateConstraints={handleUpdateConstraints}
              isLoading={loading}
            />
          )}

        </div>
      </div>
    </div>
  );
}
