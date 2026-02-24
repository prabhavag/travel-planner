// API client for frontend - uses Next.js API routes

const BASE_URL = "/api";

async function fetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Legacy endpoints
export async function generatePlan(data: unknown) {
  return fetchJson(`${BASE_URL}/generate-plan`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function modifyPlan(data: unknown) {
  return fetchJson(`${BASE_URL}/modify-plan`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Get frontend config (API keys, etc.)
export async function getConfig(): Promise<{ googleMapsApiKey?: string }> {
  try {
    return await fetchJson(`${BASE_URL}/config`);
  } catch {
    console.error("Config fetch error");
    return {};
  }
}

// ==================== SESSION-BASED WORKFLOW API ====================

export interface SessionResponse {
  success: boolean;
  sessionId: string;
  workflowState: string;
  message: string;
  activeLoop?: "SUPERVISOR" | "PLANNING_LOOP" | "HOSPITALITY_REVIEW_LOOP";
  loopResult?: LoopResult | null;
  lastTurnId?: string;
  recoveryHints?: string[];
  tripInfo?: TripInfo;
  skeleton?: Skeleton;
  expandedDays?: Record<number, ExpandedDay>;
  finalPlan?: FinalPlan;
  nextDayToExpand?: number;
  canReview?: boolean;
  suggestions?: ActivitySuggestions;
  mealSuggestions?: MealSuggestions;
  expandedDay?: ExpandedDay;
  allExpandedDays?: Record<number, ExpandedDay>;
  suggestModifications?: boolean;
  tripResearchBrief?: TripResearchBrief | null;
  researchOptionSelections?: Record<string, ResearchOptionPreference>;
  // New activity-first flow fields
  suggestedActivities?: SuggestedActivity[];
  selectedActivityIds?: string[];
  selectedCount?: number;
  dayGroups?: DayGroup[];
  groupedDays?: GroupedDay[];
  restaurantSuggestions?: RestaurantSuggestion[];
  selectedRestaurantIds?: string[];
  wantsRestaurants?: boolean;
  accommodationStatus?: SubAgentStatus;
  flightStatus?: SubAgentStatus;
  accommodationError?: string | null;
  flightError?: string | null;
  accommodationOptions?: AccommodationOption[];
  flightOptions?: FlightOption[];
  selectedAccommodationOptionId?: string | null;
  selectedFlightOptionId?: string | null;
  wantsAccommodation?: boolean | null;
  wantsFlight?: boolean | null;
  accommodationLastSearchedAt?: string | null;
  flightLastSearchedAt?: string | null;
  deepResearchedOptionIds?: string[];
}

export type AgentTurnTrigger = "user_message" | "ui_action" | "auto";

export interface AgentUiAction {
  type: string;
  payload?: Record<string, unknown>;
}

export type RemovableCardType = "research_option" | "restaurant" | "accommodation" | "flight";

export interface ToolAction {
  tool:
    | "select_activities"
    | "adjust_day_groups"
    | "confirm_day_grouping"
    | "get_restaurant_suggestions"
    | "set_meal_preferences"
    | "review_patch_grouped_days"
    | "finalize"
    | "select_accommodation"
    | "select_flight"
    | "skip_accommodation"
    | "skip_flight"
    | "search_accommodation"
    | "search_flights"
    | "refresh_accommodation_search"
    | "refresh_flight_search";
  input: Record<string, unknown>;
}

export interface LoopResult {
  assistantMessage: string;
  confidence: number;
  actions: ToolAction[];
  proposedTransition?: string;
  stopReason:
    | "completed_stage"
    | "needs_user_input"
    | "tool_error_recovered"
    | "low_confidence_noop"
    | "terminal";
}

export interface TripInfo {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  preferences: string[];
  activityLevel: string;
  travelers: number;
  budget: string | null;
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string | null;
}

export interface ResearchOption {
  id: string;
  title: string;
  category: "snorkeling" | "hiking" | "food" | "culture" | "relaxation" | "adventure" | "other";
  whyItMatches: string;
  bestForDates: string;
  reviewSummary: string;
  estimatedDuration?: string | null;
  sourceLinks: ResearchSource[];
  photoUrls?: string[];
  difficultyLevel?: "easy" | "moderate" | "hard";
  bestTimeOfDay?: "morning" | "afternoon" | "evening" | "any";
  timeReason?: string | null;
  timeSourceLinks?: ResearchSource[];
  locationMode?: "point" | "route" | "area";
  startCoordinates?: { lat: number; lng: number } | null;
  endCoordinates?: { lat: number; lng: number } | null;
  coordinates?: { lat: number; lng: number } | null;
  place_id?: string | null;
}

export type ResearchOptionPreference = "selected" | "keep" | "maybe" | "reject";

export interface TripResearchBrief {
  summary?: string;
  dateNotes?: string[];
  popularOptions: ResearchOption[];
  assumptions: string[];
  openQuestions: string[];
}

export interface SkeletonDay {
  dayNumber: number;
  date: string;
  theme: string;
  highlights: string[];
}

export interface Skeleton {
  days: SkeletonDay[];
}

export interface Activity {
  name: string;
  description?: string;
  time?: string;
  timeSlot?: string;
  duration?: string;
  cost?: number;
  rating?: number;
  type?: string;
  practical_tips?: string;
  coordinates?: { lat: number; lng: number };
}

export interface Meal {
  name: string;
  description?: string;
  timeSlot?: string;
  cuisine?: string;
  estimatedCost?: number;
  rating?: number;
  priceRange?: string;
  coordinates?: { lat: number; lng: number };
}

export interface ExpandedDay {
  dayNumber: number;
  date?: string;
  theme?: string;
  breakfast?: Meal;
  lunch?: Meal;
  dinner?: Meal;
  morning?: Activity[];
  afternoon?: Activity[];
  evening?: Activity[];
}

export interface FinalPlan {
  itinerary: Array<{
    day_number: number;
    dayNumber?: number;
    date: string;
    breakfast?: Meal;
    lunch?: Meal;
    dinner?: Meal;
    morning?: Activity[];
    afternoon?: Activity[];
    evening?: Activity[];
  }>;
}

export interface ActivityOption {
  id: string;
  name: string;
  description?: string;
  type?: string;
  estimatedDuration?: string;
  estimatedCost?: number;
  coordinates?: { lat: number; lng: number };
}

export interface MealOption {
  id: string;
  name: string;
  cuisine?: string;
  description?: string;
  priceRange?: string;
  rating?: number;
  coordinates?: { lat: number; lng: number };
}

export interface ActivitySuggestions {
  dayNumber: number;
  theme?: string;
  date?: string;
  morningActivities?: ActivityOption[];
  afternoonActivities?: ActivityOption[];
  eveningActivities?: ActivityOption[];
}

export interface MealSuggestions {
  dayNumber: number;
  breakfast?: MealOption[];
  lunch?: MealOption[];
  dinner?: MealOption[];
}

// Start a new planning session
export async function startSession(): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/start-session`, {
    method: "POST",
  });
}

// Chat with the assistant (INFO_GATHERING, INITIAL_RESEARCH, SUGGEST_ACTIVITIES, REVIEW)
export async function chat(sessionId: string, message: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/chat`, {
    method: "POST",
    body: JSON.stringify({ sessionId, message }),
  });
}

// Unified supervisor + sub-loop orchestration turn
export async function agentTurn(
  sessionId: string,
  trigger: AgentTurnTrigger,
  message?: string,
  uiAction?: AgentUiAction
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/agent-turn`, {
    method: "POST",
    body: JSON.stringify({ sessionId, trigger, message, uiAction }),
  });
}

// Generate skeleton itinerary (day themes)
export async function generateSkeleton(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/generate-skeleton`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

// Confirm user selections and create expanded day
export async function confirmDaySelections(
  sessionId: string,
  dayNumber: number,
  selections: Record<string, unknown>
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/confirm-day-selections`, {
    method: "POST",
    body: JSON.stringify({ sessionId, dayNumber, selections }),
  });
}

// Expand a specific day with activities
export async function expandDay(
  sessionId: string,
  dayNumber: number,
  userMessage = ""
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/expand-day`, {
    method: "POST",
    body: JSON.stringify({ sessionId, dayNumber, userMessage }),
  });
}

// Modify an already-expanded day
export async function modifyDay(
  sessionId: string,
  dayNumber: number,
  userMessage: string
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/modify-day`, {
    method: "POST",
    body: JSON.stringify({ sessionId, dayNumber, userMessage }),
  });
}

// Start review phase
export async function startReview(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/start-review`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

// Finalize the itinerary
export async function finalize(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/finalize`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

// Get session state
export async function getSession(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/session/${sessionId}`);
}

export type ResearchDepth = "fast" | "deep";
export type ResearchGenerationMode = "refresh" | "augment";

export async function generateResearchBrief(
  sessionId: string,
  depth: ResearchDepth = "fast",
  mode: ResearchGenerationMode = "refresh"
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/generate-research-brief`, {
    method: "POST",
    body: JSON.stringify({ sessionId, depth, mode }),
  });
}

export async function confirmResearchBrief(
  sessionId: string,
  data:
    | { selectedResearchOptionIds: string[] }
    | { researchOptionSelections: Record<string, ResearchOptionPreference> }
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/confirm-research-brief`, {
    method: "POST",
    body: JSON.stringify({ sessionId, ...data }),
  });
}

export async function deepResearchOption(
  sessionId: string,
  optionId: string
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/deep-research-option`, {
    method: "POST",
    body: JSON.stringify({ sessionId, optionId }),
  });
}

export async function deepResearchSelectedOptions(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/deep-research-selected`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export async function enrichResearchPhotos(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/enrich-research-photos`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export async function answerResearchQuestions(
  sessionId: string,
  answers: Record<string, string>
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/answer-research-questions`, {
    method: "POST",
    body: JSON.stringify({ sessionId, answers }),
  });
}

// ==================== NEW ACTIVITY-FIRST FLOW API ====================

export interface SuggestedActivity {
  id: string;
  name: string;
  type: string;
  interestTags?: string[];
  description: string;
  estimatedDuration: string;
  estimatedCost: number | null;
  currency?: string;
  difficultyLevel: "easy" | "moderate" | "hard";
  bestTimeOfDay: "morning" | "afternoon" | "evening" | "any";
  timeReason?: string | null;
  timeSourceLinks?: ResearchSource[];
  neighborhood?: string | null;
  locationMode?: "point" | "route" | "area";
  startCoordinates?: { lat: number; lng: number } | null;
  endCoordinates?: { lat: number; lng: number } | null;
  coordinates?: { lat: number; lng: number } | null;
  rating?: number | null;
  place_id?: string | null;
  opening_hours?: string | null;
  photo_url?: string | null;
  photo_urls?: string[];
  researchOption?: ResearchOption | null;
}

export interface DayGroup {
  dayNumber: number;
  date: string;
  theme: string;
  activityIds: string[];
}

export interface RestaurantSuggestion {
  id: string;
  name: string;
  cuisine: string | null;
  rating: number | null;
  user_ratings_total?: number | null;
  priceRange: string | null;
  coordinates: { lat: number; lng: number };
  place_id: string;
  vicinity: string | null;
  formatted_address?: string | null;
  opening_hours?: string | null;
  website?: string | null;
  editorial_summary?: string | null;
  photo_url?: string | null;
  photo_urls?: string[];
}

export interface GroupedDay {
  dayNumber: number;
  date: string;
  theme: string;
  activities: SuggestedActivity[];
  restaurants: RestaurantSuggestion[];
}

export type SubAgentStatus = "idle" | "running" | "complete" | "error";

export interface AccommodationOption {
  id: string;
  name: string;
  neighborhood: string | null;
  nightlyPriceEstimate: number | null;
  currency: string;
  rating: number | null;
  sourceUrl: string | null;
  summary: string;
  pros: string[];
  cons: string[];
}

export interface FlightOption {
  id: string;
  airline: string;
  routeSummary: string;
  departureWindow: string | null;
  arrivalWindow: string | null;
  duration: string | null;
  stops: number | null;
  totalPriceEstimate: number | null;
  currency: string;
  sourceUrl: string | null;
  summary: string;
  baggageNotes: string | null;
}

// Select activities from the top 15
export async function selectActivities(
  sessionId: string,
  selectedActivityIds: string[]
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/select-activities`, {
    method: "POST",
    body: JSON.stringify({ sessionId, selectedActivityIds }),
  });
}

// Adjust day groupings (move activity between days)
export async function adjustDayGroups(
  sessionId: string,
  activityId: string,
  fromDay: number,
  toDay: number
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/adjust-day-groups`, {
    method: "POST",
    body: JSON.stringify({ sessionId, activityId, fromDay, toDay }),
  });
}

