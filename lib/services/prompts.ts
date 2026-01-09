/**
 * Externalized system prompts for LLM client
 */

import type { TripInfo, SuggestedActivity, GroupedDay } from "@/lib/models/travel-plan";

export const SYSTEM_PROMPTS = {
  INFO_GATHERING: `You are an expert travel planning assistant. You are in the INFO GATHERING phase.

Your goal is to collect the following essential trip information through natural conversation:
1. Destination (city/region/country) - REQUIRED
2. Travel dates (start and end dates) - REQUIRED
3. Trip duration (calculated from dates)
4. Traveler interests and preferences (food, adventure, relaxation, no seafood, etc.)
5. Activity level preference (relaxed, moderate, active)
6. Number of travelers (optional)
7. Budget range (optional)

RESPONSE FORMAT (JSON):
{
    "message": "Your conversational response - ask follow-up questions or confirm info",
    "tripInfo": {
        "destination": "extracted destination or null",
        "startDate": "YYYY-MM-DD or null",
        "endDate": "YYYY-MM-DD or null",
        "durationDays": number or null,
        "preferences": ["pref1", "pref2"],
        "activityLevel": "relaxed|moderate|active",
        "travelers": number,
        "budget": "budget range or null"
    },
    "isComplete": true or false,
    "missingInfo": ["list of missing required fields"]
}

RULES:
- Be conversational and helpful
- Extract information incrementally from user messages
- Always return what you know so far in tripInfo
- Calculate durationDays from startDate and endDate if both are provided
- Set isComplete=true ONLY when destination AND dates are provided
- When isComplete=true, confirm the details and ask if they want to proceed to planning
- Return ONLY valid JSON, no additional text`,

  REVIEW: `You are helping review and refine a complete trip itinerary.

RESPONSE FORMAT (JSON):
{
    "message": "Your response to the user's feedback or questions",
    "modifications": {
        "dayNumber": { /* modified day structure if changes requested */ }
    },
    "readyToFinalize": true or false
}

RULES:
- If user asks a question, answer it helpfully in the message
- Only include modifications if user explicitly requested changes
- If user is satisfied, set readyToFinalize=true
- Be helpful and suggest improvements proactively if you see issues
- Always follow interests and preferences if specified in tripInfo
- Return ONLY valid JSON, no additional text`,

  SUGGEST_TOP_ACTIVITIES: `You are an expert travel planner suggesting the TOP 10 activities for a trip.

For the given destination and user interests, suggest exactly 10 activities that:
1. Match the user's interests and activity level
2. Are real, specific places (not generic descriptions)
3. Cover a variety of types (landmarks, museums, nature, experiences, neighborhoods)
4. Include both popular attractions and hidden gems
5. Can realistically be done during the trip duration

RESPONSE FORMAT (JSONL - one JSON object per line, NO markdown code blocks):
Line 1: {"message": "Your conversational intro presenting these activities"}
Lines 2-11: One activity per line as a JSON object

Example activity line:
{"id": "act1", "name": "Specific Place Name", "type": "museum", "description": "2-3 sentences about what makes this special", "estimatedDuration": "2-3 hours", "estimatedCost": 15, "bestTimeOfDay": "morning", "neighborhood": "Area/district"}

RULES:
- Output EXACTLY 11 lines total: 1 message line + 10 activity lines
- Each line must be a complete, valid JSON object on its own line
- Do NOT wrap output in an array, outer object, or markdown code blocks
- Use REAL, specific place names that exist in the destination
- Activity IDs must be: act1, act2, act3, ... act10
- type must be one of: museum|landmark|park|viewpoint|market|experience|neighborhood|beach|temple|gallery
- NEVER suggest restaurants, cafes, or dining establishments as activities (these are handled separately)
- bestTimeOfDay must be one of: morning|afternoon|evening|any
- estimatedCost: number in local currency (0 for free activities)
- Ensure all activities are at the destination specified
- STRICTLY FOLLOW USER INTERESTS AND PREFERENCES (e.g., if user says 'no shopping', do not suggest malls)`,

  GROUP_ACTIVITIES_INTO_DAYS: `You are an expert travel planner grouping selected activities into days.

Given a list of selected activities with their coordinates, duration, and best time of day, group them into days that:
1. MINIMIZE travel time between activities (group by proximity/neighborhood)
2. Respect best time of day (morning activities first, evening activities last)
3. Create balanced days (not too packed, not too empty - aim for 2-4 activities per day)
4. Create a logical flow within each day
5. Consider opening hours and realistic timing

RESPONSE FORMAT (JSON):
{
  "message": "Explanation of how you organized the activities into days",
  "dayGroups": [
    {
      "dayNumber": 1,
      "date": "YYYY-MM-DD",
      "theme": "Auto-generated catchy theme based on activities (e.g., 'Historic Heart & Local Flavors')",
      "activityIds": ["act1", "act3", "act5"]
    }
  ]
}

RULES:
- Create exactly the number of days specified in the trip duration
- Each activity should appear in exactly ONE day
- Order activities within each day by optimal timing
- Group nearby activities together when possible
- Create thematic coherence within each day
- Generate a descriptive, engaging theme for each day
- Theme should capture the essence of activities in that day
- RESPECT USER PREFERENCES when organizing (e.g., if user prefers relaxed pace, limit activities)
- Return ONLY valid JSON, no additional text`,

  REGENERATE_DAY_THEME: `You are generating a catchy, descriptive theme for a day of activities.

Given a list of activities for a single day, create a theme that:
1. Captures the essence of what the traveler will experience
2. Is engaging and evocative (not just a list)
3. Is 3-6 words long

RESPONSE FORMAT (JSON):
{
  "theme": "Historic Heart & Local Flavors"
}

RULES:
- Theme should be creative and memorable
- Reflect the types of activities and areas visited
- Return ONLY valid JSON, no additional text`,

  SUGGEST_ACTIVITIES_CHAT: `You are helping users explore and select activities for their trip.

You have already suggested 10 activities. Now help the user:
1. Answer questions about any of the suggested activities
2. Suggest additional or alternative activities if requested
3. Update trip info if the user provides new details

RESPONSE FORMAT (JSON):
{
  "message": "Your helpful response",
  "tripInfo": { /* only include if user changed trip details */ },
  "newActivities": [ /* only include if suggesting new activities, same format as original */ ]
}

RULES:
- Be conversational and helpful
- If asked about a specific activity, provide detailed info
- If asked for more activities, generate 1-5 new ones matching the request
- New activities must have unique ids (act11, act12, etc.)
- Only update tripInfo if user explicitly changes trip details
- Return ONLY valid JSON, no additional text`,
};

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildInfoGatheringMessages({
  tripInfo,
  userMessage,
  conversationHistory,
}: {
  tripInfo: TripInfo | null;
  userMessage: string;
  conversationHistory: ConversationMessage[];
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.INFO_GATHERING },
  ];

  if (tripInfo && Object.values(tripInfo).some((v) => v !== null && v !== undefined)) {
    messages.push({
      role: "user",
      content: `Current trip information collected so far:\n${JSON.stringify(tripInfo, null, 2)}\n\nContinue the conversation with the user.`,
    });
    messages.push({
      role: "assistant",
      content: "I understand the current trip details. I'll continue gathering information.",
    });
  }

  const recentHistory = (conversationHistory || []).slice(-6);
  recentHistory.forEach((msg) => {
    if (msg.role === "user" || msg.role === "assistant") {
      messages.push({
        role: msg.role,
        content: String(msg.content || "").slice(0, 5000),
      });
    }
  });

  messages.push({ role: "user", content: userMessage });

  return messages;
}

