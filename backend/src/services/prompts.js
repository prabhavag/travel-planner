/**
 * Externalized system prompts for LLM client
 * Keeping prompts separate improves maintainability and readability
 */

const SYSTEM_PROMPTS = {
    /**
     * System prompt for initial travel plan generation
     */
    TRAVEL_PLANNER: `You are an expert travel planner. Generate detailed, realistic travel plans in JSON format.
Be specific with activities, locations, and recommendations. Provide accurate price estimates based on the plan type.
Always return valid JSON.`,

    /**
     * Base system prompt for modifying itineraries through conversation
     */
    MODIFY_ITINERARY: `You are an expert travel planner assistant. You are helping the user PLAN their trip iteratively.

Your task is to:
1. Understand the user's request for changes or initial planning.
2. If the user provides destination, dates, and interests - IMMEDIATELY generate a full itinerary with activities for each day.
3. If the user hasn't decided on a destination yet, help them narrow it down.
4. Keep the conversation helpful and interactive.
5. The "summary" field should be your conversational response to the user explaining what you've planned or asking follow-up questions.

CRITICAL RULES:
- Your response must ALWAYS be a valid JSON object.
- When the user provides trip details (destination, dates, duration), you MUST generate activities in the "itinerary" array.
- Do NOT set plan_type to "finalized" unless the user explicitly says they want to finalize.
- Keep plan_type as "planning" during normal conversation.

Return the complete plan in this structure:
{
    "plan_type": "planning",
    "destination": "City, Country",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "duration_days": number,
    "summary": "Your conversational response explaining the plan or asking questions",
    "itinerary": [
        {
            "day_number": 1,
            "date": "YYYY-MM-DD",
            "morning": [{"name": "Activity Name", "type": "attraction", "description": "...", "duration": "2 hours", "cost": 0}],
            "afternoon": [{"name": "Activity Name", "type": "attraction", "description": "...", "duration": "2 hours", "cost": 0}],
            "evening": [{"name": "Restaurant Name", "type": "restaurant", "description": "...", "duration": "2 hours", "cost": 30}]
        }
    ],
    "highlights": ["highlight1", "highlight2"],
    "tips": ["tip1", "tip2"]
}

IMPORTANT:
- When user provides trip info, generate a COMPLETE itinerary with activities for ALL days.
- Each day MUST have morning, afternoon, and evening activities.
- Activity names should be real, specific places (e.g., "Golden Gate Bridge", "Fisherman's Wharf", "Chinatown").
- The summary should explain what you've planned in a friendly, conversational way.`,

    /**
     * Additional instructions appended when finalizing an itinerary
     */
    FINALIZE_INSTRUCTIONS: `

FINALIZATION MODE ACTIVE: The user clicked the "Finalize" button.
You MUST:
1. Set "plan_type" to "finalized"
2. Keep ALL existing activities from the current itinerary
3. Enhance EVERY activity with complete details:
   - Detailed description (2-3 sentences)
   - Specific time (e.g., "9:00 AM - 11:00 AM")
   - Duration
   - Estimated cost
   - Add "practical_tips" field with helpful advice for that activity
4. Ensure the itinerary covers all days of the trip
5. Provide a summary saying the itinerary is now finalized and ready
6. Include helpful "tips" array with destination-specific advice`
};

/**
 * Build the prompt for generating a travel plan
 * @param {Object} params - Trip parameters
 * @returns {string} The formatted prompt
 */