// Confirm day groupings
export async function confirmDayGrouping(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/confirm-day-grouping`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

// Get restaurant suggestions near activities
export async function getRestaurantSuggestions(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/get-restaurant-suggestions`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

// Set meal preferences (add or skip restaurants)
export async function setMealPreferences(
  sessionId: string,
  wantsRestaurants: boolean,
  selectedRestaurantIds?: string[]
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/meal-preferences`, {
    method: "POST",
    body: JSON.stringify({ sessionId, wantsRestaurants, selectedRestaurantIds }),
  });
}

// Update trip information (e.g. constraints)
export async function updateTripInfo(
  sessionId: string,
  tripInfo: Partial<TripInfo>
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/session/${sessionId}/update-trip-info`, {
    method: "POST",
    body: JSON.stringify({ tripInfo }),
  });
}

// Update workflow state manually (e.g. for navigation)
export async function updateWorkflowState(
  sessionId: string,
  workflowState: string,
  options?: { transitionOwner?: "UI" | "SUPERVISOR" }
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/session/${sessionId}/update-state`, {
    method: "POST",
    body: JSON.stringify({ workflowState, transitionOwner: options?.transitionOwner ?? "UI" }),
  });
}

export async function removeCard(
  sessionId: string,
  cardType: RemovableCardType,
  cardId: string
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/remove-card`, {
    method: "POST",
    body: JSON.stringify({ sessionId, cardType, cardId }),
  });
}
