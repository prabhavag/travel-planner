import { z } from "zod";

// Workflow state enum
export const WorkflowStateSchema = z.enum([
  "INFO_GATHERING",
  "INITIAL_RESEARCH",
  "SUGGEST_ACTIVITIES",
  "SELECT_ACTIVITIES",
  "GROUP_DAYS",
  "DAY_ITINERARY",
  "MEAL_PREFERENCES",
  "REVIEW",
  "FINALIZE",
]);

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

// Trip info collected during INFO_GATHERING
export const TripInfoSchema = z.object({
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  durationDays: z.number().nullable(),
  preferences: z.array(z.string()).default([]),
  activityLevel: z.string().default("moderate"),
  travelers: z.number().default(1),
  budget: z.string().nullable(),
});

export type TripInfo = z.infer<typeof TripInfoSchema>;

// Coordinates schema
export const CoordinatesSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export type Coordinates = z.infer<typeof CoordinatesSchema>;

// Meal schema for restaurants
export const MealSchema = z.object({
  name: z.string(),
  type: z.enum(["breakfast", "lunch", "dinner"]),
  cuisine: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  estimatedCost: z.number().optional().nullable(),
  timeSlot: z.string().optional().nullable(),
  rating: z.number().optional().nullable(),
  place_id: z.string().optional().nullable(),
  coordinates: CoordinatesSchema.optional().nullable(),
});

export type Meal = z.infer<typeof MealSchema>;

// Suggestion option for activity
export const ActivityOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  estimatedDuration: z.string().optional().nullable(),
  estimatedCost: z.number().optional().nullable(),
  coordinates: CoordinatesSchema.optional().nullable(),
});

export type ActivityOption = z.infer<typeof ActivityOptionSchema>;

// Suggestion option for meal/restaurant
export const MealOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  cuisine: z.string(),
  description: z.string(),
  priceRange: z.string().optional().nullable(),
  estimatedCost: z.number().optional().nullable(),
});

export type MealOption = z.infer<typeof MealOptionSchema>;

// Day suggestions with multiple options per slot
export const DaySuggestionsSchema = z.object({
  dayNumber: z.number(),
  date: z.string(),
  theme: z.string(),
  breakfast: z.array(MealOptionSchema).default([]),
  morningActivities: z.array(ActivityOptionSchema).default([]),
  lunch: z.array(MealOptionSchema).default([]),
  afternoonActivities: z.array(ActivityOptionSchema).default([]),
  dinner: z.array(MealOptionSchema).default([]),
  eveningActivities: z.array(ActivityOptionSchema).default([]),
});

export type DaySuggestions = z.infer<typeof DaySuggestionsSchema>;

// Activity-only suggestions (no meals) - for two-step flow
export const ActivitySuggestionsSchema = z.object({
  dayNumber: z.number(),
  date: z.string(),
  theme: z.string(),
  morningActivities: z.array(ActivityOptionSchema).default([]),
  afternoonActivities: z.array(ActivityOptionSchema).default([]),
  eveningActivities: z.array(ActivityOptionSchema).default([]),
});

export type ActivitySuggestions = z.infer<typeof ActivitySuggestionsSchema>;

// Meal option from Google Places API nearby search
export const MealFromPlacesSchema = z.object({
  id: z.string(),
  name: z.string(),
  cuisine: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  rating: z.number().optional().nullable(),
  priceRange: z.string().optional().nullable(),
  coordinates: CoordinatesSchema,
  place_id: z.string(),
});

export type MealFromPlaces = z.infer<typeof MealFromPlacesSchema>;

// Meal suggestions from Places API for a day
export const MealSuggestionsFromPlacesSchema = z.object({
  dayNumber: z.number(),
  breakfast: z.array(MealFromPlacesSchema).default([]),
  lunch: z.array(MealFromPlacesSchema).default([]),
  dinner: z.array(MealFromPlacesSchema).default([]),
});

export type MealSuggestionsFromPlaces = z.infer<typeof MealSuggestionsFromPlacesSchema>;

// User selections from suggestions
export const DaySelectionsSchema = z.object({
  dayNumber: z.number(),
  breakfast: z.string().nullable(),
  morningActivities: z.array(z.string()).default([]),
  lunch: z.string().nullable(),
  afternoonActivities: z.array(z.string()).default([]),
  dinner: z.string().nullable(),
  eveningActivities: z.array(z.string()).default([]),
  customRequests: z.string().optional().nullable(),
});

export type DaySelections = z.infer<typeof DaySelectionsSchema>;

