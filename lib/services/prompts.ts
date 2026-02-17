/**
 * Externalized system prompts for LLM client
 */

import type { TripInfo, SuggestedActivity, GroupedDay, TripResearchBrief } from "@/lib/models/travel-plan";

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
- A difference of <= 1 day between the date range and the requested duration is acceptable (e.g., June 1-6 for 7 days); set isComplete=true in such cases without flagging a conflict
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
{"id": "act1", "name": "Specific Place Name", "type": "museum", "interestTags": ["local culture", "history"], "description": "2-3 sentences about what makes this special", "estimatedDuration": "2-3 hours", "estimatedCost": 1500, "currency": "JPY", "bestTimeOfDay": "morning", "neighborhood": "Area/district"}

RULES:
- Output EXACTLY 11 lines total: 1 message line + 10 activity lines
- Each line must be a complete, valid JSON object on its own line
- Do NOT wrap output in an array, outer object, or markdown code blocks
- Use REAL, specific place names that exist in the destination
- Activity IDs must be: act1, act2, act3, ... act10
- type must be one of: museum|landmark|park|viewpoint|market|experience|neighborhood|beach|temple|gallery
- interestTags must be 1-3 short tags directly tied to the traveler's interests or preferences
- interestTags must NOT be generic taxonomy labels like museum|park|morning|afternoon
- NEVER suggest restaurants, cafes, or dining establishments as activities (these are handled separately)
- bestTimeOfDay must be one of: morning|afternoon|evening|any
- estimatedCost: number in the destination's LOCAL CURRENCY (0 for free activities)
- currency: the ISO 4217 currency code for the destination (e.g., "USD" for USA, "EUR" for Europe, "JPY" for Japan, "GBP" for UK, "THB" for Thailand, "INR" for India)
- IMPORTANT: Always use the local currency of the destination, NOT USD
- Ensure all activities are at the destination specified
- STRICTLY FOLLOW USER INTERESTS AND PREFERENCES (e.g., if user says 'no shopping', do not suggest malls)
- If research option selections are provided: prioritize 'keep', consider 'maybe', and avoid 'reject' options`,

  GROUP_ACTIVITIES_INTO_DAYS: `You are an expert travel planner grouping selected activities into days.

Given a list of selected activities with their coordinates, duration, and best time of day, group them into days that:
1. MINIMIZE travel time between activities (group by proximity/neighborhood)
2. Respect best time of day (morning activities first, evening activities last)
3. Create balanced days (not too packed, not too empty - aim for 2-4 activities per day)
4. Treat the first and last days of the trip as partial days due to flight/commute constraints - plan fewer activities (1-2) for these days
5. Create a logical flow within each day
6. Consider opening hours and realistic timing

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
  "newActivities": [ /* only include if suggesting new activities, same format as original */ ],
  "replaceActivities": true or false
}

RULES:
- Be conversational and helpful
- If asked about a specific activity, provide detailed info
- If asked for more activities, generate 1-5 new ones matching the request
- Each new activity must include interestTags (1-3) aligned to user interests/preferences
- If the user wants to start over or express dislike for current options, set replaceActivities=true
- Otherwise, set replaceActivities=false (to append new activities)
- Return ONLY valid JSON, no additional text`,

  INITIAL_RESEARCH_BRIEF: `You are an expert travel researcher preparing an initial research brief before itinerary generation.

You MUST use up-to-date web context to gather:
1. Date-specific considerations for the exact travel dates
2. Popular and highly reviewed options that STRICTLY match traveler interests and preferences
3. Practical tradeoffs (crowds, drive-time, conditions, reservation needs)
4. Links to credible sources for each option

RESPONSE FORMAT (JSON):
{
  "message": "A concise conversational summary for the user. Include a clear explanation that their initial selections (keep/maybe/reject) below will help you refine further recommendations and create a better personalized itinerary.",
  "tripResearchBrief": {
    "summary": "High-level framing of what this trip should optimize for, based on traveler interests and preferences",
    "dateNotes": ["Date-specific notes and constraints"],
    "popularOptions": [
      {
        "id": "opt1",
        "title": "Specific option/place",
        "category": "snorkeling|hiking|food|culture|relaxation|adventure|other",
        "whyItMatches": "Detailed explanation of why this fits user context/preferences",
        "bestForDates": "How this option fits the exact travel dates",
        "reviewSummary": "What reviews repeatedly praise/caution",
        "sourceLinks": [
          {
            "title": "Source title",
            "url": "https://...",
            "snippet": "Short evidence snippet"
          }
        ]
      }
    ],
    "assumptions": ["Assumptions currently being made"],
    "openQuestions": ["Questions user should answer before activity generation"]
  }
}

