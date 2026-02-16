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
  tripInfo?: TripInfo;
  skeleton?: Skeleton;
  expandedDays?: Record<number, ExpandedDay>;
  canProceed?: boolean;
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
  sourceLinks: ResearchSource[];
  photoUrls?: string[];
}

export type ResearchOptionPreference = "keep" | "maybe" | "reject";

export interface TripResearchBrief {
  summary: string;
  dateNotes: string[];
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

// ==================== TWO-STEP EXPAND DAY FLOW ====================

// Suggest activities only (no meals) - Step 1
export async function suggestActivities(
  sessionId: string,
  dayNumber: number,
  userMessage = ""
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/suggest-activities`, {
    method: "POST",
    body: JSON.stringify({ sessionId, dayNumber, userMessage }),
  });
}

// Suggest meals nearby selected activities - Step 2
export async function suggestMealsNearby(
  sessionId: string,
  dayNumber: number,
  selectedActivities: Record<string, string[]>
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/suggest-meals-nearby`, {
    method: "POST",
    body: JSON.stringify({ sessionId, dayNumber, selectedActivities }),
  });
}

export async function generateResearchBrief(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/generate-research-brief`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export async function confirmResearchBrief(
  sessionId: string,
  researchOptionSelections: Record<string, ResearchOptionPreference>
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/confirm-research-brief`, {
    method: "POST",
    body: JSON.stringify({ sessionId, researchOptionSelections }),
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
  bestTimeOfDay: "morning" | "afternoon" | "evening" | "any";
  neighborhood?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  rating?: number | null;
  place_id?: string | null;
  opening_hours?: string | null;
  photo_url?: string | null;
  photo_urls?: string[];
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
  priceRange: string | null;
  coordinates: { lat: number; lng: number };
  place_id: string;
  vicinity: string | null;
  photo_url?: string | null;
}

export interface GroupedDay {
  dayNumber: number;
  date: string;
  theme: string;
  activities: SuggestedActivity[];
  restaurants: RestaurantSuggestion[];
}

// Suggest top 10 activities for the entire trip (streaming)
export async function suggestTopActivities(
  sessionId: string,
  onActivity: (activity: SuggestedActivity) => void,
  onComplete: (message: string) => void,
  onError?: (error: string) => void,
  onEnrichment?: (activity: SuggestedActivity) => void
): Promise<void> {
  const response = await fetch(`${BASE_URL}/suggest-activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    if (onError) onError(error.message || `HTTP ${response.status}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    if (onError) onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string) => {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "activity") {
          onActivity(data.activity);
        } else if (data.type === "enrichment") {
          if (onEnrichment) onEnrichment(data.activity);
        } else if (data.type === "complete") {
          onComplete(data.message);
        } else if (data.type === "error") {
          if (onError) onError(data.message);
        }
        // "start" event is intentionally ignored - it's just for signaling
      } catch (parseError) {
        console.warn("Failed to parse SSE data:", line, parseError);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      processLine(line);
    }
  }

  // Process any remaining content in buffer
  if (buffer.trim()) {
    processLine(buffer);
  }
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

// Group selected activities into days
export async function groupDays(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/group-days`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
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
  workflowState: string
): Promise<SessionResponse> {
  return fetchJson(`${BASE_URL}/session/${sessionId}/update-state`, {
    method: "POST",
    body: JSON.stringify({ workflowState }),
  });
}