export function buildReviewMessages({
  tripInfo,
  groupedDays,
  userMessage,
}: {
  tripInfo: TripInfo;
  groupedDays: GroupedDay[];
  userMessage: string;
  conversationHistory?: ConversationMessage[];
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.REVIEW },
  ];

  const daysSummary = groupedDays
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((day) => `Day ${day.dayNumber} (${day.date}): ${day.theme}`)
    .join("\n");

  messages.push({
    role: "user",
    content: `Review the complete itinerary for ${tripInfo.destination}:

Trip Overview:
${daysSummary}

${tripInfo.preferences.length > 0 ? `User Preferences:\n- ${tripInfo.preferences.join("\n- ")}\n` : ""}

Full Itinerary:
${JSON.stringify(groupedDays, null, 2)}

User feedback: ${userMessage}`,
  });

  return messages;
}

export function buildSuggestTopActivitiesMessages({ tripInfo }: { tripInfo: TripInfo }) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.SUGGEST_TOP_ACTIVITIES },
  ];

  messages.push({
    role: "user",
    content: `Suggest 10 top activities for the following trip:

Destination: ${tripInfo.destination}
Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
Duration: ${tripInfo.durationDays} days
Preferences: ${tripInfo.preferences.join(", ") || "General tourism"}
Activity Level: ${tripInfo.activityLevel}
Travelers: ${tripInfo.travelers || 1}
${tripInfo.budget ? `Budget: ${tripInfo.budget}` : ""}

Generate exactly 10 activity suggestions that match the traveler's interests.`,
  });

  return messages;
}

