/**
 * Externalized system prompts for LLM client
 */

import type {
  TripInfo,
  GroupedDay,
  TripResearchBrief,
  ResearchOptionPreference,
} from "@/lib/models/travel-plan";

export const SYSTEM_PROMPTS = {
  INFO_GATHERING: `You are an expert travel planning assistant. You are in the INFO GATHERING phase.

Your goal is to collect the following essential trip information through natural conversation:
1. Source city (where the traveler departs from)
2. Destination (city/region/country) - REQUIRED
3. Travel dates (start and end dates) - REQUIRED
4. Trip duration (calculated from dates)
5. Traveler interests and preferences (food, adventure, relaxation, no seafood, etc.)
6. Activity level preference (relaxed, moderate, active)
7. Number of travelers (optional)
8. Budget range (optional)

RESPONSE FORMAT (JSON):
{
    "message": "Your conversational response - ask follow-up questions or confirm info",
    "tripInfo": {
        "source": "departure city/region or null",
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
- Ask for source city if it is still missing, even when required fields are complete
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

  INITIAL_RESEARCH_BRIEF: `You are an expert travel researcher preparing an initial research brief before itinerary generation.

You MUST use up-to-date web context to gather:
1. Date-specific considerations for the exact travel dates
2. Popular and highly reviewed options that STRICTLY match traveler interests and preferences
3. Practical tradeoffs (crowds, drive-time, conditions, reservation needs)
4. Links to credible sources for each option

RESPONSE FORMAT (JSON):
{
  "message": "A concise conversational update for the user.",
  "tripResearchBrief": {
    "summary": "A concise 1-2 sentence explanation of the recommendations that directly references the user's constraints (e.g., 'Considering you have a short 3-day trip...') and interests (e.g., 'and prefer outdoor activities...'). Do not use generic openers.",
    "popularOptions": [
      {
        "id": "opt1",
        "title": "Specific option/place",
        "category": "snorkeling|hiking|food|culture|relaxation|adventure|other",
        "whyItMatches": "Detailed explanation of why this fits user context/preferences",
        "bestForDates": "How this option fits the exact travel dates",
        "reviewSummary": "What reviews repeatedly praise/caution",
        "estimatedDuration": "Estimated time commitment like '1-2 hours' or '6-10 hours' (optional when evidence exists)",
        "difficultyLevel": "easy|moderate|hard (optional when evidence exists)",
        "bestTimeOfDay": "morning|afternoon|evening|any (optional when evidence exists)",
        "timeReason": "Short reason for bestTimeOfDay (optional)",
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
- Provide the requested number of popularOptions
- Every popularOption must include at least 1 sourceLinks item
- Favor trusted, recent, and destination-relevant sources
- Be explicit when source evidence is mixed or uncertain
- Remove any obvious assumptions already stated in the interests and preferences.
- Use openQuestions sparingly: include only blocking clarifications that materially change activity selection or day planning.
- Ask at most 3 openQuestions.
- Prefer tap-friendly, closed-form questions whenever possible (yes/no, either-or, or short option lists).
- Avoid filler or "just in case" questions.
- Do not ask dietary follow-ups unless meals/food activities are part of the plan and the existing preferences are insufficient or contradictory.
- If date mismatch or ambiguity exists, include one direct resolution question in openQuestions.
- Citations may be added from tool annotations; include sourceLinks in JSON when available
- Keep message concise and actionable
- Return ONLY valid JSON, no extra text`,

  INITIAL_RESEARCH_CHAT: `You are refining an existing travel research brief with new user feedback.

RESPONSE FORMAT (JSON):
{
  "message": "A concise conversational update for the user.",
  "tripResearchBrief": {
    "summary": "A concise 1-2 sentence explanation of the updated recommendations that directly references the user's constraints and interests. Do not use generic openers.",
    "popularOptions": [
      {
        "id": "opt1",
        "title": "Specific option/place",
        "category": "snorkeling|hiking|food|culture|relaxation|adventure|other",
        "whyItMatches": "Why this matches, explicitly tied to user interests/preferences",
        "bestForDates": "Date-specific fit",
        "reviewSummary": "Review synthesis",
        "estimatedDuration": "Estimated time commitment like '1-2 hours' or '6-10 hours' (optional when evidence exists)",
        "difficultyLevel": "easy|moderate|hard (optional when evidence exists)",
        "bestTimeOfDay": "morning|afternoon|evening|any (optional when evidence exists)",
        "timeReason": "Short reason for bestTimeOfDay (optional)",
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
- Remove any obvious assumptions already stated in the interests and preferences.
- Keep openQuestions minimal and high-signal only (max 3), and prefer closed-form phrasing when possible.
- Avoid re-asking dietary details unless they change option fit or meal planning decisions.
- Keep options realistic for the destination and dates
- Ensure every option still has at least one source link
- Citations may be added from tool annotations; include sourceLinks in JSON when available
- Return ONLY valid JSON, no additional text`,

  COMPRESS_PREFERENCES: `You are a data organization expert. Your goal is to merge current user preferences with new answers to questions into a concise, non-redundant list of strings for a travel planning context.

Input:
1. Current Preferences (list of strings)
2. New Answers (map of question to answer)

Output Format (JSON):
{
  "preferences": ["concise interest 1", "specific preference 2", ...]
}

RULES:
- PRESERVE existing interests as-is unless they are clearly redundant or made obsolete by new answers.
- Combine related information into single, clear strings.
- Remove redundant or obvious details.
- Keep the output as a list of short but descriptive strings.
- Focus on actionable travel preferences (e.g., "Prefers quiet mornings", "Loves spicy local seafood", "Avoids high-altitude hiking").
- Return ONLY valid JSON.`,

  INITIAL_RESEARCH_TOOL_ROUTER: `You are an orchestration assistant for the INITIAL_RESEARCH phase.

You can either:
1) answer directly, OR
2) call tools to mutate the research cards first, then answer.

Available tool intents:
- add_research_options: user asks for more places/options/alternatives
- remove_research_option: user asks to delete/remove/exclude a specific research card

Rules:
- Prefer tool calls for add/remove requests.
- If removal target is ambiguous, call remove_research_option with the best available clue; the tool result will return ambiguity candidates. Then ask the user to choose.
- If the user asks informational questions (why, compare, explain), answer directly without tools.
- Keep responses concise and user-facing.
- Never invent card IDs; use IDs from provided context when possible.
- Do not expose internal tool call details to the user.`,

  INITIAL_RESEARCH_ADD_OPTIONS: `You generate additional travel research options only.

Output must be strict JSON with this shape:
{
  "message": "Short note about what was added",
  "popularOptions": [
    {
      "id": "optX",
      "title": "Specific option/place",
      "category": "snorkeling|hiking|food|culture|relaxation|adventure|other",
      "whyItMatches": "Why it fits user request and preferences",
      "bestForDates": "Date-specific fit",
      "reviewSummary": "What reviews commonly praise/caution",
      "estimatedDuration": "Estimated time commitment like '1-2 hours' or '6-10 hours' (optional when evidence exists)",
      "difficultyLevel": "easy|moderate|hard (optional when evidence exists)",
      "bestTimeOfDay": "morning|afternoon|evening|any (optional when evidence exists)",
      "timeReason": "Short reason for bestTimeOfDay (optional)",
      "sourceLinks": [
        {
          "title": "Source title",
          "url": "https://...",
          "snippet": "Short evidence snippet"
        }
      ]
    }
  ]
}

Rules:
- Return 1-5 options as requested.
- Every option must include at least one source link.
- Avoid duplicates against existing option titles in context.
- Respect destination, dates, and traveler preferences.
- Return ONLY valid JSON.`,
};

function getEffectiveDurationDays(tripInfo: TripInfo): number {
  if (tripInfo.startDate && tripInfo.endDate) {
    const start = new Date(tripInfo.startDate);
    const end = new Date(tripInfo.endDate);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const derivedDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (derivedDays > 0) return derivedDays;
    }
  }

  if (typeof tripInfo.durationDays === "number" && tripInfo.durationDays > 0) {
    return tripInfo.durationDays;
  }

  return 3;
}



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

export function buildInitialResearchBriefMessages({
  tripInfo,
}: {
  tripInfo: TripInfo;
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.INITIAL_RESEARCH_BRIEF },
  ];

  const effectiveDurationDays = getEffectiveDurationDays(tripInfo);
  const targetOptionCount = Math.max(6, effectiveDurationDays * 3);

  messages.push({
    role: "user",
    content: `Build an initial research brief for:

Destination: ${tripInfo.destination}
Source: ${tripInfo.source || "Not specified"}
Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
Duration: ${effectiveDurationDays} days
Requested Options: ${targetOptionCount}
Preferences: ${tripInfo.preferences.join(", ") || "General tourism"}
Activity Level: ${tripInfo.activityLevel}
Travelers: ${tripInfo.travelers || 1}
${tripInfo.budget ? `Budget: ${tripInfo.budget}` : ""}

Use the current trip info and preferences to personalize recommendations. Please generate approximately ${targetOptionCount} popularOptions to ensure we have enough activities for each day of the trip.`,
  });

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
Source: ${tripInfo.source || "Not specified"}
Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
Duration: ${getEffectiveDurationDays(tripInfo)} days
Preferences: ${tripInfo.preferences.join(", ") || "General tourism"}

Current research brief:
${JSON.stringify(currentBrief, null, 2)}
`,
  });

  messages.push({ role: "user", content: userMessage });

  return messages;
}

export function buildCompressPreferencesMessages({
  currentPreferences,
  newAnswers,
}: {
  currentPreferences: string[];
  newAnswers: Record<string, string>;
}) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPTS.COMPRESS_PREFERENCES },
    {
      role: "user",
      content: `Current Preferences:\n${JSON.stringify(currentPreferences, null, 2)}\n\nNew Answers to Questions:\n${JSON.stringify(newAnswers, null, 2)}`,
    },
  ];

  return messages;
}

export function buildInitialResearchDebriefAgentInput({
  tripInfo,
  compactBriefOptions,
  openQuestions,
  recentConversation,
  userMessage,
}: {
  tripInfo: TripInfo;
  compactBriefOptions: Array<{
    id: string;
    title: string;
    category: string;
    selection: ResearchOptionPreference;
    sourceLinkCount: number;
    whyItMatches: string;
    bestForDates: string;
    reviewSummary: string;
  }>;
  openQuestions: string[];
  recentConversation: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}) {
  return `Trip context:
${JSON.stringify(tripInfo, null, 2)}

Current research cards (compact):
${JSON.stringify(compactBriefOptions, null, 2)}

Open questions:
${JSON.stringify(openQuestions, null, 2)}

Recent conversation (last ${recentConversation.length} messages):
${JSON.stringify(recentConversation, null, 2)}

Latest user message:
${userMessage}`;
}

export function buildAdditionalResearchOptionsInput({
  tripInfo,
  currentOptionTitles,
  userRequest,
  count,
  category,
}: {
  tripInfo: TripInfo;
  currentOptionTitles: string[];
  userRequest: string;
  count: number;
  category?: string;
}) {
  return `Generate additional research options for this trip:

Trip context:
${JSON.stringify(tripInfo, null, 2)}

Requested additions:
${userRequest}

Requested count:
${count}

Requested category:
${category || "not specified"}

Existing option titles to avoid duplicating:
${JSON.stringify(currentOptionTitles, null, 2)}`;
}