// Original activity schema (kept for compatibility)
export const ActivitySchema = z.object({
  name: z.string(),
  type: z.string(),
  time: z.string(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  duration: z.string().optional().nullable(),
  cost: z.number().optional().nullable(),
  currency: z.string().default("USD"),
  notes: z.string().optional().nullable(),
  rating: z.number().optional().nullable(),
  user_ratings_total: z.number().optional().nullable(),
  place_id: z.string().optional().nullable(),
  coordinates: CoordinatesSchema.optional().nullable(),
});

export type Activity = z.infer<typeof ActivitySchema>;

export const DayItinerarySchema = z.object({
  date: z.string(),
  day_number: z.number(),
  morning: z.array(ActivitySchema),
  afternoon: z.array(ActivitySchema),
  evening: z.array(ActivitySchema),
  notes: z.string().optional().nullable(),
  // Include meals for final itinerary
  breakfast: MealSchema.optional().nullable(),
  lunch: MealSchema.optional().nullable(),
  dinner: MealSchema.optional().nullable(),
});

export type DayItinerary = z.infer<typeof DayItinerarySchema>;

export const CostBreakdownSchema = z.object({
  activities: z.number(),
  food: z.number(),
  local_transport: z.number(),
  total: z.number(),
  currency: z.string().default("USD"),
  per_person: z.number().optional().nullable(),
});

export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;

export const TravelPlanSchema = z.object({
  plan_type: z.string(),
  destination: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  duration_days: z.number().optional().nullable(),
  itinerary: z.array(DayItinerarySchema).optional().default([]),
  cost_breakdown: CostBreakdownSchema.optional().nullable(),
  summary: z.string().optional().nullable(),
  highlights: z.array(z.string()).optional().nullable(),
  tips: z.array(z.string()).optional().nullable(),
});

export type TravelPlan = z.infer<typeof TravelPlanSchema>;

export const TravelRequestSchema = z.object({
  destination: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  interest_categories: z.array(z.string()).default([]),
  activity_level: z.string().default("moderate"),
});

export type TravelRequest = z.infer<typeof TravelRequestSchema>;

// ============================================
// Activity-First Planning Schemas
// ============================================

export const ResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional().nullable(),
});

export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const ResearchOptionPreferenceSchema = z.enum(["keep", "maybe", "reject"]);
export type ResearchOptionPreference = z.infer<typeof ResearchOptionPreferenceSchema>;

export const ResearchOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(["snorkeling", "hiking", "food", "culture", "relaxation", "adventure", "other"]),
  whyItMatches: z.string(),
  bestForDates: z.string(),
  reviewSummary: z.string(),
  sourceLinks: z.array(ResearchSourceSchema).default([]),
  photoUrls: z.array(z.string()).max(3).default([]),
});

export type ResearchOption = z.infer<typeof ResearchOptionSchema>;

export const TripResearchBriefSchema = z.object({
  summary: z.string(),
  dateNotes: z.array(z.string()).default([]),
  popularOptions: z.array(ResearchOptionSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export type TripResearchBrief = z.infer<typeof TripResearchBriefSchema>;

// Suggested activity from LLM (top 15)
export const SuggestedActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(), // museum, landmark, park, viewpoint, market, experience, neighborhood
  interestTags: z.array(z.string()).max(3).default([]), // user-interest aligned tags
  description: z.string(),
  estimatedDuration: z.string(), // "2-3 hours"
  estimatedCost: z.number().nullable(),
  currency: z.string().default("USD"), // Currency code (e.g., "USD", "EUR", "JPY")
  bestTimeOfDay: z.enum(["morning", "afternoon", "evening", "any"]),
  neighborhood: z.string().nullable().optional(),
  // Enriched from Places API:
  coordinates: CoordinatesSchema.nullable().optional(),
  rating: z.number().nullable().optional(),
  place_id: z.string().nullable().optional(),
  opening_hours: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  photo_urls: z.array(z.string()).max(3).optional(),
});

export type SuggestedActivity = z.infer<typeof SuggestedActivitySchema>;

// Day grouping from LLM
export const DayGroupSchema = z.object({
  dayNumber: z.number(),
  date: z.string(),
  theme: z.string(), // Auto-generated theme based on grouped activities
  activityIds: z.array(z.string()), // References to SuggestedActivity.id
});

export type DayGroup = z.infer<typeof DayGroupSchema>;

// Restaurant suggestion from Places API
export const RestaurantSuggestionSchema = z.object({
  id: z.string(),
  name: z.string(),
  cuisine: z.string().nullable(),
  rating: z.number().nullable(),
  priceRange: z.string().nullable(),
  coordinates: CoordinatesSchema,
  place_id: z.string(),
  vicinity: z.string().nullable(),
  photo_url: z.string().nullable().optional(),
});

export type RestaurantSuggestion = z.infer<typeof RestaurantSuggestionSchema>;

// Grouped day with activities and optional restaurants
export const GroupedDaySchema = z.object({
  dayNumber: z.number(),
  date: z.string(),
  theme: z.string(),
  activities: z.array(SuggestedActivitySchema),
  restaurants: z.array(RestaurantSuggestionSchema).default([]),
});

export type GroupedDay = z.infer<typeof GroupedDaySchema>;