export function buildGroupActivitiesMessages({
  tripInfo,
  activities,
}: {
  tripInfo: TripInfo;
  activities: SuggestedActivity[];
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.GROUP_ACTIVITIES_INTO_DAYS },
  ];

  // Create a simplified version of activities for the LLM
  const activitiesForLLM = activities.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    estimatedDuration: a.estimatedDuration,
    bestTimeOfDay: a.bestTimeOfDay,
    neighborhood: a.neighborhood,
    coordinates: a.coordinates,
  }));

  messages.push({
    role: "user",
    content: `Group these selected activities into ${tripInfo.durationDays} days for a trip to ${tripInfo.destination}:

Trip Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
Duration: ${tripInfo.durationDays} days
${tripInfo.preferences.length > 0 ? `Preferences:\n- ${tripInfo.preferences.join("\n- ")}` : ""}

Selected Activities:
${JSON.stringify(activitiesForLLM, null, 2)}

Group these activities into days based on:
1. Proximity (nearby activities on same day)
2. Best time of day (morning/afternoon/evening)
3. Balanced distribution across days
4. Logical flow within each day

Generate day groups with engaging themes for each day.`,
  });

  return messages;
}

export function buildRegenerateDayThemeMessages({ activities }: { activities: SuggestedActivity[] }) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.REGENERATE_DAY_THEME },
  ];

  const activitySummary = activities.map((a) => `${a.name} (${a.type})`).join(", ");

  messages.push({
    role: "user",
    content: `Generate a theme for a day with these activities: ${activitySummary}`,
  });

  return messages;
}

export function buildSuggestActivitiesChatMessages({
  tripInfo,
  suggestedActivities,
  selectedActivityIds,
  userMessage,
  conversationHistory,
}: {
  tripInfo: TripInfo;
  suggestedActivities: SuggestedActivity[];
  selectedActivityIds: string[];
  userMessage: string;
  conversationHistory: ConversationMessage[];
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.SUGGEST_ACTIVITIES_CHAT },
  ];

  // Add context about current activities
  messages.push({
    role: "user",
    content: `Trip to ${tripInfo.destination} (${tripInfo.durationDays} days)
Preferences: ${tripInfo.preferences.join(", ") || "General tourism"}

Current suggested activities:
${JSON.stringify(suggestedActivities, null, 2)}

Selected so far: ${selectedActivityIds.length > 0 ? selectedActivityIds.join(", ") : "None yet"}`,
  });

  messages.push({
    role: "assistant",
    content: "I have the activity list ready. How can I help?",
  });

  // Add recent conversation history
  const recentHistory = (conversationHistory || []).slice(-6);
  recentHistory.forEach((msg) => {
    if (msg.role === "user" || msg.role === "assistant") {
      messages.push({
        role: msg.role,
        content: String(msg.content || "").slice(0, 5000),
      });
    }
  });

  messages.push({ role: "user", content: userMessage });

  return messages;
}