function buildTravelPlanPrompt({
    destination,
    start_date,
    end_date,
    duration_days,
    interest_categories,
    activity_level
}) {
    const interestsStr = interest_categories && interest_categories.length > 0
        ? interest_categories.map(c => c.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())).join(", ")
        : "General tourism";

    const destText = destination ? `for ${destination}` : "without a fixed destination yet";
    const datesText = start_date && end_date ? `from ${start_date} to ${end_date}` : "with dates to be decided";

    return `Start a travel planning session ${destText} ${datesText} based on the following:

Trip Details:
- Destination: ${destination || "To be decided"}
- Start Date: ${start_date || "To be decided"}
- End Date: ${end_date || "To be decided"}
- Duration: ${duration_days || "To be decided"} days (Help plan for these days)

Activity Preferences:
- Interests: ${interestsStr}
- Activity Level: ${activity_level}

Guidelines:
- Transportation: Suggest standard flights or travel methods with estimated costs.
- Accommodation: Suggest a suitable hotel with estimated costs.
- Activities: Focus on ${interestsStr}. Activity level should be ${activity_level}.

Generate a comprehensive travel plan in JSON format with the following structure:

{
    "plan_type": "customized",
    "summary": "Brief summary of the plan",
    "transportation": {
        "type": "flight",
        "to_location": "destination",
        "departure_date": "YYYY-MM-DD",
        "arrival_date": "YYYY-MM-DD",
        "airline": "suggested airline",
        "class_type": "economy",
        "estimated_price": 0.0,
        "duration": "estimated duration",
        "notes": "any relevant notes"
    },
    "accommodation": {
        "name": "hotel name suggestion",
        "type": "hotel",
        "location": "destination",
        "price_per_night": 0.0,
        "total_price": 0.0,
        "check_in": "YYYY-MM-DD",
        "check_out": "YYYY-MM-DD",
        "nights": ${duration_days || 0},
        "rating": 0.0,
        "amenities": ["amenity1", "amenity2"],
        "notes": "accommodation notes"
    },
    "itinerary": [
        {
            "date": "YYYY-MM-DD",
            "day_number": 1,
            "morning": [{"name": "activity", "type": "attraction", "time": "morning", "description": "...", "location": "...", "duration": "...", "cost": 0.0}],
            "afternoon": [{"name": "activity", "type": "attraction", "time": "afternoon", "description": "...", "location": "...", "duration": "...", "cost": 0.0}],
            "evening": [{"name": "activity", "type": "restaurant", "time": "evening", "description": "...", "location": "...", "duration": "...", "cost": 0.0}]
        }
        ... generate for ALL ${duration_days || "N"} days of the trip ...
    ],
    "cost_breakdown": {
        "transportation": 0.0,
        "accommodation": 0.0,
        "activities": 0.0,
        "food": 0.0,
        "local_transport": 0.0,
        "total": 0.0,
        "per_person": 0.0
    },
    "highlights": ["highlight1", "highlight2"],
    "tips": ["tip1", "tip2"]
}

CRITICAL REQUIREMENTS:
1. Generate itinerary for ALL ${duration_days || "N"} days of the trip (from ${start_date || "start"} to ${end_date || "end"})
2. Each day must have day_number from 1 to ${duration_days || "N"}, with corresponding dates
3. Fill in realistic activities for EACH day matching the interests: ${interestsStr}
4. Include morning, afternoon, and evening activities for EVERY day
5. Provide estimated costs.
6. Match the ${activity_level} activity level.
7. All prices should be in USD
8. Focus activities on: ${interestsStr}
9. The itinerary array MUST contain exactly ${duration_days || "N"} day objects, one for each day of the trip
10. Return ONLY valid JSON, no additional text`;
}

/**
 * Get the welcome message for new planning sessions
 * @returns {Object} Welcome response object
 */
function getWelcomeResponse() {
    return {
        plan_type: "planning",
        summary: "Hello! I'm your AI travel assistant. To create your perfect trip, please tell me:\n\n1. Where would you like to go?\n2. What are your travel dates?\n3. How many days is your trip?\n4. What are your interests? (e.g., history, food, adventure, art, relaxation)\n\nShare as much as you'd like and we'll build your ideal itinerary together!",
        itinerary: [],
        destination: null,
        start_date: null,
        end_date: null,
        duration_days: 0
    };
}

/**
 * Build the messages array for modifying an itinerary
 * @param {Object} params - Parameters for building messages
 * @param {Object} params.currentPlan - The current travel plan to modify
 * @param {string} params.userMessage - The user's modification request
 * @param {Array} params.conversationHistory - Previous conversation messages
 * @param {boolean} params.finalize - Whether to finalize the itinerary
 * @returns {Array} Array of message objects for the LLM
 */
function buildModifyItineraryMessages({ currentPlan, userMessage, conversationHistory, finalize = false }) {
    const systemPrompt = finalize
        ? SYSTEM_PROMPTS.MODIFY_ITINERARY + SYSTEM_PROMPTS.FINALIZE_INSTRUCTIONS
        : SYSTEM_PROMPTS.MODIFY_ITINERARY;

    const messages = [{ role: "system", content: systemPrompt }];

    // Add context about the current plan
    const planContext = `Here is the current travel plan that needs to be modified:
\`\`\`json
${JSON.stringify(currentPlan, null, 2)}
\`\`\`
Modify this plan according to the user's request. Return the complete updated plan as a valid JSON object.`;

    messages.push({ role: "user", content: planContext });
    messages.push({ role: "assistant", content: "I understand the current travel plan. What changes would you like to make?" });

    // Add recent history with validation (only last 6 messages)
    const recentHistory = conversationHistory.slice(-6);
    recentHistory.forEach(msg => {
        // Only allow user/assistant roles, sanitize content
        if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({
                role: msg.role,
                content: String(msg.content || '').slice(0, 10000)
            });
        }
    });

    // Add the current user message
    messages.push({ role: "user", content: userMessage });

    return messages;
}

module.exports = {
    SYSTEM_PROMPTS,
    buildTravelPlanPrompt,
    buildModifyItineraryMessages,
    getWelcomeResponse
};
