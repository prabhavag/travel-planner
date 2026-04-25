import { randomUUID } from "crypto";
import type {
  AccommodationOption,
  FlightOption,
  SubAgentStatus,
  TripInfo,
  TravelPlan,
  SuggestedActivity,
  DayGroup,
  GroupedDay,
  RestaurantSuggestion,
  TripResearchBrief,
  ResearchOptionPreference,
  LoopId,
  LoopResult,
} from "@/lib/models/travel-plan";
import type { ActivityGroupingStrategy } from "@/lib/services/day-grouping/types";
import type { ActivityCostDebug } from "@/lib/services/day-grouping/scoring";
import type { ScheduleState } from "@/lib/services/day-grouping";
import type { LlmRefinementResult } from "@/lib/services/day-grouping-refinement";

const DEFAULT_SESSION_TTL_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

function resolveSessionTtlMs(): number {
  const configuredHours = Number(process.env.SESSION_TTL_HOURS);
  const ttlHours = Number.isFinite(configuredHours) && configuredHours > 0
    ? configuredHours
    : DEFAULT_SESSION_TTL_HOURS;
  return ttlHours * HOUR_MS;
}

export const WORKFLOW_STATES = {
  INFO_GATHERING: "INFO_GATHERING",
  INITIAL_RESEARCH: "INITIAL_RESEARCH",
  SUGGEST_ACTIVITIES: "SUGGEST_ACTIVITIES",
  SELECT_ACTIVITIES: "SELECT_ACTIVITIES",
  GROUP_DAYS: "GROUP_DAYS",
  DAY_ITINERARY: "DAY_ITINERARY",
  MEAL_PREFERENCES: "MEAL_PREFERENCES",
  REVIEW: "REVIEW",
  FINALIZE: "FINALIZE",
} as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[keyof typeof WORKFLOW_STATES];

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCheckResult {
  status: "OK" | "ERROR";
  summary: string;
  checkedAt: string;
}

export interface GroupingSnapshot {
  selectedActivityIds: string[];
  dayGroups: DayGroup[];
  groupedDays: GroupedDay[];
  unassignedActivityIds: string[];
  updatedAt: string;
}

export interface LlmRefinementPreviewSnapshot {
  hasCandidate: boolean;
  recommendedByCost: boolean;
  beforeGroupedDays: GroupedDay[];
  afterGroupedDays: GroupedDay[] | null;
  beforeUnassignedActivityIds: string[];
  afterUnassignedActivityIds: string[] | null;
  candidateDayGroups: DayGroup[] | null;
  candidateUnassignedActivityIds: string[] | null;
  currentSchedule?: ScheduleState;
  tentativeSchedule?: ScheduleState | null;
}

export interface Session {
  sessionId: string;
  createdAt: number;
  lastAccessed: number;
  workflowState: WorkflowState;
  activeLoop: LoopId;
  lastTurnId: string;
  lastLoopResult: LoopResult | null;
  recoveryHints: string[];
  tripInfo: TripInfo;
  conversationHistory: ConversationMessage[];
  finalPlan: TravelPlan | null;
  tripResearchBrief: TripResearchBrief | null;
  researchOptionSelections: Record<string, ResearchOptionPreference>;

  // Activity-first flow fields
  suggestedActivities: SuggestedActivity[];
  selectedActivityIds: string[];
  currentSchedule: ScheduleState;
  tentativeSchedule: ScheduleState | null;
  dayGroups: DayGroup[];
  groupedDays: GroupedDay[];
  activityCostDebugById: Record<string, ActivityCostDebug>;
  activityGroupingStrategy: ActivityGroupingStrategy;
  unassignedActivityIds: string[];
  llmRefinementResult: LlmRefinementResult | null;
  llmRefinementPreview: LlmRefinementPreviewSnapshot | null;
  groupingSnapshots: Record<ActivityGroupingStrategy, GroupingSnapshot | null>;
  restaurantSuggestions: RestaurantSuggestion[];
  selectedRestaurantIds: string[];
  wantsRestaurants: boolean | null;
  accommodationStatus: SubAgentStatus;
  flightStatus: SubAgentStatus;
  accommodationError: string | null;
  flightError: string | null;
  accommodationOptions: AccommodationOption[];
  flightOptions: FlightOption[];
  selectedAccommodationOptionId: string | null;
  selectedFlightOptionId: string | null;
  wantsAccommodation: boolean | null;
  wantsFlight: boolean | null;
  accommodationLastSearchedAt: string | null;
  flightLastSearchedAt: string | null;
  aiCheckResult: AiCheckResult | null;
}

