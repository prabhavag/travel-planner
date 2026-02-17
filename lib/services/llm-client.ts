import OpenAI from "openai";
import {
  type TripInfo,
  type SuggestedActivity,
  type DayGroup,
  type GroupedDay,
  type TripResearchBrief,
} from "@/lib/models/travel-plan";
import {
  buildInfoGatheringMessages,
  buildInitialResearchBriefMessages,
  buildInitialResearchChatMessages,
  buildReviewMessages,
  buildSuggestTopActivitiesMessages,
  buildGroupActivitiesMessages,
  buildRegenerateDayThemeMessages,
  buildSuggestActivitiesChatMessages,
  buildCompressPreferencesMessages,
} from "./prompts";
import { getPlacesClient } from "./places-client";
import { getGeocodingService } from "./geocoding-service";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_TEMPERATURE = 0.5;
const RESEARCH_CATEGORIES = ["snorkeling", "hiking", "food", "culture", "relaxation", "adventure", "other"] as const;

const RESEARCH_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["message", "tripResearchBrief"],
  properties: {
    message: { type: "string" },
    tripResearchBrief: {
      type: "object",
      additionalProperties: false,
      required: ["popularOptions", "assumptions", "openQuestions"],
      properties: {
        popularOptions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title", "category", "whyItMatches", "bestForDates", "reviewSummary", "sourceLinks"],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              category: { type: "string", enum: [...RESEARCH_CATEGORIES] },
              whyItMatches: { type: "string" },
              bestForDates: { type: "string" },
              reviewSummary: { type: "string" },
              sourceLinks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "url", "snippet"],
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" },
                    snippet: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
        },
        assumptions: {
          type: "array",
          items: { type: "string" },
        },
        openQuestions: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
};

interface LLMClientOptions {
  model?: string;
  temperature?: number;
}



class LLMClient {
  private openai: OpenAI;
  private model: string;
  private webSearchModel: string;
  private temperature: number;
  private webSearchSupportedInChat = true;

  constructor(options: LLMClientOptions = {}) {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("LLM API key not configured");
    }

