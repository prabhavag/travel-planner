const { z } = require('zod');

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
    TravelPlanSchema,
    TravelRequestSchema
};