class SessionStore {
  private sessions = new Map<string, Session>();
  private SESSION_TTL = resolveSessionTtlMs();
  private CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.startCleanupInterval();
  }

  create(): Session {
    const sessionId = randomUUID();
    const now = Date.now();

    const session: Session = {
      sessionId,
      createdAt: now,
      lastAccessed: now,
      workflowState: WORKFLOW_STATES.INFO_GATHERING,
      activeLoop: "SUPERVISOR",
      lastTurnId: randomUUID(),
      lastLoopResult: null,
      recoveryHints: [],
      tripInfo: {
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
      },
      conversationHistory: [],
      finalPlan: null,
      tripResearchBrief: null,
      researchOptionSelections: {},

      // Activity-first flow fields
      suggestedActivities: [],
      selectedActivityIds: [],
      currentSchedule: {
        dayGroups: [],
        groupedDays: [],
        unassignedActivityIds: [],
        activityCostDebugById: {},
      },
      tentativeSchedule: null,
      dayGroups: [],
      groupedDays: [],
      activityCostDebugById: {},
      activityGroupingStrategy: "heuristic",
      unassignedActivityIds: [],
      llmRefinementResult: null,
      llmRefinementPreview: null,
      groupingSnapshots: {
        heuristic: null,
        llm: null,
      },
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
      aiCheckResult: null,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Check if session has expired
    if (Date.now() - session.lastAccessed > this.SESSION_TTL) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Update last accessed time
    session.lastAccessed = Date.now();
    const derivedDurationDays = this.deriveDurationDaysFromDates(session.tripInfo.startDate, session.tripInfo.endDate);
    if (derivedDurationDays !== null) {
      session.tripInfo.durationDays = derivedDurationDays;
    }
    return session;
  }

  update(sessionId: string, updates: Partial<Session>): Session | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }

    // Deep merge for nested objects
    if (updates.tripInfo) {
      const mergedTripInfo = { ...session.tripInfo, ...updates.tripInfo };
      const derivedDurationDays = this.deriveDurationDaysFromDates(mergedTripInfo.startDate, mergedTripInfo.endDate);
      if (derivedDurationDays !== null) {
        mergedTripInfo.durationDays = derivedDurationDays;
      }
      session.tripInfo = mergedTripInfo;
      delete updates.tripInfo;
    }

    // Merge remaining updates
    Object.assign(session, updates);
    session.lastAccessed = Date.now();

    return session;
  }

  private deriveDurationDaysFromDates(startDate: string | null, endDate: string | null): number | null {
    if (!startDate || !endDate) return null;

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (days <= 0) return null;
    return days;
  }

  addToConversation(sessionId: string, role: "user" | "assistant", content: string): Session | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }

    session.conversationHistory.push({ role, content });
    session.lastAccessed = Date.now();
    return session;
  }

  // Activity-first flow helpers
  setSuggestedActivities(sessionId: string, activities: SuggestedActivity[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.suggestedActivities = activities;
    session.lastAccessed = Date.now();
    return session;
  }

  setTripResearchBrief(sessionId: string, tripResearchBrief: TripResearchBrief | null): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.tripResearchBrief = tripResearchBrief;
    session.lastAccessed = Date.now();
    return session;
  }

  setResearchOptionSelections(
    sessionId: string,
    researchOptionSelections: Record<string, ResearchOptionPreference>
  ): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.researchOptionSelections = { ...researchOptionSelections };
    session.lastAccessed = Date.now();
    return session;
  }

  setSelectedActivities(sessionId: string, activityIds: string[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.selectedActivityIds = activityIds;
    session.lastAccessed = Date.now();
    return session;
  }

  setDayGroups(sessionId: string, dayGroups: DayGroup[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.dayGroups = dayGroups;
    session.lastAccessed = Date.now();
    return session;
  }

  setGroupedDays(sessionId: string, groupedDays: GroupedDay[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.groupedDays = groupedDays;
    session.lastAccessed = Date.now();
    return session;
  }

  updateDayGroup(sessionId: string, dayNumber: number, activityIds: string[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    const dayGroup = session.dayGroups.find((d) => d.dayNumber === dayNumber);
    if (dayGroup) {
      dayGroup.activityIds = activityIds;
    }
    session.lastAccessed = Date.now();
    return session;
  }

  setRestaurantSuggestions(sessionId: string, restaurants: RestaurantSuggestion[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.restaurantSuggestions = restaurants;
    session.lastAccessed = Date.now();
    return session;
  }

  setSelectedRestaurants(sessionId: string, restaurantIds: string[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.selectedRestaurantIds = restaurantIds;
    session.lastAccessed = Date.now();
    return session;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private startCleanupInterval(): void {
    // Only start cleanup in server environment
    if (typeof setInterval !== "undefined") {
      setInterval(() => {
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
          if (now - session.lastAccessed > this.SESSION_TTL) {
            this.sessions.delete(sessionId);
          }
        }
      }, this.CLEANUP_INTERVAL);
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}

// Declare global type for TypeScript
declare global {
  // eslint-disable-next-line no-var
  var sessionStoreInstance: SessionStore | undefined;
}

// Use globalThis to persist across HMR in development
export const sessionStore = globalThis.sessionStoreInstance ?? new SessionStore();

// Assign to global in development to survive HMR
if (process.env.NODE_ENV !== "production") {
  globalThis.sessionStoreInstance = sessionStore;
}
