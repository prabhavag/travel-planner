import { randomUUID } from "crypto";
import { z } from "zod";
import type {
  AgentTurnRequest,
  GroupedDay,
  LoopContext,
  LoopId,
  LoopResult,
  RestaurantSuggestion,
  SuggestedActivity,
  StopReason,
  ToolAction,
} from "@/lib/models/travel-plan";
import { AgentTurnRequestSchema, LoopResultSchema, ToolActionSchema } from "@/lib/models/travel-plan";
import { sessionStore, WORKFLOW_STATES, type Session, type WorkflowState } from "@/lib/services/session-store";
import { requiresTravelOfferCompletionForState, validateWorkflowTransition } from "@/lib/services/workflow-transition";
import { buildGroupedDays, groupActivitiesByDay, generateDayTheme } from "@/lib/services/day-grouping";
import { getPlacesClient } from "@/lib/services/places-client";
import { getPriceRangeSymbol } from "@/lib/utils/currency";
import { getLLMClient } from "@/lib/services/llm-client";
import { mergeResearchBriefAndSelections } from "@/lib/services/card-merging";
import { runAccommodationSearch, runFlightSearch } from "@/lib/services/sub-agent-search";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.55;

const PLANNING_TOOLS: ToolAction["tool"][] = [
  "select_activities",
  "adjust_day_groups",
  "confirm_day_grouping",
  "get_restaurant_suggestions",
  "search_accommodation",
  "search_flights",
  "refresh_accommodation_search",
  "refresh_flight_search",
  "select_accommodation",
  "select_flight",
  "skip_accommodation",
  "skip_flight",
];

const HOSPITALITY_REVIEW_TOOLS: ToolAction["tool"][] = [
  "get_restaurant_suggestions",
  "set_meal_preferences",
  "review_patch_grouped_days",
  "finalize",
  "search_accommodation",
  "search_flights",
  "refresh_accommodation_search",
  "refresh_flight_search",
  "select_accommodation",
  "select_flight",
  "skip_accommodation",
  "skip_flight",
];

const finalizeIntentRegex = /\b(final|finalize|done|perfect|looks good|good to go|ship it|complete)\b/i;

const selectActivitiesInputSchema = z.object({
  selectedActivityIds: z.array(z.string()),
});

const adjustDayGroupsInputSchema = z.object({
  activityId: z.string(),
  fromDay: z.number().int().positive(),
  toDay: z.number().int().positive(),
});

const setMealPreferencesInputSchema = z.object({
  wantsRestaurants: z.boolean(),
  selectedRestaurantIds: z.array(z.string()).optional(),
});

const selectAccommodationInputSchema = z.object({
  optionId: z.string().min(1),
});

const selectFlightInputSchema = z.object({
  optionId: z.string().min(1),
});

const RESTAURANT_TYPE_TOKENS = [
  "italian_restaurant",
  "chinese_restaurant",
  "mexican_restaurant",
  "japanese_restaurant",
  "indian_restaurant",
  "thai_restaurant",
  "french_restaurant",
  "american_restaurant",
  "mediterranean_restaurant",
  "vietnamese_restaurant",
  "korean_restaurant",
  "greek_restaurant",
];

const reviewPatchGroupedDaysInputSchema = z.object({
  modifications: z.record(z.string(), z.record(z.string(), z.unknown())),
});

type SupervisorDecision = {
  targetLoop: LoopId;
  allowedTools: ToolAction["tool"][];
  confidenceThreshold: number;
};

type TurnResponse = {
  success: boolean;
  sessionId: string;
  workflowState: WorkflowState;
  message: string;
  tripInfo: Session["tripInfo"];
  tripResearchBrief: Session["tripResearchBrief"];
  researchOptionSelections: Session["researchOptionSelections"];
  suggestedActivities: Session["suggestedActivities"];
  selectedActivityIds: Session["selectedActivityIds"];
  dayGroups: Session["dayGroups"];
  groupedDays: Session["groupedDays"];
  restaurantSuggestions: Session["restaurantSuggestions"];
  selectedRestaurantIds: Session["selectedRestaurantIds"];
  wantsRestaurants: Session["wantsRestaurants"];
  accommodationStatus: Session["accommodationStatus"];
  flightStatus: Session["flightStatus"];
  accommodationError: Session["accommodationError"];
  flightError: Session["flightError"];
  accommodationOptions: Session["accommodationOptions"];
  flightOptions: Session["flightOptions"];
  selectedAccommodationOptionId: Session["selectedAccommodationOptionId"];
  selectedFlightOptionId: Session["selectedFlightOptionId"];
  wantsAccommodation: Session["wantsAccommodation"];
  wantsFlight: Session["wantsFlight"];
  accommodationLastSearchedAt: Session["accommodationLastSearchedAt"];
  flightLastSearchedAt: Session["flightLastSearchedAt"];
  activeLoop: LoopId;
  loopResult: LoopResult | null;
};

function buildSessionSnapshot(session: Session, message: string): TurnResponse {
  return {
    success: true,
    sessionId: session.sessionId,
    workflowState: session.workflowState,
    message,
    tripInfo: session.tripInfo,
    tripResearchBrief: session.tripResearchBrief,
    researchOptionSelections: session.researchOptionSelections,
    suggestedActivities: session.suggestedActivities,
    selectedActivityIds: session.selectedActivityIds,
    dayGroups: session.dayGroups,
    groupedDays: session.groupedDays,
    restaurantSuggestions: session.restaurantSuggestions,
    selectedRestaurantIds: session.selectedRestaurantIds,
    wantsRestaurants: session.wantsRestaurants,
    accommodationStatus: session.accommodationStatus,
    flightStatus: session.flightStatus,
    accommodationError: session.accommodationError,
    flightError: session.flightError,
    accommodationOptions: session.accommodationOptions,
    flightOptions: session.flightOptions,
    selectedAccommodationOptionId: session.selectedAccommodationOptionId,
    selectedFlightOptionId: session.selectedFlightOptionId,
    wantsAccommodation: session.wantsAccommodation,
    wantsFlight: session.wantsFlight,
    accommodationLastSearchedAt: session.accommodationLastSearchedAt,
    flightLastSearchedAt: session.flightLastSearchedAt,
    activeLoop: session.activeLoop,
    loopResult: session.lastLoopResult,
  };
}

function buildLoopContext(session: Session): LoopContext {
  return {
    workflowState: session.workflowState,
    tripInfo: session.tripInfo,
    researchOptionSelections: session.researchOptionSelections || {},
    suggestedActivities: session.suggestedActivities || [],
    selectedActivityIds: session.selectedActivityIds || [],
    dayGroups: session.dayGroups || [],
    groupedDays: session.groupedDays || [],
    restaurantSuggestions: session.restaurantSuggestions || [],
    selectedRestaurantIds: session.selectedRestaurantIds || [],
    accommodationStatus: session.accommodationStatus,
    flightStatus: session.flightStatus,
    accommodationOptions: session.accommodationOptions || [],
    flightOptions: session.flightOptions || [],
    selectedAccommodationOptionId: session.selectedAccommodationOptionId,
    selectedFlightOptionId: session.selectedFlightOptionId,
    wantsAccommodation: session.wantsAccommodation,
    wantsFlight: session.wantsFlight,
    conversationTail: (session.conversationHistory || []).slice(-10),
  };
}