    this.openai = new OpenAI({ apiKey });
    this.model = options.model || process.env.LLM_MODEL || DEFAULT_MODEL;
    this.webSearchModel = this.model;
    const envTemp = process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : null;
    this.temperature = options.temperature ?? envTemp ?? DEFAULT_TEMPERATURE;
  }

  private _parseJsonResponse(completion: OpenAI.Chat.Completions.ChatCompletion) {
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from LLM");
    }

    try {
      return JSON.parse(content);
    } catch (parseError) {
      throw new Error(`Failed to parse LLM response as JSON: ${(parseError as Error).message}`);
    }
  }

  private _normalizeInterestTags(rawTags: unknown): string[] {
    if (!Array.isArray(rawTags)) {
      return [];
    }

    const forbiddenTags = new Set([
      "museum",
      "landmark",
      "park",
      "viewpoint",
      "market",
      "experience",
      "neighborhood",
      "beach",
      "temple",
      "gallery",
      "morning",
      "afternoon",
      "evening",
      "any",
    ]);

    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const tag of rawTags) {
      if (typeof tag !== "string") continue;
      const value = tag.trim().toLowerCase().replace(/\s+/g, " ");
      if (!value || forbiddenTags.has(value) || seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
      if (normalized.length === 3) break;
    }

    return normalized;
  }

  private _normalizeSuggestedActivity(activity: SuggestedActivity): SuggestedActivity {
    return {
      ...activity,
      interestTags: this._normalizeInterestTags((activity as SuggestedActivity & { interestTags?: unknown }).interestTags),
    };
  }

  private _isWebSearchUnsupportedError(error: unknown): boolean {
    const apiLike = error as { status?: number; param?: string; message?: string };
    const message = String(apiLike?.message || "");
    return (
      apiLike?.status === 400 &&
      (apiLike?.param === "web_search_options" || /web search options not supported/i.test(message))
    );
  }

  private async _createJsonCompletionWithWebSearchFallback({
    messages,
    searchContextSize = "high",
  }: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    searchContextSize?: "low" | "medium" | "high";
  }): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    if (this.webSearchSupportedInChat) {
      try {
        return await this.openai.chat.completions.create({
          messages,
          model: this.webSearchModel,
          temperature: this.temperature,
          response_format: { type: "json_object" },
          web_search_options: { search_context_size: searchContextSize },
        });
      } catch (error) {
        if (this._isWebSearchUnsupportedError(error)) {
          this.webSearchSupportedInChat = false;
          console.warn(
            `Web search options are not supported for model ${this.webSearchModel} in chat.completions. Continuing without web search.`
          );
        } else {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Web search call failed. Falling back without web search. ${message}`);
        }
      }
    }

    return this.openai.chat.completions.create({
      messages,
      model: this.model,
      temperature: this.temperature,
      response_format: { type: "json_object" },
    });
  }

  private async _createStreamingCompletionWithWebSearchFallback({
    messages,
    searchContextSize = "medium",
  }: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    searchContextSize?: "low" | "medium" | "high";
  }) {
    if (this.webSearchSupportedInChat) {
      try {
        return await this.openai.chat.completions.create({
          messages,
          model: this.webSearchModel,
          temperature: this.temperature,
          stream: true,
          web_search_options: { search_context_size: searchContextSize },
        });
      } catch (error) {
        if (this._isWebSearchUnsupportedError(error)) {
          this.webSearchSupportedInChat = false;
          console.warn(
            `Web search options are not supported for model ${this.webSearchModel} in streaming chat.completions. Continuing without web search.`
          );
        } else {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Streaming web search call failed. Falling back without web search. ${message}`);
        }
      }
    }

    return this.openai.chat.completions.create({
      messages,
      model: this.model,
      temperature: this.temperature,
      stream: true,
    });
  }

  private _serializeMessagesForResponses(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): string {
    return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  }

  private async _createResearchResponseWithWebSearch({
    messages,
    searchContextSize = "high",
  }: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    searchContextSize?: "low" | "medium" | "high";
  }): Promise<OpenAI.Responses.Response> {
    return this.openai.responses.create({
      model: this.model,
      input: this._serializeMessagesForResponses(messages),
      temperature: this.temperature,
      tools: [{ type: "web_search_preview", search_context_size: searchContextSize }],
      tool_choice: "auto",
      text: {
        format: {
          type: "json_schema",
          name: "trip_research_brief_response",
          strict: true,
          schema: RESEARCH_RESPONSE_JSON_SCHEMA,
        },
      },
    });
  }

  private _parseResearchResponseJson(response: OpenAI.Responses.Response): Record<string, unknown> {
    const rawText = typeof response.output_text === "string" ? response.output_text.trim() : "";
    if (!rawText) {
      throw new Error("Empty response output_text from Responses API");
    }

    try {
      return JSON.parse(rawText) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Failed to parse Responses output JSON: ${(error as Error).message}`);
    }
  }

  private _extractUrlCitationsFromResponse(
    response: OpenAI.Responses.Response
  ): Array<{ title: string; url: string; snippet: string | null }> {
    const citations: Array<{ title: string; url: string; snippet: string | null }> = [];

    for (const item of response.output || []) {
      if (item.type !== "message" || item.role !== "assistant") continue;
      for (const contentPart of item.content || []) {
        if (contentPart.type !== "output_text") continue;
        const contentText = typeof contentPart.text === "string" ? contentPart.text : "";
        for (const annotation of contentPart.annotations || []) {
          if (annotation.type !== "url_citation") continue;
          const title = (annotation.title || "Source").trim();
          const url = (annotation.url || "").trim();
          if (!url) continue;
          let snippet: string | null = null;
          if (
            typeof annotation.start_index === "number" &&
            typeof annotation.end_index === "number" &&
            annotation.start_index >= 0 &&
            annotation.end_index > annotation.start_index &&
            annotation.end_index <= contentText.length
          ) {
            snippet = contentText.slice(annotation.start_index, annotation.end_index).trim() || null;
          }
          citations.push({ title, url, snippet });
        }
      }
    }

    const deduped = new Map<string, { title: string; url: string; snippet: string | null }>();
    for (const citation of citations) {
      const key = citation.url.toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, citation);
      }
    }
    return Array.from(deduped.values());
  }

  private _mergeCitationLinksIntoBrief({
    brief,
    citations,
  }: {
    brief: TripResearchBrief;
    citations: Array<{ title: string; url: string; snippet: string | null }>;
  }): TripResearchBrief {
    if (citations.length === 0) return brief;

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const usedCitationUrls = new Set<string>();
    const popularOptions = brief.popularOptions.map((option) => {
      const existing = new Map<string, { title: string; url: string; snippet: string | null }>();
      for (const link of option.sourceLinks || []) {
        const key = link.url.toLowerCase();
        if (!existing.has(key)) {
          existing.set(key, {
            title: link.title,
            url: link.url,
            snippet: link.snippet ?? null,
          });
        }
      }

      const optionText = normalize(`${option.title} ${option.category} ${option.whyItMatches} ${option.bestForDates}`);

      const matching = citations.filter((citation) => {
        const citationTitle = normalize(citation.title);
        return citationTitle && (optionText.includes(citationTitle) || citationTitle.includes(normalize(option.title)));
      });

      const nonMatching = citations.filter((citation) => !matching.includes(citation));
      const prioritized = [...matching, ...nonMatching];

      for (const citation of prioritized) {
        if (existing.size >= 3) break;
        const key = citation.url.toLowerCase();
        if (existing.has(key)) continue;
        existing.set(key, citation);
        usedCitationUrls.add(key);
      }

      return {
        ...option,
        sourceLinks: Array.from(existing.values()).slice(0, 3),
      };
    });

    if (popularOptions.every((option) => option.sourceLinks.length > 0)) {
      return { ...brief, popularOptions };
    }

    const remainingCitations = citations.filter((citation) => !usedCitationUrls.has(citation.url.toLowerCase()));
    if (remainingCitations.length === 0) {
      return { ...brief, popularOptions };
    }

    const patchedOptions = popularOptions.map((option) => {
      if (option.sourceLinks.length > 0) return option;
      return {
        ...option,
        sourceLinks: remainingCitations.slice(0, 3),
      };
    });

    return {
      ...brief,
      popularOptions: patchedOptions,
    };
  }

  private async _enrichResearchBriefWithPlacePhotos({
    brief,
    destination,
  }: {
    brief: TripResearchBrief;
    destination: string | null;
  }): Promise<TripResearchBrief> {
    const destinationName = destination?.trim();
    if (!destinationName) return brief;

    let placesClient: ReturnType<typeof getPlacesClient> | null = null;
    try {
      placesClient = getPlacesClient();
    } catch {
      return brief;
    }

    let destinationCoords: { lat: number; lng: number } | null = null;
    try {
      const geocodingService = getGeocodingService();
      destinationCoords = await geocodingService.geocode(destinationName);
    } catch {
      destinationCoords = null;
    }

    const popularOptions = await Promise.all(
      brief.popularOptions.map(async (option) => {
        try {
          const searchQuery = `${option.title}, ${destinationName}`;
          let places = await placesClient.searchPlaces(searchQuery, destinationCoords, 50000);
          if (!places.length) {
            places = await placesClient.searchPlaces(searchQuery);
          }

          const placeId = places[0]?.place_id || null;
          if (!placeId) {
            return {
              ...option,
              photoUrls: option.photoUrls || [],
            };
          }

          const photoUrls = await placesClient.getPlacePhotoUrlsFromId(placeId, 320);
          return {
            ...option,
            photoUrls: photoUrls.slice(0, 3),
          };
        } catch {
          return {
            ...option,
            photoUrls: option.photoUrls || [],
          };
        }
      })
    );

    return {
      ...brief,
      popularOptions,
    };
  }

  private _normalizeTripResearchBrief(rawBrief: unknown): TripResearchBrief {
    const raw = (rawBrief || {}) as Record<string, unknown>;

    const popularOptions = Array.isArray(raw.popularOptions)
      ? raw.popularOptions
        .map((option, index) => {
          const opt = (option || {}) as Record<string, unknown>;
          const sourceLinksRaw = Array.isArray(opt.sourceLinks) ? opt.sourceLinks : [];
          const sourceLinks = sourceLinksRaw
            .map((source) => {
              const s = (source || {}) as Record<string, unknown>;
              if (typeof s.url !== "string" || !s.url.trim()) return null;
              return {
                title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : "Source",
                url: s.url.trim(),
                snippet: typeof s.snippet === "string" ? s.snippet.trim() : null,
              };
            })
            .filter((value): value is { title: string; url: string; snippet: string | null } => Boolean(value));
          const photoUrls = Array.isArray(opt.photoUrls)
            ? opt.photoUrls
              .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
              .map((url) => url.trim())
              .slice(0, 3)
            : [];

          return {
            id: typeof opt.id === "string" && opt.id.trim() ? opt.id.trim() : `opt${index + 1}`,
            title: typeof opt.title === "string" && opt.title.trim() ? opt.title.trim() : `Option ${index + 1}`,
            category:
              typeof opt.category === "string" &&
                RESEARCH_CATEGORIES.includes(opt.category as (typeof RESEARCH_CATEGORIES)[number])
                ? (opt.category as (typeof RESEARCH_CATEGORIES)[number])
                : "other",
            whyItMatches: typeof opt.whyItMatches === "string" ? opt.whyItMatches : "",
            bestForDates: typeof opt.bestForDates === "string" ? opt.bestForDates : "",
            reviewSummary: typeof opt.reviewSummary === "string" ? opt.reviewSummary : "",
            sourceLinks,
            photoUrls,
          };
        })
        .filter((option) => option.title.length > 0)
      : [];

    return {
      summary: typeof raw.summary === "string" ? raw.summary : undefined,
      dateNotes: Array.isArray(raw.dateNotes) ? raw.dateNotes.filter((v): v is string => typeof v === "string") : [],
      popularOptions,
      assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.filter((v): v is string => typeof v === "string") : [],
      openQuestions: Array.isArray(raw.openQuestions) ? raw.openQuestions.filter((v): v is string => typeof v === "string") : [],
    };
  }

  async gatherInfo({
    tripInfo,
    userMessage,
  }: {
    tripInfo: TripInfo | null;
    userMessage: string;
  }) {
    const messages = buildInfoGatheringMessages({
      tripInfo,
      userMessage,
    });

    try {
      const completion = await this.openai.chat.completions.create({
        messages,
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      });

      const response = this._parseJsonResponse(completion);

      const updatedTripInfo: TripInfo = {
        destination: null,
        startDate: null,
        endDate: null,
        durationDays: null,
        preferences: [],
        activityLevel: "moderate",
        travelers: 1,
        budget: null,
        ...tripInfo,
        ...response.tripInfo,
      };

      if (updatedTripInfo.startDate && updatedTripInfo.endDate && !updatedTripInfo.durationDays) {
        const start = new Date(updatedTripInfo.startDate);
        const end = new Date(updatedTripInfo.endDate);
        updatedTripInfo.durationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }

      return {
        success: true,
        message: response.message,
        tripInfo: updatedTripInfo,
        isComplete: response.isComplete || false,
        missingInfo: response.missingInfo || [],
      };
    } catch (error) {
      console.error("Error in gatherInfo:", error);
      return {
        success: false,
        message: "Sorry, I had trouble understanding that. Could you rephrase?",
        tripInfo,
        isComplete: false,
        missingInfo: [],
      };
    }
  }

  async reviewPlan({
    tripInfo,
    groupedDays,
    userMessage,
  }: {
    tripInfo: TripInfo;
    groupedDays: GroupedDay[];
    userMessage: string;
  }) {
    const messages = buildReviewMessages({
      tripInfo,
      groupedDays,
      userMessage,
    });

    try {
      const completion = await this.openai.chat.completions.create({
        messages,
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      });

      const response = this._parseJsonResponse(completion);

      return {
        success: true,
        message: response.message,
        modifications: response.modifications || null,
        readyToFinalize: response.readyToFinalize || false,
      };
    } catch (error) {
      console.error("Error in review:", error);
      return {
        success: false,
        message: "Sorry, I had trouble processing your feedback. Please try again.",
        modifications: null,
        readyToFinalize: false,
      };
    }
  }

  async generateInitialResearchBrief({
    tripInfo,
  }: {
    tripInfo: TripInfo;
  }): Promise<{
    success: boolean;
    message: string;
    tripResearchBrief: TripResearchBrief | null;
  }> {
    const messages = buildInitialResearchBriefMessages({
      tripInfo,
    });

    try {
      const response = await this._createResearchResponseWithWebSearch({
        messages,
        searchContextSize: "high",
      });

      const parsed = this._parseResearchResponseJson(response);
      const normalizedBrief = this._normalizeTripResearchBrief(parsed.tripResearchBrief);
      const citations = this._extractUrlCitationsFromResponse(response);
      const mergedBrief = this._mergeCitationLinksIntoBrief({
        brief: normalizedBrief,
        citations,
      });
      const enrichedBrief = await this._enrichResearchBriefWithPlacePhotos({
        brief: mergedBrief,
        destination: tripInfo.destination,
      });

      return {
        success: true,
        message:
          (typeof parsed.message === "string" && parsed.message) ||
          "I prepared an initial research brief you can refine.",
        tripResearchBrief: enrichedBrief,
      };
    } catch (error) {
      console.error("Error in generateInitialResearchBrief:", error);
      return {
        success: false,
        message: "Sorry, I couldn't prepare the initial research brief. Please try again.",
        tripResearchBrief: null,
      };
    }
  }

  async refineInitialResearchBrief({
    tripInfo,
    currentBrief,
    userMessage,
  }: {
    tripInfo: TripInfo;
    currentBrief: TripResearchBrief;
    userMessage: string;
  }): Promise<{
    success: boolean;
    message: string;
    tripResearchBrief: TripResearchBrief | null;
  }> {
    const messages = buildInitialResearchChatMessages({
      tripInfo,
      currentBrief,
      userMessage,
    });

    try {
      const response = await this._createResearchResponseWithWebSearch({
        messages,
        searchContextSize: "high",
      });

      const parsed = this._parseResearchResponseJson(response);
      const normalizedBrief = this._normalizeTripResearchBrief(parsed.tripResearchBrief);
      const citations = this._extractUrlCitationsFromResponse(response);
      const mergedBrief = this._mergeCitationLinksIntoBrief({
        brief: normalizedBrief,
        citations,
      });
      const enrichedBrief = await this._enrichResearchBriefWithPlacePhotos({
        brief: mergedBrief,
        destination: tripInfo.destination,
      });

      return {
        success: true,
        message: (typeof parsed.message === "string" && parsed.message) || "I updated your research brief.",
        tripResearchBrief: enrichedBrief,
      };
    } catch (error) {
      console.error("Error in refineInitialResearchBrief:", error);
      return {
        success: false,
        message: "Sorry, I couldn't update the research brief. Please try again.",
        tripResearchBrief: null,
      };
    }
  }

  async compressPreferences({
    currentPreferences,
    newAnswers,
  }: {
    currentPreferences: string[];
    newAnswers: Record<string, string>;
  }): Promise<{ success: boolean; preferences: string[] }> {
    const messages = buildCompressPreferencesMessages({
      currentPreferences,
      newAnswers,
    });

    try {
      const completion = await this.openai.chat.completions.create({
        messages,
        model: this.model,
        temperature: 0.3, // Lower temperature for data formatting tasks
        response_format: { type: "json_object" },
      });

      const response = this._parseJsonResponse(completion);
      return {
        success: true,
        preferences: Array.isArray(response.preferences) ? response.preferences : currentPreferences,
      };
    } catch (error) {
      console.error("Error in compressPreferences:", error);
      return {
        success: false,
        preferences: currentPreferences,
      };
    }
  }

  async *suggestTopActivities({
    tripInfo,
    tripResearchBrief,
    researchOptionSelections,
  }: {
    tripInfo: TripInfo;
    tripResearchBrief?: TripResearchBrief | null;
    researchOptionSelections?: Record<string, "keep" | "maybe" | "reject">;
  }): AsyncGenerator<
    | { type: "message"; message: string }
    | { type: "activity"; activity: SuggestedActivity }
    | { type: "complete" }
    | { type: "error"; message: string }
  > {
    const messages = buildSuggestTopActivitiesMessages({
      tripInfo,
      tripResearchBrief,
      researchOptionSelections,
    });
    console.log("Suggesting top activities with messages:", messages);

    try {
      const stream = await this._createStreamingCompletionWithWebSearchFallback({
        messages,
        searchContextSize: "medium",
      });

      let buffer = "";
      let messageYielded = false;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        buffer += content;

        // Process complete lines as they arrive
        while (buffer.includes("\n")) {
          const newlineIndex = buffer.indexOf("\n");
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            try {
              const parsed = JSON.parse(line);
              if (!messageYielded && parsed.message && !parsed.id) {
                // First line is the message
                yield { type: "message", message: parsed.message };
                messageYielded = true;
              } else if (parsed.id) {
                // Activity line
                yield { type: "activity", activity: this._normalizeSuggestedActivity(parsed as SuggestedActivity) };
              }
            } catch {
              // Not valid JSON yet, might be partial - skip this line
              console.warn("Skipping invalid JSON line:", line);
            }
          }
        }
      }

      // Process any remaining content in buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.id) {
            yield { type: "activity", activity: this._normalizeSuggestedActivity(parsed as SuggestedActivity) };
          }
        } catch {
          console.warn("Skipping final invalid JSON:", buffer);
        }
      }

      yield { type: "complete" };
    } catch (error) {
      console.error("Error suggesting top activities:", error);
      yield { type: "error", message: "Sorry, I couldn't generate activity suggestions. Please try again." };
    }
  }

  async groupActivitiesIntoDays({
    tripInfo,
    activities,
  }: {
    tripInfo: TripInfo;
    activities: SuggestedActivity[];
  }): Promise<{
    success: boolean;
    message: string;
    dayGroups: DayGroup[];
  }> {
    const messages = buildGroupActivitiesMessages({ tripInfo, activities });

    try {
      const completion = await this.openai.chat.completions.create({
        messages,
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      });

      const response = this._parseJsonResponse(completion);

      return {
        success: true,
        message: response.message,
        dayGroups: response.dayGroups || [],
      };
    } catch (error) {
      console.error("Error grouping activities into days:", error);
      return {
        success: false,
        message: "Sorry, I couldn't organize the activities into days. Please try again.",
        dayGroups: [],
      };
    }
  }

  async regenerateDayTheme({ activities }: { activities: SuggestedActivity[] }): Promise<{
    success: boolean;
    theme: string;
  }> {
    const messages = buildRegenerateDayThemeMessages({ activities });

    try {
      const completion = await this.openai.chat.completions.create({
        messages,
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      });

      const response = this._parseJsonResponse(completion);

      return {
        success: true,
        theme: response.theme || "Exploring the City",
      };
    } catch (error) {
      console.error("Error regenerating day theme:", error);
      return {
        success: false,
        theme: "A Day of Adventures",
      };
    }
  }

  async chatDuringSuggestActivities({
    tripInfo,
    suggestedActivities,
    selectedActivityIds,
    userMessage,
  }: {
    tripInfo: TripInfo;
    suggestedActivities: SuggestedActivity[];
    selectedActivityIds: string[];
    userMessage: string;
  }): Promise<{
    success: boolean;
    message: string;
    tripInfo: TripInfo | null;
    newActivities: SuggestedActivity[];
    replaceActivities: boolean;
  }> {
    const messages = buildSuggestActivitiesChatMessages({
      tripInfo,
      suggestedActivities,
      selectedActivityIds,
      userMessage,
    });

    try {
      const completion = await this.openai.chat.completions.create({
        messages,
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      });

      const response = this._parseJsonResponse(completion);

      // Expected JSON response format:
      // {
      //   "message": "Your helpful response",
      //   "tripInfo": { /* only include if user changed trip details */ },
      //   "newActivities": [ /* only include if suggesting new activities, same format as original */ ],
      //   "replaceActivities": true or false
      // }
      //
      // RULES:
      // - Be conversational and helpful
      // - If asked about a specific activity, provide detailed info
      // - If asked for more activities, generate 1-5 new ones matching the request
      // - If the user wants to start over or express dislike for current options, set replaceActivities=true
      // - Otherwise, set replaceActivities=false (to append new activities)

      return {
        success: true,
        message: response.message,
        tripInfo: response.tripInfo || null,
        newActivities: Array.isArray(response.newActivities)
          ? response.newActivities.map((activity: SuggestedActivity) => this._normalizeSuggestedActivity(activity))
          : [],
        replaceActivities: response.replaceActivities || false,
      };
    } catch (error) {
      console.error("Error in chatDuringSuggestActivities:", error);
      return {
        success: false,
        message: "Sorry, I had trouble processing that. Please try again.",
        tripInfo: null,
        newActivities: [],
        replaceActivities: false, // Default to false on error
      };
    }
  }
}

// Export singleton
let llmClientInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient();
  }
  return llmClientInstance;
}

export { LLMClient };