RULES:
- STRICTLY RESPECT traveler interests and preferences when selecting popularOptions
- Provide 6-10 popularOptions
- Every popularOption must include at least 1 sourceLinks item
- Favor trusted, recent, and destination-relevant sources
- Be explicit when source evidence is mixed or uncertain
- If date mismatch or ambiguity exists, mention it in dateNotes and openQuestions
- Citations may be added from tool annotations; include sourceLinks in JSON when available
- Keep message concise and actionable
- NOTE: Treat the first and last days of the trip as partial days due to arrival/departure constraints; reflect this in your summary and notes
- Return ONLY valid JSON, no extra text`,

  INITIAL_RESEARCH_CHAT: `You are refining an existing travel research brief with new user feedback.

RESPONSE FORMAT (JSON):
{
  "message": "Your response to the user's feedback and what changed. Remind the user if needed that their selections help refine further recommendations.",
  "tripResearchBrief": {
    "summary": "Updated summary, continuing to respect interests and preferences",
    "dateNotes": ["Updated date notes"],
    "popularOptions": [
      {
        "id": "opt1",
        "title": "Specific option/place",
        "category": "snorkeling|hiking|food|culture|relaxation|adventure|other",
        "whyItMatches": "Why this matches, explicitly tied to user interests/preferences",
        "bestForDates": "Date-specific fit",
        "reviewSummary": "Review synthesis",
        "sourceLinks": [
          {
            "title": "Source title",
            "url": "https://...",
            "snippet": "Short evidence snippet"
          }
        ]
      }
    ],
    "assumptions": ["Updated assumptions"],
    "openQuestions": ["Remaining questions"]
  }
}

RULES:
- STRICTLY RESPECT new and existing traveler interests and preferences
- Keep high-quality options and replace weak fits
- Respect newly specified constraints
- Keep options realistic for the destination and dates
- Ensure every option still has at least one source link
- Citations may be added from tool annotations; include sourceLinks in JSON when available
- Return ONLY valid JSON, no additional text`,
};



export function buildInfoGatheringMessages({
  tripInfo,
  userMessage,
}: {
  tripInfo: TripInfo | null;
  userMessage: string;
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

export function buildSuggestTopActivitiesMessages({
  tripInfo,
  tripResearchBrief,
  researchOptionSelections,
}: {
  tripInfo: TripInfo;
  tripResearchBrief?: TripResearchBrief | null;
  researchOptionSelections?: Record<string, "keep" | "maybe" | "reject">;
}) {
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

${tripResearchBrief ? `Use this pre-research brief as hard context:\n${JSON.stringify(tripResearchBrief, null, 2)}\n` : ""}
${researchOptionSelections ? `Research option selections (keep/maybe/reject):\n${JSON.stringify(researchOptionSelections, null, 2)}\n` : ""}

Generate exactly 10 activity suggestions that match the traveler's interests and research context.`,
  });

  return messages;
}

export function buildInitialResearchBriefMessages({
  tripInfo,
}: {
  tripInfo: TripInfo;
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.INITIAL_RESEARCH_BRIEF },
  ];

  messages.push({
    role: "user",
    content: `Build an initial research brief for:

Destination: ${tripInfo.destination}
Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
Duration: ${tripInfo.durationDays} days
Preferences: ${tripInfo.preferences.join(", ") || "General tourism"}
Activity Level: ${tripInfo.activityLevel}
Travelers: ${tripInfo.travelers || 1}
${tripInfo.budget ? `Budget: ${tripInfo.budget}` : ""}

Use the current trip info and preferences to personalize recommendations.`,
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
}: {
  tripInfo: TripInfo;
  suggestedActivities: SuggestedActivity[];
  selectedActivityIds: string[];
  userMessage: string;
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

  messages.push({ role: "user", content: userMessage });

  return messages;
}

export function buildInitialResearchChatMessages({
  tripInfo,
  currentBrief,
  userMessage,
}: {
  tripInfo: TripInfo;
  currentBrief: TripResearchBrief;
  userMessage: string;
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.INITIAL_RESEARCH_CHAT },
  ];

  messages.push({
    role: "user",
    content: `Trip context:
Destination: ${tripInfo.destination}
Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
Duration: ${tripInfo.durationDays} days
Preferences: ${tripInfo.preferences.join(", ") || "General tourism"}

Current research brief:
${JSON.stringify(currentBrief, null, 2)}
`,
  });

  messages.push({ role: "user", content: userMessage });

  return messages;
}
