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
}

export interface TripInfo {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  interests: string[];
  activityLevel: string;
  travelers: number;
  budget: string | null;
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

// Chat with the assistant (INFO_GATHERING and REVIEW states)
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