function routeSupervisor(workflowState: WorkflowState): SupervisorDecision | null {
  if (
    workflowState === WORKFLOW_STATES.GROUP_DAYS ||
    workflowState === WORKFLOW_STATES.DAY_ITINERARY
  ) {
    return {
      targetLoop: "PLANNING_LOOP",
      allowedTools: PLANNING_TOOLS,
      confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    };
  }

  if (
    workflowState === WORKFLOW_STATES.MEAL_PREFERENCES ||
    workflowState === WORKFLOW_STATES.REVIEW
  ) {
    return {
      targetLoop: "HOSPITALITY_REVIEW_LOOP",
      allowedTools: HOSPITALITY_REVIEW_TOOLS,
      confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    };
  }

  return null;
}

function lowConfidenceQuestion(message: string): LoopResult {
  return {
    assistantMessage: message,
    confidence: 0.4,
    actions: [],
    stopReason: "low_confidence_noop",
  };
}

function planningLoop({
  context,
  request,
}: {
  context: LoopContext;
  request: AgentTurnRequest;
}): LoopResult {
  const uiType = request.uiAction?.type || "";
  const payload = request.uiAction?.payload || {};

  if (request.trigger === "ui_action") {
    if (uiType === "confirm_grouping") {
      if (context.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
        return lowConfidenceQuestion("You can confirm grouping only while organizing day groups.");
      }
      return {
        assistantMessage: `Your ${context.groupedDays.length}-day itinerary is set! Would you like to add restaurants to your trip?`,
        confidence: 0.95,
        actions: [{ tool: "confirm_day_grouping", input: {} }],
        proposedTransition: WORKFLOW_STATES.DAY_ITINERARY,
        stopReason: "completed_stage",
      };
    }

    if (uiType === "continue_to_restaurants") {
      if (context.workflowState !== WORKFLOW_STATES.DAY_ITINERARY) {
        return lowConfidenceQuestion("You can continue to restaurants after day itinerary is ready.");
      }
      return {
        assistantMessage: "Finding nearby restaurants for your selected activities.",
        confidence: 0.95,
        actions: [{ tool: "get_restaurant_suggestions", input: {} }],
        proposedTransition: WORKFLOW_STATES.MEAL_PREFERENCES,
        stopReason: "completed_stage",
      };
    }

    if (uiType === "reorganize_selection") {
      const selectedActivityIds = Array.isArray(payload.selectedActivityIds)
        ? payload.selectedActivityIds.filter((value): value is string => typeof value === "string")
        : [];

      if (selectedActivityIds.length === 0) {
        return lowConfidenceQuestion("Select at least one activity before reorganizing your trip.");
      }
      return {
        assistantMessage: `Updated ${selectedActivityIds.length} activities and regrouped your itinerary.`,
        confidence: 0.9,
        actions: [{ tool: "select_activities", input: { selectedActivityIds } }],
        proposedTransition: WORKFLOW_STATES.GROUP_DAYS,
        stopReason: "completed_stage",
      };
    }

    if (uiType === "move_activity") {
      const activityId = typeof payload.activityId === "string" ? payload.activityId : null;
      const fromDay = typeof payload.fromDay === "number" ? payload.fromDay : null;
      const toDay = typeof payload.toDay === "number" ? payload.toDay : null;
      if (!activityId || fromDay == null || toDay == null) {
        return lowConfidenceQuestion(
          "I need an activity, source day, and destination day to move the item.",
        );
      }
      return {
        assistantMessage: `Moved activity to Day ${toDay}.`,
        confidence: 0.9,
        actions: [{ tool: "adjust_day_groups", input: { activityId, fromDay, toDay } }],
        stopReason: "completed_stage",
      };
    }

    if (uiType === "refresh_accommodation_search") {
      return {
        assistantMessage: "Refreshing accommodation recommendations.",
        confidence: 0.95,
        actions: [{ tool: "refresh_accommodation_search", input: {} }],
        stopReason: "completed_stage",
      };
    }

    if (uiType === "refresh_flight_search") {
      return {
        assistantMessage: "Refreshing flight recommendations.",
        confidence: 0.95,
        actions: [{ tool: "refresh_flight_search", input: {} }],
        stopReason: "completed_stage",
      };
    }
  }

  if (request.trigger !== "user_message") {
    return lowConfidenceQuestion("Tell me what change you want in your day flow.");
  }

  const userMessage = (request.message || "").toLowerCase().trim();
  if (!userMessage) {
    return lowConfidenceQuestion("Tell me what you want to adjust in your itinerary.");
  }

  if (context.workflowState === WORKFLOW_STATES.GROUP_DAYS && /\b(confirm|continue|looks good|next)\b/.test(userMessage)) {
    return {
      assistantMessage: `Your ${context.groupedDays.length}-day itinerary is set! Would you like to add restaurants to your trip?`,
      confidence: 0.9,
      actions: [{ tool: "confirm_day_grouping", input: {} }],
      proposedTransition: WORKFLOW_STATES.DAY_ITINERARY,
      stopReason: "completed_stage",
    };
  }

  if (
    context.workflowState === WORKFLOW_STATES.DAY_ITINERARY &&
    /\b(restaurant|restaurants|food|meal|dining|eat)\b/.test(userMessage)
  ) {
    return {
      assistantMessage: "Finding nearby restaurants for your selected activities.",
      confidence: 0.85,
      actions: [{ tool: "get_restaurant_suggestions", input: {} }],
      proposedTransition: WORKFLOW_STATES.MEAL_PREFERENCES,
      stopReason: "completed_stage",
    };
  }

  return lowConfidenceQuestion(
    context.workflowState === WORKFLOW_STATES.GROUP_DAYS
      ? "Should I confirm your day grouping now, or move a specific activity to another day?"
      : "Should I find nearby restaurants, or do you want to keep refining day assignments?",
  );
}

