const { z } = require('zod');

// Workflow state enum
const WorkflowStateSchema = z.enum([
    'INFO_GATHERING',
    'SKELETON',
    'EXPAND_DAY',
    'REVIEW',
    'FINALIZE'
]);

// Trip info collected during INFO_GATHERING
const TripInfoSchema = z.object({
    destination: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    durationDays: z.number().nullable(),
    interests: z.array(z.string()).default([]),
    activityLevel: z.string().default('moderate'),
    travelers: z.number().default(1),
    budget: z.string().nullable()
});

// Skeleton day (day themes only, no activities)
const SkeletonDaySchema = z.object({
    dayNumber: z.number(),
    date: z.string(),
    theme: z.string(),
    highlights: z.array(z.string())
});

const SkeletonItinerarySchema = z.object({
    days: z.array(SkeletonDaySchema)
});

// Meal schema for restaurants
const MealSchema = z.object({
    name: z.string(),
    type: z.enum(['breakfast', 'lunch', 'dinner']),
    cuisine: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    estimatedCost: z.number().optional().nullable(),
    timeSlot: z.string().optional().nullable(),
    // Fields added during finalization
    rating: z.number().optional().nullable(),
    place_id: z.string().optional().nullable(),
    coordinates: z.object({
        lat: z.number(),
        lng: z.number()
    }).optional().nullable()
});

// Suggestion option for activity
const ActivityOptionSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    description: z.string(),
    estimatedDuration: z.string().optional().nullable(),
    estimatedCost: z.number().optional().nullable()
});

// Suggestion option for meal/restaurant
const MealOptionSchema = z.object({
    id: z.string(),
    name: z.string(),
    cuisine: z.string(),
    description: z.string(),
    priceRange: z.string().optional().nullable(), // $, $$, $$$
    estimatedCost: z.number().optional().nullable()
});

// Day suggestions with multiple options per slot
const DaySuggestionsSchema = z.object({
    dayNumber: z.number(),
    date: z.string(),
    theme: z.string(),
    breakfast: z.array(MealOptionSchema).default([]),
    morningActivities: z.array(ActivityOptionSchema).default([]),
    lunch: z.array(MealOptionSchema).default([]),
    afternoonActivities: z.array(ActivityOptionSchema).default([]),
    dinner: z.array(MealOptionSchema).default([]),
    eveningActivities: z.array(ActivityOptionSchema).default([])
});

// Activity-only suggestions (no meals) - for two-step flow
const ActivitySuggestionsSchema = z.object({
    dayNumber: z.number(),
    date: z.string(),
    theme: z.string(),
    morningActivities: z.array(ActivityOptionSchema).default([]),
    afternoonActivities: z.array(ActivityOptionSchema).default([]),
    eveningActivities: z.array(ActivityOptionSchema).default([])
});

// Meal option from Google Places API nearby search
const MealFromPlacesSchema = z.object({
    id: z.string(),
    name: z.string(),
    cuisine: z.string().optional().nullable(),
    description: z.string().optional().nullable(), // vicinity/address
    rating: z.number().optional().nullable(),
    priceRange: z.string().optional().nullable(), // $, $$, $$$, $$$$
    coordinates: z.object({
        lat: z.number(),
        lng: z.number()
    }),
    place_id: z.string()
});

// Meal suggestions from Places API for a day
const MealSuggestionsFromPlacesSchema = z.object({
    dayNumber: z.number(),
    breakfast: z.array(MealFromPlacesSchema).default([]),
    lunch: z.array(MealFromPlacesSchema).default([]),
    dinner: z.array(MealFromPlacesSchema).default([])
});

// User selections from suggestions
const DaySelectionsSchema = z.object({
    dayNumber: z.number(),
    breakfast: z.string().nullable(), // selected meal option id
    morningActivities: z.array(z.string()).default([]), // selected activity option ids
    lunch: z.string().nullable(),
    afternoonActivities: z.array(z.string()).default([]),
    dinner: z.string().nullable(),
    eveningActivities: z.array(z.string()).default([]),
    customRequests: z.string().optional().nullable() // additional user input
});

// Expanded day with full activities and meals
const ExpandedDaySchema = z.object({
    dayNumber: z.number(),
    date: z.string(),
    theme: z.string(),
    breakfast: MealSchema.nullable().optional(),
    morning: z.array(z.lazy(() => ActivitySchema)).default([]),
    lunch: MealSchema.nullable().optional(),
    afternoon: z.array(z.lazy(() => ActivitySchema)).default([]),
    dinner: MealSchema.nullable().optional(),
    evening: z.array(z.lazy(() => ActivitySchema)).default([]),
    notes: z.string().optional().nullable()
});

// Original activity schema (kept for compatibility)
const ActivitySchema = z.object({
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
});

const DayItinerarySchema = z.object({
    date: z.string(),
    day_number: z.number(),
    morning: z.array(ActivitySchema),
    afternoon: z.array(ActivitySchema),
    evening: z.array(ActivitySchema),
    notes: z.string().optional().nullable(),
});

const CostBreakdownSchema = z.object({
    activities: z.number(),
    food: z.number(),
    local_transport: z.number(),
    total: z.number(),
    currency: z.string().default("USD"),
    per_person: z.number().optional().nullable(),
});

const TravelPlanSchema = z.object({
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

const TravelRequestSchema = z.object({
    destination: z.string().optional().nullable(),
    start_date: z.string().optional().nullable(), // YYYY-MM-DD
    end_date: z.string().optional().nullable(),   // YYYY-MM-DD
    interest_categories: z.array(z.string()).default([]),
    activity_level: z.string().default("moderate"),
});

module.exports = {
    // Original schemas
    TravelPlanSchema,
    TravelRequestSchema,
    ActivitySchema,
    DayItinerarySchema,
    // New workflow schemas
    WorkflowStateSchema,
    TripInfoSchema,
    SkeletonDaySchema,
    SkeletonItinerarySchema,
    MealSchema,
    ExpandedDaySchema,
    // Suggestion schemas
    ActivityOptionSchema,
    MealOptionSchema,
    DaySuggestionsSchema,
    DaySelectionsSchema,
    // Two-step flow schemas (activities first, then meals)
    ActivitySuggestionsSchema,
    MealFromPlacesSchema,
    MealSuggestionsFromPlacesSchema
};
