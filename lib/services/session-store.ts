import { randomUUID } from "crypto";
import type {
  TripInfo,
  SkeletonItinerary,
  ExpandedDay,
  TravelPlan,
  StoredSuggestions,
  StoredActivitySuggestions,
  StoredMealSuggestions,
  SuggestedActivity,
  DayGroup,
  GroupedDay,
  RestaurantSuggestion,
} from "@/lib/models/travel-plan";

export const WORKFLOW_STATES = {
  INFO_GATHERING: "INFO_GATHERING",
  SUGGEST_ACTIVITIES: "SUGGEST_ACTIVITIES",
  SELECT_ACTIVITIES: "SELECT_ACTIVITIES",
  GROUP_DAYS: "GROUP_DAYS",
  DAY_ITINERARY: "DAY_ITINERARY",
  MEAL_PREFERENCES: "MEAL_PREFERENCES",
  REVIEW: "REVIEW",
  FINALIZE: "FINALIZE",
  // Legacy states (kept for backwards compatibility during migration)
  SKELETON: "SKELETON",
  EXPAND_DAY: "EXPAND_DAY",
} as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[keyof typeof WORKFLOW_STATES];

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  sessionId: string;
  createdAt: number;
  lastAccessed: number;
  workflowState: WorkflowState;
  tripInfo: TripInfo;
  conversationHistory: ConversationMessage[];
  finalPlan: TravelPlan | null;

  // New activity-first flow fields
  suggestedActivities: SuggestedActivity[];
  selectedActivityIds: string[];
  dayGroups: DayGroup[];
  groupedDays: GroupedDay[];
  restaurantSuggestions: RestaurantSuggestion[];
  selectedRestaurantIds: string[];
  wantsRestaurants: boolean | null;

  // Legacy fields (kept for backwards compatibility during migration)
  skeleton: SkeletonItinerary | null;
  expandedDays: Record<number, ExpandedDay>;
  currentExpandDay: number | null;
  currentSuggestions: StoredSuggestions | null;
  currentActivitySuggestions: StoredActivitySuggestions | null;
  currentMealSuggestions: StoredMealSuggestions | null;
}

class SessionStore {
  private sessions = new Map<string, Session>();
  private SESSION_TTL = 30 * 60 * 1000; // 30 minutes
  private CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

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
      tripInfo: {
        destination: null,
        startDate: null,
        endDate: null,
        durationDays: null,
        interests: [],
        activityLevel: "moderate",
        travelers: 1,
        budget: null,
        constraints: [],
      },
      conversationHistory: [],
      finalPlan: null,

      // New activity-first flow fields
      suggestedActivities: [],
      selectedActivityIds: [],
      dayGroups: [],
      groupedDays: [],
      restaurantSuggestions: [],
      selectedRestaurantIds: [],
      wantsRestaurants: null,

      // Legacy fields
      skeleton: null,
      expandedDays: {},
      currentExpandDay: null,
      currentSuggestions: null,
      currentActivitySuggestions: null,
      currentMealSuggestions: null,
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
    return session;
  }

  update(sessionId: string, updates: Partial<Session>): Session | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }

    // Deep merge for nested objects
    if (updates.tripInfo) {
      session.tripInfo = { ...session.tripInfo, ...updates.tripInfo };
      delete updates.tripInfo;
    }

    // Merge remaining updates
    Object.assign(session, updates);
    session.lastAccessed = Date.now();

    return session;
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

  setExpandedDay(sessionId: string, dayNumber: number, dayData: ExpandedDay): Session | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }

    session.expandedDays[dayNumber] = dayData;
    session.lastAccessed = Date.now();
    return session;
  }

  // New activity-first flow helpers
  setSuggestedActivities(sessionId: string, activities: SuggestedActivity[]): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.suggestedActivities = activities;
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
      this.cleanupTimer = setInterval(() => {
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

// Export singleton instance
export const sessionStore = new SessionStore();