async function hospitalityReviewLoop({
  context,
  request,
}: {
  context: LoopContext;
  request: AgentTurnRequest;
}): Promise<LoopResult> {
  const uiType = request.uiAction?.type || "";
  const payload = request.uiAction?.payload || {};

  if (request.trigger === "ui_action") {
    if (uiType === "refresh_accommodation_search") {
      return {
        assistantMessage: "Refreshing accommodation recommendations.",
        confidence: 0.95,
        actions: [{ tool: "refresh_accommodation_search", input: {} }],
        stopReason: "completed_stage",
      };
    }

    if (uiType === "refresh_flight_search") {
      return {
        assistantMessage: "Refreshing flight recommendations.",
        confidence: 0.95,
        actions: [{ tool: "refresh_flight_search", input: {} }],
        stopReason: "completed_stage",
      };
    }

    if (uiType === "add_restaurants") {
      const selectedRestaurantIds = Array.isArray(payload.selectedRestaurantIds)
        ? payload.selectedRestaurantIds.filter((value): value is string => typeof value === "string")
        : [];
      return {
        assistantMessage:
          selectedRestaurantIds.length > 0
            ? `Added ${selectedRestaurantIds.length} restaurant${selectedRestaurantIds.length === 1 ? "" : "s"} to your itinerary. Ready for review!`
            : "Select at least one restaurant or choose Skip Restaurants.",
        confidence: selectedRestaurantIds.length > 0 ? 0.95 : 0.4,
        actions:
          selectedRestaurantIds.length > 0
            ? [{ tool: "set_meal_preferences", input: { wantsRestaurants: true, selectedRestaurantIds } }]
            : [],
        proposedTransition: selectedRestaurantIds.length > 0 ? WORKFLOW_STATES.REVIEW : undefined,
        stopReason: selectedRestaurantIds.length > 0 ? "completed_stage" : "low_confidence_noop",
      };
    }

    if (uiType === "skip_restaurants") {
      return {
        assistantMessage: "Your itinerary is ready for review!",
        confidence: 0.95,
        actions: [{ tool: "set_meal_preferences", input: { wantsRestaurants: false } }],
        proposedTransition: WORKFLOW_STATES.REVIEW,
        stopReason: "completed_stage",
      };
    }

    if (uiType === "finalize_trip") {
      return {
        assistantMessage: "Finalizing your itinerary.",
        confidence: 0.95,
        actions: [{ tool: "finalize", input: {} }],
        proposedTransition: WORKFLOW_STATES.FINALIZE,
        stopReason: "terminal",
      };
    }

    if (uiType === "select_accommodation") {
      const optionId = typeof payload.optionId === "string" ? payload.optionId : "";
      if (!optionId) {
        return lowConfidenceQuestion("Choose a hotel card first.");
      }
      return {
        assistantMessage: "Selected this hotel.",
        confidence: 0.95,
        actions: [{ tool: "select_accommodation", input: { optionId } }],
        stopReason: "completed_stage",
      };
    }

    if (uiType === "select_flight") {
      const optionId = typeof payload.optionId === "string" ? payload.optionId : "";
      if (!optionId) {
        return lowConfidenceQuestion("Choose a flight card first.");
      }
      return {
        assistantMessage: "Selected this flight.",
        confidence: 0.95,
        actions: [{ tool: "select_flight", input: { optionId } }],
        stopReason: "completed_stage",
      };
    }

    if (uiType === "skip_accommodation") {
      return {
        assistantMessage: "Skipping hotels for now.",
        confidence: 0.95,
        actions: [{ tool: "skip_accommodation", input: {} }],
        stopReason: "completed_stage",
      };
    }

    if (uiType === "skip_flight") {
      return {
        assistantMessage: "Skipping flights for now.",
        confidence: 0.95,
        actions: [{ tool: "skip_flight", input: {} }],
        stopReason: "completed_stage",
      };
    }
  }

  if (request.trigger !== "user_message") {
    return lowConfidenceQuestion("Do you want to add restaurants, continue review, or finalize?");
  }

  const userMessage = (request.message || "").trim();
  const lower = userMessage.toLowerCase();

  if (context.workflowState === WORKFLOW_STATES.MEAL_PREFERENCES) {
    if (/\b(skip|no restaurant|without restaurant|no thanks)\b/.test(lower)) {
      return {
        assistantMessage: "Your itinerary is ready for review!",
        confidence: 0.85,
        actions: [{ tool: "set_meal_preferences", input: { wantsRestaurants: false } }],
        proposedTransition: WORKFLOW_STATES.REVIEW,
        stopReason: "completed_stage",
      };
    }

    if (/\b(add|include|use)\b/.test(lower) && /\brestaurant|restaurants\b/.test(lower)) {
      if (context.selectedRestaurantIds.length === 0) {
        return lowConfidenceQuestion("Select restaurants first, then I can add them to your itinerary.");
      }
      return {
        assistantMessage: `Added ${context.selectedRestaurantIds.length} restaurant${context.selectedRestaurantIds.length === 1 ? "" : "s"} to your itinerary. Ready for review!`,
        confidence: 0.8,
        actions: [
          {
            tool: "set_meal_preferences",
            input: {
              wantsRestaurants: true,
              selectedRestaurantIds: context.selectedRestaurantIds,
            },
          },
        ],
        proposedTransition: WORKFLOW_STATES.REVIEW,
        stopReason: "completed_stage",
      };
    }

    return lowConfidenceQuestion("Should I add your selected restaurants or skip restaurants and continue to review?");
  }

  if (context.workflowState === WORKFLOW_STATES.REVIEW) {
    if (finalizeIntentRegex.test(userMessage)) {
      return {
        assistantMessage: "Finalizing your itinerary.",
        confidence: 0.9,
        actions: [{ tool: "finalize", input: {} }],
        proposedTransition: WORKFLOW_STATES.FINALIZE,
        stopReason: "terminal",
      };
    }

    const llmClient = getLLMClient();
    const reviewResult = await llmClient.reviewPlan({
      tripInfo: context.tripInfo,
      groupedDays: context.groupedDays,
      userMessage,
    });

    if (!reviewResult.success) {
      return {
        assistantMessage:
          reviewResult.message || "I couldn't apply that review change right now. Tell me the exact day and change.",
        confidence: 0.45,
        actions: [],
        stopReason: "low_confidence_noop",
      };
    }

    const actions: ToolAction[] = [];
    if (reviewResult.modifications) {
      actions.push({
        tool: "review_patch_grouped_days",
        input: { modifications: reviewResult.modifications as Record<string, Record<string, unknown>> },
      });
    }

    return {
      assistantMessage: reviewResult.message,
      confidence: actions.length > 0 ? 0.75 : 0.7,
      actions,
      stopReason: actions.length > 0 ? "completed_stage" : "needs_user_input",
    };
  }

  return lowConfidenceQuestion("Tell me what part you want to refine next.");
}

function getCurrencyFromSession(session: Session): string {
  for (const day of session.groupedDays || []) {
    for (const activity of day.activities || []) {
      if (activity.currency) return activity.currency;
    }
  }
  for (const activity of session.suggestedActivities || []) {
    if (activity.currency) return activity.currency;
  }
  return "USD";
}

