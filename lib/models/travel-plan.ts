import { z } from "zod";

// Workflow state enum
export const WorkflowStateSchema = z.enum([
  "INFO_GATHERING",
  "SKELETON",
  "EXPAND_DAY",
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
  interests: z.array(z.string()).default([]),
  activityLevel: z.string().default("moderate"),
  travelers: z.number().default(1),
  budget: z.string().nullable(),
});

export type TripInfo = z.infer<typeof TripInfoSchema>;

// Skeleton day (day themes only, no activities)
export const SkeletonDaySchema = z.object({
  dayNumber: z.number(),
  date: z.string(),
  theme: z.string(),
  highlights: z.array(z.string()),
});

export type SkeletonDay = z.infer<typeof SkeletonDaySchema>;

export const SkeletonItinerarySchema = z.object({
  days: z.array(SkeletonDaySchema),
});

export type SkeletonItinerary = z.infer<typeof SkeletonItinerarySchema>;

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

// Expanded day with full activities and meals
export const ExpandedDaySchema = z.object({
  dayNumber: z.number(),
  date: z.string(),
  theme: z.string(),
  breakfast: MealSchema.nullable().optional(),
  morning: z.array(ActivitySchema).default([]),
  lunch: MealSchema.nullable().optional(),
  afternoon: z.array(ActivitySchema).default([]),
  dinner: MealSchema.nullable().optional(),
  evening: z.array(ActivitySchema).default([]),
  notes: z.string().optional().nullable(),
});

export type ExpandedDay = z.infer<typeof ExpandedDaySchema>;

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

// Stored suggestions with dayNumber for session storage
export interface StoredSuggestions {
  dayNumber: number;
  suggestions: DaySuggestions;
}

// Stored activity suggestions (for two-step flow)
export interface StoredActivitySuggestions {
  dayNumber: number;
  suggestions: ActivitySuggestions;
}

// Stored meal suggestions from Places API
export interface StoredMealSuggestions {
  dayNumber: number;
  suggestions: MealSuggestionsFromPlaces;
}
