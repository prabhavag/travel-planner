"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send } from "lucide-react";
import MapComponent from "@/components/MapComponent";
import SkeletonView from "@/components/SkeletonView";
import DetailedItineraryView from "@/components/DetailedItineraryView";
import {
  startSession,
  chat,
  generateSkeleton,
  confirmDaySelections,
  expandDay,
  modifyDay,
  startReview,
  finalize,
  suggestActivities,
  suggestMealsNearby,
  type TripInfo,
  type Skeleton,
  type ExpandedDay,
  type FinalPlan,
  type ActivitySuggestions,
  type MealSuggestions,
  type ActivityOption,
  type MealOption,
} from "@/lib/api-client";

// Workflow states
const WORKFLOW_STATES = {
  INFO_GATHERING: "INFO_GATHERING",
  SKELETON: "SKELETON",
  EXPAND_DAY: "EXPAND_DAY",
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
  const [skeleton, setSkeleton] = useState<Skeleton | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<number, ExpandedDay>>({});
  const [currentExpandDay, setCurrentExpandDay] = useState<number | null>(null);
  const [finalPlan, setFinalPlan] = useState<FinalPlan | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [canProceed, setCanProceed] = useState(false);

  // Two-step expand day flow state
  const [expandDayStep, setExpandDayStep] = useState<"activities" | "meals">("activities");
  const [activitySuggestions, setActivitySuggestions] = useState<ActivitySuggestions | null>(null);
  const [mealSuggestions, setMealSuggestions] = useState<MealSuggestions | null>(null);
  const [activitySelections, setActivitySelections] = useState<Record<string, string[]>>({
    morningActivities: [],
    afternoonActivities: [],
    eveningActivities: [],
  });
  const [mealSelections, setMealSelections] = useState<Record<string, string | null>>({
    breakfast: null,
    lunch: null,
    dinner: null,
  });

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
      if (workflowState === WORKFLOW_STATES.EXPAND_DAY && currentExpandDay) {
        const dayMatch = userMessage.match(/day\s*(\d+)/i);
        const mentionedDay = dayMatch ? parseInt(dayMatch[1]) : null;
        const targetDay = mentionedDay && expandedDays[mentionedDay] ? mentionedDay : currentExpandDay;

        if (expandedDays[targetDay]) {
          const response = await modifyDay(sessionId, targetDay, userMessage);
          if (response.success) {
            setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
            if (response.expandedDay) {
              setExpandedDays(response.allExpandedDays || { ...expandedDays, [targetDay]: response.expandedDay });
            }
          }
        } else {
          const response = await suggestActivities(sessionId, currentExpandDay, userMessage);
          if (response.success) {
            setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
            setActivitySuggestions(response.suggestions || null);
            setActivitySelections({ morningActivities: [], afternoonActivities: [], eveningActivities: [] });
            setMealSelections({ breakfast: null, lunch: null, dinner: null });
            setMealSuggestions(null);
            setExpandDayStep("activities");
          }
        }
      } else {
        const response = await chat(sessionId, userMessage);
        if (response.success) {
          setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
          if (response.tripInfo) setTripInfo(response.tripInfo);
          if (response.canProceed !== undefined) setCanProceed(response.canProceed);
          if (response.skeleton !== undefined) {
            setSkeleton(response.skeleton || null);
            if (!response.skeleton) {
              setCurrentExpandDay(null);
              setFinalPlan(null);
              setActivitySuggestions(null);
              setMealSuggestions(null);
            }
          }
          if (response.expandedDays !== undefined) setExpandedDays(response.expandedDays);
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setChatHistory((prev) => [...prev, { role: "assistant", content: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  // Generate skeleton itinerary
  const handleGenerateSkeleton = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await generateSkeleton(sessionId);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.SKELETON);
        setSkeleton(response.skeleton || null);
        setTripInfo(response.tripInfo || null);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
        setCurrentExpandDay(response.nextDayToExpand || 1);
      }
    } catch (error) {
      console.error("Generate skeleton error:", error);
      alert("Failed to generate trip overview. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Get suggestions for a day
  const handleSuggestDay = async (dayNumber: number) => {
    if (!sessionId) return;
    setLoading(true);
    setCurrentExpandDay(dayNumber);

    setActivitySelections({ morningActivities: [], afternoonActivities: [], eveningActivities: [] });
    setMealSelections({ breakfast: null, lunch: null, dinner: null });
    setMealSuggestions(null);
    setExpandDayStep("activities");

    try {
      const response = await suggestActivities(sessionId, dayNumber);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.EXPAND_DAY);
        setActivitySuggestions(response.suggestions || null);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Suggest activities error:", error);
      alert("Failed to get activity suggestions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Toggle activity selection
  const toggleActivitySelection = (slotType: string, optionId: string) => {
    setActivitySelections((prev) => {
      const current = prev[slotType] || [];
      const isSelected = current.includes(optionId);
      return {
        ...prev,
        [slotType]: isSelected ? current.filter((id) => id !== optionId) : [...current, optionId],
      };
    });
  };

  // Toggle meal selection
  const toggleMealSelection = (mealType: string, optionId: string) => {
    setMealSelections((prev) => ({
      ...prev,
      [mealType]: prev[mealType] === optionId ? null : optionId,
    }));
  };

  // Confirm activities and get meals
  const handleConfirmActivities = async () => {
    if (!sessionId || !currentExpandDay) return;
    setLoading(true);

    try {
      const response = await suggestMealsNearby(sessionId, currentExpandDay, activitySelections);
      if (response.success) {
        setMealSuggestions(response.mealSuggestions || null);
        setExpandDayStep("meals");
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Suggest meals error:", error);
      alert("Failed to get meal suggestions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Confirm day selections
  const handleConfirmDay = async () => {
    if (!sessionId || !currentExpandDay) return;
    setLoading(true);

    try {
      const combinedSelections = { ...activitySelections, ...mealSelections };
      const response = await confirmDaySelections(sessionId, currentExpandDay, combinedSelections);
      if (response.success) {
        setExpandedDays(response.allExpandedDays || { ...expandedDays, [currentExpandDay]: response.expandedDay! });
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
        setCurrentExpandDay(response.nextDayToExpand || currentExpandDay);
        setActivitySuggestions(null);
        setMealSuggestions(null);
        setExpandDayStep("activities");
      }
    } catch (error) {
      console.error("Confirm day error:", error);
      alert("Failed to confirm day. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Expand day directly
  const handleExpandDay = async (dayNumber: number) => {
    if (!sessionId) return;
    setLoading(true);
    setCurrentExpandDay(dayNumber);

    try {
      const response = await expandDay(sessionId, dayNumber);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.EXPAND_DAY);
        setExpandedDays(response.allExpandedDays || { ...expandedDays, [dayNumber]: response.expandedDay! });
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
        setCurrentExpandDay(response.nextDayToExpand || dayNumber);
      }
    } catch (error) {
      console.error("Expand day error:", error);
      alert("Failed to expand day. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Start review
  const handleStartReview = async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      const response = await startReview(sessionId);
      if (response.success) {
        setWorkflowState(WORKFLOW_STATES.REVIEW);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
        if (response.expandedDays) setExpandedDays(response.expandedDays);
      }
    } catch (error) {
      console.error("Start review error:", error);
      alert("Failed to start review. Please try again.");
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
        setFinalPlan(response.finalPlan || null);
        setChatHistory((prev) => [...prev, { role: "assistant", content: response.message }]);
      }
    } catch (error) {
      console.error("Finalize error:", error);
      alert("Failed to finalize itinerary. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Get itinerary for map
  const getItineraryForMap = () => {
    type MapActivity = { name: string; coordinates: { lat: number; lng: number }; time?: string };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatActivity = (activity: any): MapActivity | null => {
      if (!activity?.coordinates?.lat || !activity?.coordinates?.lng) return null;
      return { name: activity.name, coordinates: activity.coordinates, time: activity.time || activity.timeSlot };
    };

    const filterNulls = (arr: (MapActivity | null)[]): MapActivity[] =>
      arr.filter((x): x is MapActivity => x !== null);

    if (finalPlan?.itinerary) {
      return finalPlan.itinerary.map((day) => ({
        day_number: day.day_number || day.dayNumber,
        date: day.date,
        morning: filterNulls([formatActivity(day.breakfast), ...(day.morning || []).map(formatActivity)]),
        afternoon: filterNulls([formatActivity(day.lunch), ...(day.afternoon || []).map(formatActivity)]),
        evening: filterNulls([formatActivity(day.dinner), ...(day.evening || []).map(formatActivity)]),
      }));
    }

    return Object.values(expandedDays)
      .sort((a, b) => a.dayNumber - b.dayNumber)
      .map((day) => ({
        day_number: day.dayNumber,
        date: day.date,
        morning: filterNulls([formatActivity(day.breakfast), ...(day.morning || []).map(formatActivity)]),
        afternoon: filterNulls([formatActivity(day.lunch), ...(day.afternoon || []).map(formatActivity)]),
        evening: filterNulls([formatActivity(day.dinner), ...(day.evening || []).map(formatActivity)]),
      }));
  };

  // Get state label
  const getStateLabel = () => {
    switch (workflowState) {
      case WORKFLOW_STATES.INFO_GATHERING: return "Gathering Info";
      case WORKFLOW_STATES.SKELETON: return "Trip Overview";
      case WORKFLOW_STATES.EXPAND_DAY: return `Planning Day ${currentExpandDay || ""}`;
      case WORKFLOW_STATES.REVIEW: return "Review";
      case WORKFLOW_STATES.FINALIZE: return "Finalized";
      default: return "";
    }
  };

  // Render option card
  const renderOptionCard = (
    option: ActivityOption | MealOption,
    isSelected: boolean,
    onPress: () => void,
    type: "activity" | "meal" = "activity"
  ) => {
    const icon = type === "meal" ? "🍽️" : "📍";
    return (
      <Card
        key={option.id}
        className={`flex-1 min-w-[200px] max-w-[48%] cursor-pointer transition-all ${
          isSelected ? "border-2 border-blue-500 bg-blue-50" : "border border-gray-200"
        }`}
        onClick={onPress}
      >
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <span>{icon}</span>
            <span className={`text-sm font-semibold ${isSelected ? "text-blue-600" : "text-gray-700"}`}>
              {option.name}
            </span>
          </div>
          {"description" in option && option.description && (
            <p className="text-xs text-gray-500 mb-2 line-clamp-2">{option.description}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {"cuisine" in option && option.cuisine && (
              <Badge variant="secondary" className="text-[10px]">{option.cuisine}</Badge>
            )}
            {"type" in option && option.type && (
              <Badge variant="secondary" className="text-[10px]">{option.type}</Badge>
            )}
            {"priceRange" in option && option.priceRange && (
              <Badge variant="secondary" className="text-[10px]">{option.priceRange}</Badge>
            )}
            {"estimatedDuration" in option && option.estimatedDuration && (
              <Badge variant="secondary" className="text-[10px]">{option.estimatedDuration}</Badge>
            )}
          </div>
          <Button
            variant={isSelected ? "default" : "outline"}
            size="sm"
            className="mt-2 w-full text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onPress();
            }}
          >
            {isSelected ? "Selected" : "Select"}
          </Button>
        </CardContent>
      </Card>
    );
  };

  // Render suggestions
  const renderSuggestions = () => {
    if (!activitySuggestions) return null;

    const activitySections = [
      { key: "morningActivities", label: "Morning Activities", options: activitySuggestions.morningActivities || [] },
      { key: "afternoonActivities", label: "Afternoon Activities", options: activitySuggestions.afternoonActivities || [] },
      { key: "eveningActivities", label: "Evening Activities", options: activitySuggestions.eveningActivities || [] },
    ];

    const mealSections = mealSuggestions
      ? [
          { key: "breakfast", label: "Breakfast Options", options: mealSuggestions.breakfast || [] },
          { key: "lunch", label: "Lunch Options", options: mealSuggestions.lunch || [] },
          { key: "dinner", label: "Dinner Options", options: mealSuggestions.dinner || [] },
        ]
      : [];

    return (
      <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
        <h3 className="text-lg font-bold text-gray-800 mb-1">
          Day {activitySuggestions.dayNumber}: {activitySuggestions.theme}
        </h3>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <Badge className={expandDayStep === "activities" ? "bg-blue-500" : "bg-gray-300"}>
            1. Activities
          </Badge>
          <span className="text-gray-400">→</span>
          <Badge className={expandDayStep === "meals" ? "bg-blue-500" : "bg-gray-300"}>
            2. Meals
          </Badge>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          {expandDayStep === "activities"
            ? "Select your activities for each time slot:"
            : "Your selected activities:"}
        </p>

        {/* Activity sections */}
        {activitySections.map((section) => {
          if (!section.options?.length) return null;
          return (
            <div key={section.key} className={`mb-4 ${expandDayStep === "meals" ? "opacity-70" : ""}`}>
              <p className="text-sm font-semibold text-gray-600 mb-2">{section.label}</p>
              <div className="flex flex-wrap gap-2">
                {section.options.map((option) => {
                  const isSelected = (activitySelections[section.key] || []).includes(option.id);
                  if (expandDayStep === "meals" && !isSelected) return null;
                  return renderOptionCard(
                    option,
                    isSelected,
                    expandDayStep === "activities" ? () => toggleActivitySelection(section.key, option.id) : () => {},
                    "activity"
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Meal sections */}
        {expandDayStep === "meals" && mealSections.length > 0 && (
          <>
            <p className="text-sm text-gray-500 mt-5 mb-4">
              Select restaurants near your activities:
            </p>
            {mealSections.map((section) => {
              if (!section.options?.length) return null;
              return (
                <div key={section.key} className="mb-4">
                  <p className="text-sm font-semibold text-gray-600 mb-2">{section.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {section.options.map((option) => {
                      const isSelected = mealSelections[section.key] === option.id;
                      return renderOptionCard(
                        option,
                        isSelected,
                        () => toggleMealSelection(section.key, option.id),
                        "meal"
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  };

  // Render action button
  const renderActionButton = () => {
    switch (workflowState) {
      case WORKFLOW_STATES.INFO_GATHERING:
        return canProceed ? (
          <Button onClick={handleGenerateSkeleton} disabled={loading} className="w-full mt-4">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Generate Trip Overview
          </Button>
        ) : null;

      case WORKFLOW_STATES.SKELETON:
        return (
          <Button onClick={() => handleSuggestDay(1)} disabled={loading} className="w-full mt-4">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Start Planning Day 1
          </Button>
        );

      case WORKFLOW_STATES.EXPAND_DAY: {
        const totalDays = skeleton?.days?.length || 0;
        const expandedCount = Object.keys(expandedDays).length;

        if (activitySuggestions) {
          if (expandDayStep === "activities") {
            const hasSelections = Object.values(activitySelections).some((arr) => arr.length > 0);
            return (
              <Button onClick={handleConfirmActivities} disabled={loading || !hasSelections} className="w-full mt-4 bg-blue-600">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm Activities & Find Restaurants
              </Button>
            );
          } else {
            return (
              <Button onClick={handleConfirmDay} disabled={loading} className="w-full mt-4 bg-blue-600">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm Day {currentExpandDay}
              </Button>
            );
          }
        }

        if (expandedCount >= totalDays) {
          return (
            <Button onClick={handleStartReview} disabled={loading} className="w-full mt-4">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Review All Days
            </Button>
          );
        } else {
          const nextDay = skeleton?.days?.find((d) => !expandedDays[d.dayNumber]);
          if (nextDay) {
            return (
              <Button onClick={() => handleSuggestDay(nextDay.dayNumber)} disabled={loading} className="w-full mt-4">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Continue to Day {nextDay.dayNumber}
              </Button>
            );
          }
        }
        return null;
      }

      case WORKFLOW_STATES.REVIEW:
        return (
          <Button onClick={handleFinalize} disabled={loading} className="w-full mt-4 bg-green-600 hover:bg-green-700">
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

  const itineraryForMap = getItineraryForMap();
  const isFinalized = workflowState === WORKFLOW_STATES.FINALIZE;

  return (
    <div className="h-screen overflow-hidden bg-gray-100">
      <div className="flex h-full">
        {/* Left Panel: Map + Itinerary View */}
        <div className="w-[60%] h-full overflow-y-auto">
          <div className="h-[400px] min-h-[300px]">
            <MapComponent itinerary={itineraryForMap} destination={tripInfo?.destination} />
          </div>

          {/* Skeleton View */}
          {(workflowState === WORKFLOW_STATES.SKELETON ||
            workflowState === WORKFLOW_STATES.EXPAND_DAY ||
            workflowState === WORKFLOW_STATES.REVIEW) &&
            skeleton &&
            !isFinalized && (
              <SkeletonView
                skeleton={skeleton}
                tripInfo={tripInfo}
                expandedDays={expandedDays}
                currentExpandDay={currentExpandDay}
                onExpandDay={handleSuggestDay}
              />
            )}

          {/* Detailed Itinerary View */}
          {isFinalized && finalPlan?.itinerary && (
            <DetailedItineraryView itinerary={finalPlan.itinerary} />
          )}
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

          {/* Chat Messages */}
          <ScrollArea className="flex-1 p-4" ref={chatScrollRef}>
            <div className="space-y-3">
              {chatHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-2xl max-w-[85%] ${
                    msg.role === "user"
                      ? "bg-blue-500 text-white ml-auto"
                      : "bg-gray-200 text-gray-800"
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

            {/* Suggestions UI */}
            {renderSuggestions()}

            {/* Action Button */}
            {renderActionButton()}
          </ScrollArea>

          {/* Chat Input */}
          <div className="p-4 border-t border-gray-200 flex gap-2 flex-shrink-0">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                workflowState === WORKFLOW_STATES.EXPAND_DAY
                  ? "Suggest changes for this day..."
                  : "Type your message..."
              }
              onKeyDown={(e) => e.key === "Enter" && handleChat()}
              disabled={loading || isFinalized}
              className="flex-1"
            />
            <Button
              onClick={handleChat}
              disabled={loading || !chatInput.trim() || isFinalized}
              size="icon"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