function getCentroid(coordinates: Array<{ lat: number; lng: number }>) {
  if (coordinates.length === 0) return { lat: 0, lng: 0 };
  const sum = coordinates.reduce(
    (acc, coord) => ({ lat: acc.lat + coord.lat, lng: acc.lng + coord.lng }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: sum.lat / coordinates.length,
    lng: sum.lng / coordinates.length,
  };
}

function dedupePlacesById<T extends { place_id: string }>(places: T[]): T[] {
  const byId = new Map<string, T>();
  for (const place of places) {
    if (!byId.has(place.place_id)) {
      byId.set(place.place_id, place);
    }
  }
  return Array.from(byId.values());
}

function distributeRestaurantsAcrossDays(
  groupedDays: GroupedDay[],
  selectedRestaurants: RestaurantSuggestion[],
): GroupedDay[] {
  if (selectedRestaurants.length === 0) {
    return groupedDays;
  }

  const updatedDays = groupedDays.map((day) => ({
    ...day,
    activities: [...day.activities],
    restaurants: [] as RestaurantSuggestion[],
  }));

  const restaurantsPerDay = Math.ceil(selectedRestaurants.length / updatedDays.length);
  let restaurantIndex = 0;
  for (const day of updatedDays) {
    const dayRestaurants: RestaurantSuggestion[] = [];
    for (let i = 0; i < restaurantsPerDay && restaurantIndex < selectedRestaurants.length; i += 1) {
      dayRestaurants.push(selectedRestaurants[restaurantIndex]);
      restaurantIndex += 1;
    }
    day.restaurants = dayRestaurants;
  }

  return updatedDays;
}

async function runTravelOfferSubAgents({
  session,
  working,
}: {
  session: Session;
  working: WorkingSession;
}): Promise<void> {
  working.accommodationStatus = "running";
  working.flightStatus = "running";
  working.accommodationError = null;
  working.flightError = null;
  working.accommodationOptions = [];
  working.flightOptions = [];
  working.selectedAccommodationOptionId = null;
  working.selectedFlightOptionId = null;
  working.wantsAccommodation = null;
  working.wantsFlight = null;
  working.accommodationLastSearchedAt = null;
  working.flightLastSearchedAt = null;

  const simulatedSession = {
    ...session,
    selectedActivityIds: working.selectedActivityIds,
  };
  const [accommodationResult, flightResult] = await Promise.all([
    runAccommodationSearch({ session: simulatedSession }),
    runFlightSearch({ session: simulatedSession }),
  ]);

  const now = new Date().toISOString();
  working.accommodationStatus = accommodationResult.success ? "complete" : "error";
  working.flightStatus = flightResult.success ? "complete" : "error";
  working.accommodationError = accommodationResult.success ? null : accommodationResult.message;
  working.flightError = flightResult.success ? null : flightResult.message;
  working.accommodationOptions = accommodationResult.options;
  working.flightOptions = flightResult.options;
  working.accommodationLastSearchedAt = now;
  working.flightLastSearchedAt = now;
}

type WorkingSession = {
  selectedActivityIds: string[];
  dayGroups: Session["dayGroups"];
  groupedDays: Session["groupedDays"];
  restaurantSuggestions: Session["restaurantSuggestions"];
  selectedRestaurantIds: Session["selectedRestaurantIds"];
  wantsRestaurants: Session["wantsRestaurants"];
  accommodationStatus: Session["accommodationStatus"];
  flightStatus: Session["flightStatus"];
  accommodationError: Session["accommodationError"];
  flightError: Session["flightError"];
  accommodationOptions: Session["accommodationOptions"];
  flightOptions: Session["flightOptions"];
  selectedAccommodationOptionId: Session["selectedAccommodationOptionId"];
  selectedFlightOptionId: Session["selectedFlightOptionId"];
  wantsAccommodation: Session["wantsAccommodation"];
  wantsFlight: Session["wantsFlight"];
  accommodationLastSearchedAt: Session["accommodationLastSearchedAt"];
  flightLastSearchedAt: Session["flightLastSearchedAt"];
};

async function executeAction({
  action,
  session,
  working,
}: {
  action: ToolAction;
  session: Session;
  working: WorkingSession;
}): Promise<string> {
  if (action.tool === "select_activities") {
    const parsed = selectActivitiesInputSchema.parse(action.input);
    const validIds = new Set(session.suggestedActivities.map((activity) => activity.id));
    const invalidIds = parsed.selectedActivityIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      throw new Error(`Invalid activity IDs: ${invalidIds.join(", ")}`);
    }

    const selectedActivities = session.suggestedActivities.filter((activity) =>
      parsed.selectedActivityIds.includes(activity.id),
    );
    const dayGroups = groupActivitiesByDay({
      tripInfo: session.tripInfo,
      activities: selectedActivities,
    });
    const groupedDays = buildGroupedDays({
      dayGroups,
      activities: selectedActivities,
    });

    working.selectedActivityIds = parsed.selectedActivityIds;
    working.dayGroups = dayGroups;
    working.groupedDays = groupedDays;
    await runTravelOfferSubAgents({ session, working });
    return `Updated ${parsed.selectedActivityIds.length} activities and regrouped your itinerary by day.`;
  }

  if (action.tool === "adjust_day_groups") {
    const parsed = adjustDayGroupsInputSchema.parse(action.input);
    if (session.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
      throw new Error("Can only adjust day groups from GROUP_DAYS state");
    }

    const updatedDayGroups = (working.dayGroups || []).map((group) => ({
      ...group,
      activityIds: [...group.activityIds],
    }));
    const sourceDay = updatedDayGroups.find((day) => day.dayNumber === parsed.fromDay);
    const targetDay = updatedDayGroups.find((day) => day.dayNumber === parsed.toDay);
    if (!sourceDay || !targetDay) {
      throw new Error("Could not find source or target day.");
    }
    const activityIndex = sourceDay.activityIds.indexOf(parsed.activityId);
    if (activityIndex === -1) {
      throw new Error(`Activity ${parsed.activityId} not found in day ${parsed.fromDay}`);
    }

    sourceDay.activityIds.splice(activityIndex, 1);
    targetDay.activityIds.push(parsed.activityId);

    const selectedActivities = session.suggestedActivities.filter((activity) =>
      working.selectedActivityIds.includes(activity.id),
    );
    sourceDay.theme = generateDayTheme(
      selectedActivities.filter((activity) => sourceDay.activityIds.includes(activity.id)),
    );
    targetDay.theme = generateDayTheme(
      selectedActivities.filter((activity) => targetDay.activityIds.includes(activity.id)),
    );

    const activityMap = new Map(selectedActivities.map((activity) => [activity.id, activity]));
    const groupedDays = updatedDayGroups.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date,
      theme: day.theme,
      activities: day.activityIds
        .map((id) => activityMap.get(id))
        .filter((activity): activity is SuggestedActivity => Boolean(activity)),
      restaurants: [],
    }));

    working.dayGroups = updatedDayGroups;
    working.groupedDays = groupedDays;
    return `Moved activity to Day ${parsed.toDay}.`;
  }

  if (action.tool === "confirm_day_grouping") {
    if (session.workflowState !== WORKFLOW_STATES.GROUP_DAYS) {
      throw new Error("Can only confirm day grouping from GROUP_DAYS state");
    }
    if (!working.groupedDays || working.groupedDays.length === 0) {
      throw new Error("No grouped days to confirm.");
    }
    return `Your ${working.groupedDays.length}-day itinerary is set! Would you like to add restaurants to your trip?`;
  }

  if (action.tool === "get_restaurant_suggestions") {
    if (session.workflowState !== WORKFLOW_STATES.DAY_ITINERARY) {
      throw new Error("Can only get restaurant suggestions from DAY_ITINERARY state");
    }
    const allCoordinates: Array<{ lat: number; lng: number }> = [];
    for (const day of working.groupedDays) {
      for (const activity of day.activities) {
        if (activity.coordinates) {
          allCoordinates.push(activity.coordinates);
        }
      }
    }
    if (allCoordinates.length === 0) {
      throw new Error("No activity coordinates available");
    }

    let placesClient;
    try {
      placesClient = getPlacesClient();
    } catch {
      throw new Error("Places API not configured");
    }

    const centroid = getCentroid(allCoordinates);
    const currency = getCurrencyFromSession(session);

    // Primary pass: centroid search.
    let places = await placesClient.searchPlaces("restaurant", centroid, 3000, "restaurant");

    // Fallback 1: broader centroid radius.
    if (places.length === 0) {
      places = await placesClient.searchPlaces("restaurant", centroid, 12000, "restaurant");
    }

    // Fallback 2: search around each activity coordinate and merge.
    if (places.length === 0) {
      const perActivityResults = await Promise.all(
        allCoordinates.slice(0, 8).map((coord) =>
          placesClient.searchPlaces("restaurant", coord, 6000, "restaurant"),
        ),
      );
      places = dedupePlacesById(perActivityResults.flat());
    }

    // Fallback 3: destination text search (no location lock).
    if (places.length === 0 && session.tripInfo.destination) {
      places = await placesClient.searchPlaces(
        `restaurants in ${session.tripInfo.destination}`,
        null,
        5000,
        "restaurant",
      );
    }

    const restaurants: RestaurantSuggestion[] = await Promise.all(
      places.slice(0, 10).map(async (place, index) => {
        try {
          const details = place.place_id ? await placesClient.getPlaceDetails(place.place_id) : null;
          const photoUrls =
            details?.photos
              ?.slice(0, 3)
              .map((photo) => placesClient.getPlacePhotoUrl(photo.photo_reference, 300))
              .filter((url): url is string => Boolean(url)) || [];
          return {
            id: `rest${index + 1}`,
            name: place.name,
            cuisine:
              place.types
                .find((type) => RESTAURANT_TYPE_TOKENS.includes(type))
                ?.replace("_restaurant", "")
                .replace("_", " ") || null,
            rating: details?.rating ?? place.rating ?? null,
            user_ratings_total: details?.user_ratings_total ?? null,
            priceRange: getPriceRangeSymbol(details?.price_level ?? place.price_level, currency),
            coordinates: place.location,
            place_id: place.place_id,
            vicinity: place.vicinity || null,
            formatted_address: details?.formatted_address ?? null,
            opening_hours: details?.opening_hours_text ?? null,
            website: details?.website ?? null,
            editorial_summary: details?.editorial_summary ?? null,
            photo_url: photoUrls[0] ?? null,
            photo_urls: photoUrls,
          };
        } catch {
          return {
            id: `rest${index + 1}`,
            name: place.name,
            cuisine:
              place.types
                .find((type) => RESTAURANT_TYPE_TOKENS.includes(type))
                ?.replace("_restaurant", "")
                .replace("_", " ") || null,
            rating: place.rating || null,
            user_ratings_total: null,
            priceRange: getPriceRangeSymbol(place.price_level, currency),
            coordinates: place.location,
            place_id: place.place_id,
            vicinity: place.vicinity || null,
            formatted_address: null,
            opening_hours: null,
            website: null,
            editorial_summary: null,
            photo_url: null,
            photo_urls: [],
          };
        }
      }),
    );

    working.restaurantSuggestions = restaurants;
    working.selectedRestaurantIds = [];
    return `Found ${restaurants.length} restaurants near your activities. Select the ones you'd like to add to your itinerary!`;
  }

  if (action.tool === "set_meal_preferences") {
    const parsed = setMealPreferencesInputSchema.parse(action.input);
    if (
      session.workflowState !== WORKFLOW_STATES.DAY_ITINERARY &&
      session.workflowState !== WORKFLOW_STATES.MEAL_PREFERENCES &&
      session.workflowState !== WORKFLOW_STATES.REVIEW
    ) {
      throw new Error("Meal preferences can only be set from DAY_ITINERARY, MEAL_PREFERENCES, or REVIEW states");
    }

    if (parsed.wantsRestaurants) {
      const selectedIds = parsed.selectedRestaurantIds || [];
      const validIds = new Set((working.restaurantSuggestions || []).map((restaurant) => restaurant.id));
      const invalidIds = selectedIds.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        throw new Error(`Invalid restaurant IDs: ${invalidIds.join(", ")}`);
      }

      const selectedRestaurants = (working.restaurantSuggestions || []).filter((restaurant) =>
        selectedIds.includes(restaurant.id),
      );
      working.groupedDays = distributeRestaurantsAcrossDays(working.groupedDays || [], selectedRestaurants);
      working.selectedRestaurantIds = selectedIds;
      working.wantsRestaurants = true;
      return `Added ${selectedRestaurants.length} restaurant${selectedRestaurants.length === 1 ? "" : "s"} to your itinerary. Ready for review!`;
    }

    working.wantsRestaurants = false;
    working.selectedRestaurantIds = [];
    return "Your itinerary is ready for review!";
  }

  if (action.tool === "review_patch_grouped_days") {
    const parsed = reviewPatchGroupedDaysInputSchema.parse(action.input);
    const updatedGroupedDays = [...working.groupedDays];
    for (const [dayNum, dayData] of Object.entries(parsed.modifications)) {
      const dayIndex = updatedGroupedDays.findIndex((day) => day.dayNumber === parseInt(dayNum, 10));
      if (dayIndex !== -1) {
        updatedGroupedDays[dayIndex] = {
          ...updatedGroupedDays[dayIndex],
          ...(dayData as Partial<GroupedDay>),
        };
      }
    }
    working.groupedDays = updatedGroupedDays;
    return "Updated your itinerary with the requested review changes.";
  }

  if (action.tool === "finalize") {
    return `Your itinerary for ${session.tripInfo.destination} is finalized! You have ${working.groupedDays.length} days planned with ${working.groupedDays.reduce((sum, day) => sum + day.activities.length, 0)} activities${working.groupedDays.reduce((sum, day) => sum + day.restaurants.length, 0) > 0 ? ` and ${working.groupedDays.reduce((sum, day) => sum + day.restaurants.length, 0)} restaurants` : ""}. Have a great trip!`;
  }

  if (action.tool === "select_accommodation") {
    const parsed = selectAccommodationInputSchema.parse(action.input);
    const validIds = new Set((working.accommodationOptions || []).map((option) => option.id));
    if (!validIds.has(parsed.optionId)) {
      throw new Error(`Invalid accommodation option: ${parsed.optionId}`);
    }
    working.selectedAccommodationOptionId = parsed.optionId;
    working.wantsAccommodation = true;
    return "Selected hotel option.";
  }

  if (action.tool === "select_flight") {
    const parsed = selectFlightInputSchema.parse(action.input);
    const validIds = new Set((working.flightOptions || []).map((option) => option.id));
    if (!validIds.has(parsed.optionId)) {
      throw new Error(`Invalid flight option: ${parsed.optionId}`);
    }
    working.selectedFlightOptionId = parsed.optionId;
    working.wantsFlight = true;
    return "Selected flight option.";
  }

  if (action.tool === "skip_accommodation") {
    working.selectedAccommodationOptionId = null;
    working.wantsAccommodation = false;
    return "Skipped hotels.";
  }

  if (action.tool === "skip_flight") {
    working.selectedFlightOptionId = null;
    working.wantsFlight = false;
    return "Skipped flights.";
  }

  if (action.tool === "search_accommodation" || action.tool === "refresh_accommodation_search") {
    working.accommodationStatus = "running";
    working.accommodationError = null;
    const simulatedSession = {
      ...session,
      selectedActivityIds: working.selectedActivityIds,
    };
    const result = await runAccommodationSearch({ session: simulatedSession });
    working.accommodationStatus = result.success ? "complete" : "error";
    working.accommodationError = result.success ? null : result.message;
    working.accommodationOptions = result.options;
    if (!result.options.some((option) => option.id === working.selectedAccommodationOptionId)) {
      working.selectedAccommodationOptionId = null;
      if (working.wantsAccommodation) {
        working.wantsAccommodation = null;
      }
    }
    working.accommodationLastSearchedAt = new Date().toISOString();
    return result.message;
  }

  if (action.tool === "search_flights" || action.tool === "refresh_flight_search") {
    working.flightStatus = "running";
    working.flightError = null;
    const simulatedSession = {
      ...session,
      selectedActivityIds: working.selectedActivityIds,
    };
    const result = await runFlightSearch({ session: simulatedSession });
    working.flightStatus = result.success ? "complete" : "error";
    working.flightError = result.success ? null : result.message;
    working.flightOptions = result.options;
    if (!result.options.some((option) => option.id === working.selectedFlightOptionId)) {
      working.selectedFlightOptionId = null;
      if (working.wantsFlight) {
        working.wantsFlight = null;
      }
    }
    working.flightLastSearchedAt = new Date().toISOString();
    return result.message;
  }

  throw new Error(`Unsupported tool action: ${(action as { tool?: string }).tool || "unknown"}`);
}

function appendRecoveryHint(existing: string[], hint: string): string[] {
  const next = [...(existing || []), hint];
  return next.slice(-20);
}

async function runLoop({
  session,
  request,
  decision,
}: {
  session: Session;
  request: AgentTurnRequest;
  decision: SupervisorDecision;
}): Promise<TurnResponse> {
  const turnId = randomUUID();
  const context = buildLoopContext(session);

  let rawLoopResult: LoopResult;
  if (decision.targetLoop === "PLANNING_LOOP") {
    rawLoopResult = planningLoop({ context, request });
  } else {
    rawLoopResult = await hospitalityReviewLoop({ context, request });
  }

  const parsedLoopResult = LoopResultSchema.safeParse(rawLoopResult);
  if (!parsedLoopResult.success) {
    const fallbackMessage = "I couldn't process that request safely. Please try again with a clearer instruction.";
    const fallbackResult: LoopResult = {
      assistantMessage: fallbackMessage,
      confidence: 0.3,
      actions: [],
      stopReason: "tool_error_recovered",
    };
    sessionStore.update(session.sessionId, {
      activeLoop: "SUPERVISOR",
      lastTurnId: turnId,
      lastLoopResult: fallbackResult,
      recoveryHints: appendRecoveryHint(
        session.recoveryHints,
        JSON.stringify({ turnId, error: "loop_result_validation_failed" }),
      ),
    });
    sessionStore.addToConversation(session.sessionId, "assistant", fallbackMessage);
    const refreshed = sessionStore.get(session.sessionId)!;
    return buildSessionSnapshot(refreshed, fallbackMessage);
  }

  const loopResult = parsedLoopResult.data;
  if (loopResult.confidence < decision.confidenceThreshold || loopResult.stopReason === "low_confidence_noop") {
    const lowConfidenceResult: LoopResult = {
      ...loopResult,
      actions: [],
      stopReason: "low_confidence_noop",
    };

    sessionStore.update(session.sessionId, {
      activeLoop: "SUPERVISOR",
      lastTurnId: turnId,
      lastLoopResult: lowConfidenceResult,
      recoveryHints: appendRecoveryHint(
        session.recoveryHints,
        JSON.stringify({ turnId, stopReason: "low_confidence_noop", confidence: loopResult.confidence }),
      ),
    });
    sessionStore.addToConversation(session.sessionId, "assistant", lowConfidenceResult.assistantMessage);
    const refreshed = sessionStore.get(session.sessionId)!;
    return buildSessionSnapshot(refreshed, lowConfidenceResult.assistantMessage);
  }

  const working: WorkingSession = {
    selectedActivityIds: structuredClone(session.selectedActivityIds || []),
    dayGroups: structuredClone(session.dayGroups || []),
    groupedDays: structuredClone(session.groupedDays || []),
    restaurantSuggestions: structuredClone(session.restaurantSuggestions || []),
    selectedRestaurantIds: structuredClone(session.selectedRestaurantIds || []),
    wantsRestaurants: session.wantsRestaurants,
    accommodationStatus: session.accommodationStatus,
    flightStatus: session.flightStatus,
    accommodationError: session.accommodationError,
    flightError: session.flightError,
    accommodationOptions: structuredClone(session.accommodationOptions || []),
    flightOptions: structuredClone(session.flightOptions || []),
    selectedAccommodationOptionId: session.selectedAccommodationOptionId,
    selectedFlightOptionId: session.selectedFlightOptionId,
    wantsAccommodation: session.wantsAccommodation,
    wantsFlight: session.wantsFlight,
    accommodationLastSearchedAt: session.accommodationLastSearchedAt,
    flightLastSearchedAt: session.flightLastSearchedAt,
  };

  let latestActionMessage = "";
  for (const rawAction of loopResult.actions) {
    const parsedAction = ToolActionSchema.safeParse(rawAction);
    if (!parsedAction.success) {
      const fallbackMessage = "I couldn't apply one of the requested actions safely. I left your plan unchanged.";
      const errorLoopResult: LoopResult = {
        assistantMessage: fallbackMessage,
        confidence: loopResult.confidence,
        actions: [],
        stopReason: "tool_error_recovered",
      };
      sessionStore.update(session.sessionId, {
        activeLoop: "SUPERVISOR",
        lastTurnId: turnId,
        lastLoopResult: errorLoopResult,
        recoveryHints: appendRecoveryHint(
          session.recoveryHints,
          JSON.stringify({ turnId, error: "action_validation_failed" }),
        ),
      });
      sessionStore.addToConversation(session.sessionId, "assistant", fallbackMessage);
      const refreshed = sessionStore.get(session.sessionId)!;
      return buildSessionSnapshot(refreshed, fallbackMessage);
    }

    const action = parsedAction.data;
    if (!decision.allowedTools.includes(action.tool)) {
      const fallbackMessage = `That action is not allowed in ${decision.targetLoop}. I left your plan unchanged.`;
      const errorLoopResult: LoopResult = {
        assistantMessage: fallbackMessage,
        confidence: loopResult.confidence,
        actions: [],
        stopReason: "tool_error_recovered",
      };
      sessionStore.update(session.sessionId, {
        activeLoop: "SUPERVISOR",
        lastTurnId: turnId,
        lastLoopResult: errorLoopResult,
        recoveryHints: appendRecoveryHint(
          session.recoveryHints,
          JSON.stringify({ turnId, error: "tool_not_allowed", tool: action.tool, loop: decision.targetLoop }),
        ),
      });
      sessionStore.addToConversation(session.sessionId, "assistant", fallbackMessage);
      const refreshed = sessionStore.get(session.sessionId)!;
      return buildSessionSnapshot(refreshed, fallbackMessage);
    }

    try {
      latestActionMessage = await executeAction({ action, session, working });
    } catch (error) {
      const fallbackMessage = "I couldn't complete that change, so I kept your itinerary unchanged.";
      const errorLoopResult: LoopResult = {
        assistantMessage: fallbackMessage,
        confidence: loopResult.confidence,
        actions: [],
        stopReason: "tool_error_recovered",
      };
      sessionStore.update(session.sessionId, {
        activeLoop: "SUPERVISOR",
        lastTurnId: turnId,
        lastLoopResult: errorLoopResult,
        recoveryHints: appendRecoveryHint(
          session.recoveryHints,
          JSON.stringify({
            turnId,
            error: "tool_execution_failed",
            tool: action.tool,
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      });
      sessionStore.addToConversation(session.sessionId, "assistant", fallbackMessage);
      const refreshed = sessionStore.get(session.sessionId)!;
      return buildSessionSnapshot(refreshed, fallbackMessage);
    }
  }

  let nextWorkflowState = session.workflowState;
  const transitionHint = session.recoveryHints;
  if (loopResult.proposedTransition) {
    if (
      requiresTravelOfferCompletionForState(loopResult.proposedTransition) &&
      (working.accommodationStatus !== "complete" || working.flightStatus !== "complete")
    ) {
      transitionHint.push(
        JSON.stringify({
          turnId,
          error: "proposed_transition_blocked_waiting_for_travel_offer_search",
          to: loopResult.proposedTransition,
          accommodationStatus: working.accommodationStatus,
          flightStatus: working.flightStatus,
        }),
      );
    } else {
    const transitionCheck = validateWorkflowTransition({
      from: session.workflowState,
      to: loopResult.proposedTransition,
      owner: "SUPERVISOR",
    });
    if (transitionCheck.ok) {
      nextWorkflowState = loopResult.proposedTransition;
    } else {
      transitionHint.push(
        JSON.stringify({
          turnId,
          error: "proposed_transition_rejected",
          from: session.workflowState,
          to: loopResult.proposedTransition,
          reason: transitionCheck.reason,
        }),
      );
    }
    }
  }

  const assistantMessage = loopResult.assistantMessage || latestActionMessage || "I updated your itinerary.";
  const normalizedStopReason: StopReason =
    nextWorkflowState === WORKFLOW_STATES.FINALIZE ? "terminal" : loopResult.stopReason;
  const normalizedLoopResult: LoopResult = {
    ...loopResult,
    stopReason: normalizedStopReason,
  };

  sessionStore.update(session.sessionId, {
    selectedActivityIds: working.selectedActivityIds,
    dayGroups: working.dayGroups,
    groupedDays: working.groupedDays,
    restaurantSuggestions: working.restaurantSuggestions,
    selectedRestaurantIds: working.selectedRestaurantIds,
    wantsRestaurants: working.wantsRestaurants,
    accommodationStatus: working.accommodationStatus,
    flightStatus: working.flightStatus,
    accommodationError: working.accommodationError,
    flightError: working.flightError,
    accommodationOptions: working.accommodationOptions,
    flightOptions: working.flightOptions,
    selectedAccommodationOptionId: working.selectedAccommodationOptionId,
    selectedFlightOptionId: working.selectedFlightOptionId,
    wantsAccommodation: working.wantsAccommodation,
    wantsFlight: working.wantsFlight,
    accommodationLastSearchedAt: working.accommodationLastSearchedAt,
    flightLastSearchedAt: working.flightLastSearchedAt,
    workflowState: nextWorkflowState,
    activeLoop: "SUPERVISOR",
    lastTurnId: turnId,
    lastLoopResult: normalizedLoopResult,
    recoveryHints: appendRecoveryHint(transitionHint, JSON.stringify({ turnId, stopReason: normalizedStopReason })),
  });

  sessionStore.addToConversation(session.sessionId, "assistant", assistantMessage);
  const refreshed = sessionStore.get(session.sessionId)!;
  return buildSessionSnapshot(refreshed, assistantMessage);
}

async function runInfoGatheringTurn({
  session,
  request,
}: {
  session: Session;
  request: AgentTurnRequest;
}): Promise<TurnResponse> {
  if (request.trigger !== "user_message" || !request.message?.trim()) {
    const prompt = "Tell me where and when you want to travel so I can keep building your trip context.";
    sessionStore.addToConversation(session.sessionId, "assistant", prompt);
    const refreshed = sessionStore.get(session.sessionId)!;
    return buildSessionSnapshot(refreshed, prompt);
  }

  sessionStore.addToConversation(session.sessionId, "user", request.message);
  const turnId = randomUUID();
  const llmClient = getLLMClient();
  const result = await llmClient.gatherInfo({
    tripInfo: session.tripInfo,
    userMessage: request.message,
  });

  const oldDestination = session.tripInfo.destination;
  const newDestination = result.tripInfo?.destination;
  const destinationChanged =
    oldDestination &&
    newDestination &&
    oldDestination.toLowerCase() !== newDestination.toLowerCase();

  if (destinationChanged) {
    sessionStore.update(session.sessionId, {
      tripInfo: result.tripInfo!,
      tripResearchBrief: null,
      researchOptionSelections: {},
      suggestedActivities: [],
      selectedActivityIds: [],
      dayGroups: [],
      groupedDays: [],
      restaurantSuggestions: [],
      selectedRestaurantIds: [],
      accommodationStatus: "idle",
      flightStatus: "idle",
      accommodationError: null,
      flightError: null,
      accommodationOptions: [],
      flightOptions: [],
      selectedAccommodationOptionId: null,
      selectedFlightOptionId: null,
      wantsAccommodation: null,
      wantsFlight: null,
      accommodationLastSearchedAt: null,
      flightLastSearchedAt: null,
      finalPlan: null,
    });
  } else {
    sessionStore.update(session.sessionId, { tripInfo: result.tripInfo! });
  }

  const stopReason: StopReason = result.isComplete ? "completed_stage" : "needs_user_input";
  const loopResult: LoopResult = {
    assistantMessage: result.message,
    confidence: 0.9,
    actions: [],
    stopReason,
  };

  sessionStore.update(session.sessionId, {
    activeLoop: "SUPERVISOR",
    lastTurnId: turnId,
    lastLoopResult: loopResult,
    recoveryHints: appendRecoveryHint(
      session.recoveryHints,
      JSON.stringify({ turnId, phase: WORKFLOW_STATES.INFO_GATHERING, stopReason }),
    ),
  });
  sessionStore.addToConversation(session.sessionId, "assistant", result.message);
  const refreshed = sessionStore.get(session.sessionId)!;
  return buildSessionSnapshot(refreshed, result.message);
}

async function runInitialResearchTurn({
  session,
  request,
}: {
  session: Session;
  request: AgentTurnRequest;
}): Promise<TurnResponse> {
  if (request.trigger !== "user_message" || !request.message?.trim()) {
    const prompt = "Tell me which cards you want to add, remove, or refine.";
    sessionStore.addToConversation(session.sessionId, "assistant", prompt);
    const refreshed = sessionStore.get(session.sessionId)!;
    return buildSessionSnapshot(refreshed, prompt);
  }

  if (!session.tripResearchBrief) {
    const message = "Research brief not found. Generate it first.";
    sessionStore.addToConversation(session.sessionId, "assistant", message);
    const refreshed = sessionStore.get(session.sessionId)!;
    return buildSessionSnapshot(refreshed, message);
  }

  sessionStore.addToConversation(session.sessionId, "user", request.message);
  const turnId = randomUUID();
  const llmClient = getLLMClient();
  const refreshedSession = sessionStore.get(session.sessionId);
  const result = await llmClient.runInitialResearchDebriefAgent({
    tripInfo: session.tripInfo,
    currentBrief: session.tripResearchBrief,
    researchOptionSelections: session.researchOptionSelections || {},
    conversationHistory: refreshedSession?.conversationHistory || [],
    userMessage: request.message,
  });

  let assistantMessage = result.message;
  let stopReason: StopReason = "completed_stage";
  let confidence = result.success ? 0.85 : 0.5;

  if (!result.success) {
    const fallback = await llmClient.refineInitialResearchBrief({
      tripInfo: session.tripInfo,
      currentBrief: session.tripResearchBrief,
      userMessage: request.message,
    });

    if (!fallback.success || !fallback.tripResearchBrief) {
      assistantMessage =
        result.message || "I couldn't apply that change right now, but your current research cards are unchanged.";
      stopReason = "tool_error_recovered";
      confidence = 0.4;
    } else {
      const merged = mergeResearchBriefAndSelections({
        currentBrief: session.tripResearchBrief,
        currentSelections: session.researchOptionSelections || {},
        incomingBrief: fallback.tripResearchBrief,
      });

      sessionStore.update(session.sessionId, {
        tripResearchBrief: merged.tripResearchBrief,
        researchOptionSelections: merged.researchOptionSelections,
      });
      assistantMessage = fallback.message;
      stopReason = "completed_stage";
      confidence = 0.7;
    }
  } else {
    sessionStore.update(session.sessionId, {
      tripResearchBrief: result.tripResearchBrief,
      researchOptionSelections: result.researchOptionSelections,
    });
  }

  const loopResult: LoopResult = {
    assistantMessage,
    confidence,
    actions: [],
    stopReason,
  };

  sessionStore.update(session.sessionId, {
    activeLoop: "SUPERVISOR",
    lastTurnId: turnId,
    lastLoopResult: loopResult,
    recoveryHints: appendRecoveryHint(
      session.recoveryHints,
      JSON.stringify({ turnId, phase: WORKFLOW_STATES.INITIAL_RESEARCH, stopReason }),
    ),
  });
  sessionStore.addToConversation(session.sessionId, "assistant", assistantMessage);
  const refreshed = sessionStore.get(session.sessionId)!;
  return buildSessionSnapshot(refreshed, assistantMessage);
}

export async function runAgentTurn(rawRequest: unknown): Promise<TurnResponse> {
  const parsed = AgentTurnRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return {
      success: false,
      sessionId: "",
      workflowState: WORKFLOW_STATES.INFO_GATHERING,
      message: "Invalid request payload for agent turn.",
      tripInfo: {
        destination: null,
        startDate: null,
        endDate: null,
        durationDays: null,
        preferences: [],
        activityLevel: "moderate",
        travelers: 1,
        budget: null,
      },
      tripResearchBrief: null,
      researchOptionSelections: {},
      suggestedActivities: [],
      selectedActivityIds: [],
      dayGroups: [],
      groupedDays: [],
      restaurantSuggestions: [],
      selectedRestaurantIds: [],
      wantsRestaurants: null,
      accommodationStatus: "idle",
      flightStatus: "idle",
      accommodationError: null,
      flightError: null,
      accommodationOptions: [],
      flightOptions: [],
      selectedAccommodationOptionId: null,
      selectedFlightOptionId: null,
      wantsAccommodation: null,
      wantsFlight: null,
      accommodationLastSearchedAt: null,
      flightLastSearchedAt: null,
      activeLoop: "SUPERVISOR",
      loopResult: null,
    };
  }

  const request = parsed.data;
  const session = sessionStore.get(request.sessionId);
  if (!session) {
    return {
      success: false,
      sessionId: request.sessionId,
      workflowState: WORKFLOW_STATES.INFO_GATHERING,
      message: "Session not found or expired.",
      tripInfo: {
        destination: null,
        startDate: null,
        endDate: null,
        durationDays: null,
        preferences: [],
        activityLevel: "moderate",
        travelers: 1,
        budget: null,
      },
      tripResearchBrief: null,
      researchOptionSelections: {},
      suggestedActivities: [],
      selectedActivityIds: [],
      dayGroups: [],
      groupedDays: [],
      restaurantSuggestions: [],
      selectedRestaurantIds: [],
      wantsRestaurants: null,
      accommodationStatus: "idle",
      flightStatus: "idle",
      accommodationError: null,
      flightError: null,
      accommodationOptions: [],
      flightOptions: [],
      selectedAccommodationOptionId: null,
      selectedFlightOptionId: null,
      wantsAccommodation: null,
      wantsFlight: null,
      accommodationLastSearchedAt: null,
      flightLastSearchedAt: null,
      activeLoop: "SUPERVISOR",
      loopResult: null,
    };
  }

  if (session.workflowState === WORKFLOW_STATES.FINALIZE) {
    const terminalMessage = "This itinerary is already finalized. Start a new session for another trip.";
    const terminalResult: LoopResult = {
      assistantMessage: terminalMessage,
      confidence: 1,
      actions: [],
      stopReason: "terminal",
    };
    sessionStore.update(session.sessionId, {
      activeLoop: "SUPERVISOR",
      lastLoopResult: terminalResult,
      lastTurnId: randomUUID(),
    });
    sessionStore.addToConversation(session.sessionId, "assistant", terminalMessage);
    const refreshed = sessionStore.get(session.sessionId)!;
    return buildSessionSnapshot(refreshed, terminalMessage);
  }

  if (session.workflowState === WORKFLOW_STATES.INFO_GATHERING) {
    return runInfoGatheringTurn({ session, request });
  }

  if (session.workflowState === WORKFLOW_STATES.INITIAL_RESEARCH) {
    return runInitialResearchTurn({ session, request });
  }

  if (request.trigger === "user_message") {
    const userMessage = request.message?.trim();
    if (!userMessage) {
      return buildSessionSnapshot(session, "Message is required for user_message trigger.");
    }
    sessionStore.addToConversation(session.sessionId, "user", userMessage);
  }

  const decision = routeSupervisor(session.workflowState);
  if (!decision) {
    const unsupportedMessage = "I couldn't determine an agent loop for this state.";
    sessionStore.addToConversation(session.sessionId, "assistant", unsupportedMessage);
    const refreshed = sessionStore.get(session.sessionId)!;
    return buildSessionSnapshot(refreshed, unsupportedMessage);
  }

  sessionStore.update(session.sessionId, {
    activeLoop: decision.targetLoop,
  });
  const refreshed = sessionStore.get(session.sessionId)!;
  return runLoop({ session: refreshed, request, decision });
}
