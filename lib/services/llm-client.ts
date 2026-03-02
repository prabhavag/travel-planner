import OpenAI from "openai";
import { z } from "zod";
import {
  type AccommodationOption,
  type FlightOption,
  type TripInfo,
  type SuggestedActivity,
  type GroupedDay,
  type TripResearchBrief,
  type ResearchOption,
  type ResearchOptionPreference,
} from "@/lib/models/travel-plan";
import {
  SYSTEM_PROMPTS,
  buildAdditionalResearchOptionsInput,
  buildInitialResearchDebriefAgentInput,
  buildInfoGatheringMessages,
  buildInitialResearchBriefMessages,
  buildInitialResearchChatMessages,
  buildReviewMessages,
  buildCompressPreferencesMessages,
} from "./prompts";
import { getPlacesClient } from "./places-client";
import { getGeocodingService } from "./geocoding-service";
import { mergeResearchBriefAndSelections } from "./card-merging";

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
      required: ["summary", "popularOptions", "assumptions", "openQuestions"],
      properties: {
        summary: { type: "string" },
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
              estimatedDuration: { type: ["string", "null"] },
              difficultyLevel: { type: "string", enum: ["easy", "moderate", "hard"] },
              bestTimeOfDay: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
              timeReason: { type: ["string", "null"] },
              timeSourceLinks: {
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
              locationMode: { type: "string", enum: ["point", "route", "area"] },
              startCoordinates: {
                type: ["object", "null"],
                additionalProperties: false,
                required: ["lat", "lng"],
                properties: {
                  lat: { type: "number" },
                  lng: { type: "number" },
                },
              },
              endCoordinates: {
                type: ["object", "null"],
                additionalProperties: false,
                required: ["lat", "lng"],
                properties: {
                  lat: { type: "number" },
                  lng: { type: "number" },
                },
              },
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

const ADDITIONAL_RESEARCH_OPTIONS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["message", "popularOptions"],
  properties: {
    message: { type: "string" },
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
          estimatedDuration: { type: ["string", "null"] },
          difficultyLevel: { type: "string", enum: ["easy", "moderate", "hard"] },
          bestTimeOfDay: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
          timeReason: { type: ["string", "null"] },
          timeSourceLinks: {
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
          locationMode: { type: "string", enum: ["point", "route", "area"] },
          startCoordinates: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["lat", "lng"],
            properties: {
              lat: { type: "number" },
              lng: { type: "number" },
            },
          },
          endCoordinates: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["lat", "lng"],
            properties: {
              lat: { type: "number" },
              lng: { type: "number" },
            },
          },
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
  },
};

const SINGLE_RESEARCH_OPTION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["message", "option"],
  properties: {
    message: { type: "string" },
    option: {
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
        estimatedDuration: { type: ["string", "null"] },
        difficultyLevel: { type: "string", enum: ["easy", "moderate", "hard"] },
        bestTimeOfDay: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
        timeReason: { type: ["string", "null"] },
        timeSourceLinks: {
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
        locationMode: { type: "string", enum: ["point", "route", "area"] },
        startCoordinates: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["lat", "lng"],
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
          },
        },
        endCoordinates: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["lat", "lng"],
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
          },
        },
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
};

const ACCOMMODATION_SEARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["message", "options"],
  properties: {
    message: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "neighborhood",
          "nightlyPriceEstimate",
          "currency",
          "rating",
          "sourceUrl",
          "summary",
          "pros",
          "cons",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          neighborhood: { type: ["string", "null"] },
          nightlyPriceEstimate: { type: ["number", "null"] },
          currency: { type: "string" },
          rating: { type: ["number", "null"] },
          sourceUrl: { type: ["string", "null"] },
          summary: { type: "string" },
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const FLIGHT_SEARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["message", "options"],
  properties: {
    message: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "airline",
          "routeSummary",
          "departureWindow",
          "arrivalWindow",
          "duration",
          "stops",
          "totalPriceEstimate",
          "currency",
          "sourceUrl",
          "summary",
          "baggageNotes",
        ],
        properties: {
          id: { type: "string" },
          airline: { type: "string" },
          routeSummary: { type: "string" },
          departureWindow: { type: ["string", "null"] },
          arrivalWindow: { type: ["string", "null"] },
          duration: { type: ["string", "null"] },
          stops: { type: ["number", "null"] },
          totalPriceEstimate: { type: ["number", "null"] },
          currency: { type: "string" },
          sourceUrl: { type: ["string", "null"] },
          summary: { type: "string" },
          baggageNotes: { type: ["string", "null"] },
        },
      },
    },
  },
};

const MAX_INITIAL_RESEARCH_TOOL_STEPS = 3;

const addResearchOptionsArgsSchema = z.object({
  request: z.string().trim().min(1),
  count: z.number().int().min(1).max(5).optional(),
  category: z.enum(RESEARCH_CATEGORIES).optional(),
});

const removeResearchOptionArgsSchema = z
  .object({
    option_id: z.string().trim().min(1).optional(),
    option_title: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.option_id || value.option_title), {
    message: "Either option_id or option_title is required",
  });

const INITIAL_RESEARCH_TOOLS: Array<Record<string, unknown>> = [
  {
    type: "function",
    name: "add_research_options",
    description: "Add 1-5 new research cards based on the user's request.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "string" },
        count: { type: "integer", minimum: 1, maximum: 5 },
        category: { type: "string", enum: [...RESEARCH_CATEGORIES] },
      },
    },
  },
  {
    type: "function",
    name: "remove_research_option",
    description: "Remove a research card by id or title. Use when user asks to delete/remove a card.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        option_id: { type: "string" },
        option_title: { type: "string" },
      },
    },
  },
];

interface LLMClientOptions {
  model?: string;
  temperature?: number;
}

type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];

export type InitialResearchToolName = "add_research_options" | "remove_research_option";

export interface AddResearchOptionsArgs {
  request: string;
  count?: number;
  category?: ResearchCategory;
}

export interface RemoveResearchOptionArgs {
  option_id?: string;
  option_title?: string;
}

export interface ToolExecutionResult {
  toolName: InitialResearchToolName;
  ok: boolean;
  status: "success" | "error" | "ambiguous" | "not_found";
  message: string;
  details?: Record<string, unknown>;
}

export interface InitialResearchAgentResult {
  success: boolean;
  message: string;
  tripResearchBrief: TripResearchBrief;
  researchOptionSelections: Record<string, ResearchOptionPreference>;
}

interface ResearchToolState {
  tripResearchBrief: TripResearchBrief;
  researchOptionSelections: Record<string, ResearchOptionPreference>;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
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

  private _extractNextJsonObject(buffer: string): { json: string; rest: string } | null {
    const start = buffer.indexOf("{");
    if (start === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < buffer.length; i++) {
      const char = buffer[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const json = buffer.slice(start, i + 1);
          const rest = buffer.slice(i + 1);
          return { json, rest };
        }
      }
    }

    return null;
  }

  private _coerceSuggestedActivityId(
    rawId: unknown,
    seenIds: Set<string>,
    nextIndex: number
  ): string {
    const candidate = typeof rawId === "string" ? rawId.trim() : "";
    if (candidate && !seenIds.has(candidate)) {
      return candidate;
    }

    let index = Math.max(1, nextIndex);
    let fallback = `act${index}`;
    while (seenIds.has(fallback)) {
      index += 1;
      fallback = `act${index}`;
    }
    return fallback;
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

  private _asCoordinates(value: unknown): { lat: number; lng: number } | null {
    const raw = (value || null) as Record<string, unknown> | null;
    const lat = raw && typeof raw.lat === "number" ? raw.lat : null;
    const lng = raw && typeof raw.lng === "number" ? raw.lng : null;
    return lat != null && lng != null ? { lat, lng } : null;
  }

  private _inferLocationMode(option: { title: string; category: string }): "point" | "route" | "area" {
    const text = `${option.title} ${option.category}`.toLowerCase();
    if (/(road to|scenic drive|drive|highway|route|loop drive)/i.test(text)) {
      return "route";
    }
    if (/(region|district|neighborhood|old town|national park|state park)/i.test(text)) {
      return "area";
    }
    return "point";
  }

  private _normalizeBestTimeOfDay(value: unknown): "morning" | "afternoon" | "evening" | "any" {
    return value === "morning" || value === "afternoon" || value === "evening" || value === "any"
      ? value
      : "any";
  }

  private _normalizeDifficultyLevel(value: unknown): "easy" | "moderate" | "hard" {
    return value === "easy" || value === "moderate" || value === "hard" ? value : "moderate";
  }

  private _normalizeEstimatedDuration(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private _inferEstimatedDuration({
    title,
    category,
    whyItMatches,
    bestForDates,
    reviewSummary,
  }: {
    title: string;
    category: string;
    whyItMatches: string;
    bestForDates: string;
    reviewSummary: string;
  }): string {
    const text = `${title} ${category} ${whyItMatches} ${bestForDates} ${reviewSummary}`.toLowerCase();

    if (/(road to hana|scenic drive|full day|all day|day trip)/i.test(text)) return "6-10 hours";
    if (/(dinner|lunch|breakfast|meal|restaurant|food tour)/i.test(text)) return "1-2 hours";
    if (/(snorkel|snorkeling|hike|trail|kayak|surf|adventure tour)/i.test(text)) return "2-4 hours";
    if (/(museum|gallery|market|walking tour|city tour|beach|relax)/i.test(text)) return "1-3 hours";

    if (category === "hiking" || category === "snorkeling" || category === "adventure") return "2-4 hours";
    if (category === "food" || category === "culture" || category === "relaxation") return "1-3 hours";
    return "2-3 hours";
  }

  private _inferDifficultyLevel({
    title,
    category,
    whyItMatches,
    bestForDates,
    reviewSummary,
  }: {
    title: string;
    category: string;
    whyItMatches: string;
    bestForDates: string;
    reviewSummary: string;
  }): "easy" | "moderate" | "hard" {
    const text = `${title} ${category} ${whyItMatches} ${bestForDates} ${reviewSummary}`.toLowerCase();

    if (/(strenuous|challenging|steep|summit|technical|advanced|backcountry|long hike|full[-\s]?day hike|climb)/i.test(text)) {
      return "hard";
    }
    if (/(snorkel|snorkeling|trail|hike|road to hana|scenic drive|kayak|surf|adventure)/i.test(text)) {
      return "moderate";
    }
    if (/(museum|gallery|food|market|beach|relax|family|beginner|walk|city tour|boat tour)/i.test(text)) {
      return "easy";
    }

    return category === "adventure" || category === "hiking" || category === "snorkeling"
      ? "moderate"
      : "easy";
  }

  private _selectTimeSourceLinks({
    sourceLinks,
    bestTimeOfDay,
  }: {
    sourceLinks: Array<{ title: string; url: string; snippet?: string | null }>;
    bestTimeOfDay: "morning" | "afternoon" | "evening" | "any";
  }): Array<{ title: string; url: string; snippet?: string | null }> {
    if (!sourceLinks.length) return [];
    if (bestTimeOfDay === "any") return sourceLinks.slice(0, 2);

    const keywords: Record<"morning" | "afternoon" | "evening", string[]> = {
      morning: ["morning", "early", "sunrise", "calm", "before noon"],
      afternoon: ["afternoon", "midday", "noon"],
      evening: ["evening", "sunset", "night"],
    };
    const matched = sourceLinks.filter((link) => {
      const text = `${link.title} ${link.snippet || ""}`.toLowerCase();
      return keywords[bestTimeOfDay].some((keyword) => text.includes(keyword));
    });

    return (matched.length > 0 ? matched : sourceLinks).slice(0, 2);
  }

  private _inferTimeHints({
    title,
    category,
    whyItMatches,
    bestForDates,
    reviewSummary,
    sourceLinks,
  }: {
    title: string;
    category: string;
    whyItMatches: string;
    bestForDates: string;
    reviewSummary: string;
    sourceLinks: Array<{ title: string; url: string; snippet?: string | null }>;
  }): {
    bestTimeOfDay: "morning" | "afternoon" | "evening" | "any";
    timeReason: string | null;
    timeSourceLinks: Array<{ title: string; url: string; snippet?: string | null }>;
  } {
    const text = `${title} ${category} ${whyItMatches} ${bestForDates} ${reviewSummary}`.toLowerCase();

    let bestTimeOfDay: "morning" | "afternoon" | "evening" | "any" = "any";
    let timeReason: string | null = null;

    if (/(sunrise|early|before noon|quiet morning|calm water|avoid crowds early)/i.test(text)) {
      bestTimeOfDay = "morning";
      timeReason = "Best done early for calmer conditions and lower crowds.";
    } else if (/(sunset|night|stargazing|evening show|dinner)/i.test(text)) {
      bestTimeOfDay = "evening";
      timeReason = "Best done later in the day for sunset/night conditions.";
    } else if (/(snorkel|snorkeling|hike|trail|road to hana|scenic drive)/i.test(text)) {
      bestTimeOfDay = "morning";
      timeReason = "Typically better in the morning for weather, water, and traffic.";
    } else if (/(museum|gallery|market|shopping|city walk)/i.test(text)) {
      bestTimeOfDay = "afternoon";
      timeReason = "Usually easiest to fit in the afternoon.";
    }

    return {
      bestTimeOfDay,
      timeReason,
      timeSourceLinks: this._selectTimeSourceLinks({ sourceLinks, bestTimeOfDay }),
    };
  }

  private async _deriveRouteEndpoints({
    geocodingService,
    optionTitle,
    destinationName,
  }: {
    geocodingService: ReturnType<typeof getGeocodingService>;
    optionTitle: string;
    destinationName: string;
  }): Promise<{ startCoordinates: { lat: number; lng: number } | null; endCoordinates: { lat: number; lng: number } | null }> {
    const normalizedTitle = optionTitle.toLowerCase();
    const isRoadToHana =
      normalizedTitle.includes("road to hana") || normalizedTitle.includes("hana highway");

    const startQuery = isRoadToHana
      ? `Kahului Airport, Maui`
      : `${optionTitle} start point, ${destinationName}`;
    const endQuery = isRoadToHana
      ? `Hana, Maui`
      : `${optionTitle} end point, ${destinationName}`;

    const [startCoordinates, endCoordinates] = await Promise.all([
      geocodingService.geocode(startQuery),
      geocodingService.geocode(endQuery),
    ]);

    return { startCoordinates, endCoordinates };
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

    let geocodingService: ReturnType<typeof getGeocodingService> | null = null;
    let destinationCoords: { lat: number; lng: number } | null = null;
    try {
      geocodingService = getGeocodingService();
      destinationCoords = await geocodingService.geocode(destinationName);
    } catch {
      geocodingService = null;
      destinationCoords = null;
    }

    const popularOptions = await Promise.all(
      brief.popularOptions.map(async (option) => {
        try {
          const inferredLocationMode = option.locationMode || this._inferLocationMode(option);
          const inferredTime = this._inferTimeHints({
            title: option.title,
            category: option.category,
            whyItMatches: option.whyItMatches,
            bestForDates: option.bestForDates,
            reviewSummary: option.reviewSummary,
            sourceLinks: option.sourceLinks || [],
          });
          const inferredEstimatedDuration = this._inferEstimatedDuration({
            title: option.title,
            category: option.category,
            whyItMatches: option.whyItMatches,
            bestForDates: option.bestForDates,
            reviewSummary: option.reviewSummary,
          });
          const inferredDifficulty = this._inferDifficultyLevel({
            title: option.title,
            category: option.category,
            whyItMatches: option.whyItMatches,
            bestForDates: option.bestForDates,
            reviewSummary: option.reviewSummary,
          });

          const searchQuery = `${option.title}, ${destinationName}`;
          let places = await placesClient.searchPlaces(searchQuery, destinationCoords, 50000);
          if (!places.length) {
            places = await placesClient.searchPlaces(searchQuery);
          }

          if (!places.length && option.title.includes(" ")) {
            // Fallback 1: Remove words like "Tour", "Trip", "Experience", "Class"
            const cleanedTitle = option.title.replace(/\b(Tour|Trip|Experience|Class|Activity|Ticket)\b/gi, "").trim();
            if (cleanedTitle && cleanedTitle !== option.title) {
              const cleanedQuery = `${cleanedTitle}, ${destinationName}`;
              places = await placesClient.searchPlaces(cleanedQuery, destinationCoords, 50000);
              if (!places.length) places = await placesClient.searchPlaces(cleanedQuery);
            }
          }

          if (!places.length && option.title.includes(" ")) {
            // Fallback 2: Take just the first 2-3 words of the title
            const shortTitle = option.title.split(" ").slice(0, 3).join(" ");
            if (shortTitle && shortTitle !== option.title) {
              const shortQuery = `${shortTitle}, ${destinationName}`;
              places = await placesClient.searchPlaces(shortQuery, destinationCoords, 50000);
              if (!places.length) places = await placesClient.searchPlaces(shortQuery);
            }
          }

          const placeId = places[0]?.place_id || null;
          let startCoordinates = option.startCoordinates || null;
          let endCoordinates = option.endCoordinates || null;
          if (inferredLocationMode === "route" && geocodingService) {
            const derived = await this._deriveRouteEndpoints({
              geocodingService,
              optionTitle: option.title,
              destinationName,
            });
            startCoordinates = startCoordinates || derived.startCoordinates;
            endCoordinates = endCoordinates || derived.endCoordinates;
          }

          if (!placeId) {
            return {
              ...option,
              photoUrls: option.photoUrls || [],
              estimatedDuration: option.estimatedDuration || inferredEstimatedDuration,
              difficultyLevel: option.difficultyLevel || inferredDifficulty,
              bestTimeOfDay: option.bestTimeOfDay || inferredTime.bestTimeOfDay,
              timeReason: option.timeReason || inferredTime.timeReason,
              timeSourceLinks: option.timeSourceLinks || inferredTime.timeSourceLinks,
              locationMode: inferredLocationMode,
              startCoordinates,
              endCoordinates,
              coordinates: option.coordinates || (inferredLocationMode === "route" ? startCoordinates : null),
            };
          }

          const photoUrls = await placesClient.getPlacePhotoUrlsFromId(placeId, 320);
          const placeCoordinates = places[0]?.location || null;
          return {
            ...option,
            photoUrls: photoUrls.slice(0, 3),
            estimatedDuration: option.estimatedDuration || inferredEstimatedDuration,
            difficultyLevel: option.difficultyLevel || inferredDifficulty,
            bestTimeOfDay: option.bestTimeOfDay || inferredTime.bestTimeOfDay,
            timeReason: option.timeReason || inferredTime.timeReason,
            timeSourceLinks: option.timeSourceLinks || inferredTime.timeSourceLinks,
            locationMode: inferredLocationMode,
            startCoordinates,
            endCoordinates,
            coordinates:
              inferredLocationMode === "route"
                ? startCoordinates || placeCoordinates || null
                : placeCoordinates || option.coordinates || null,
            place_id: placeId,
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
          const coordinates = this._asCoordinates(opt.coordinates);
          const startCoordinates = this._asCoordinates(opt.startCoordinates);
          const endCoordinates = this._asCoordinates(opt.endCoordinates);
          const rawLocationMode = typeof opt.locationMode === "string" ? opt.locationMode : null;
          const inferredLocationMode = this._inferLocationMode({
            title: typeof opt.title === "string" ? opt.title : "",
            category: typeof opt.category === "string" ? opt.category : "other",
          });
          const locationMode =
            rawLocationMode === "route" || rawLocationMode === "area" || rawLocationMode === "point"
              ? rawLocationMode
              : inferredLocationMode;
          const sourceLinksForTiming = sourceLinks;
          const inferredTime = this._inferTimeHints({
            title: typeof opt.title === "string" ? opt.title : "",
            category: typeof opt.category === "string" ? opt.category : "other",
            whyItMatches: typeof opt.whyItMatches === "string" ? opt.whyItMatches : "",
            bestForDates: typeof opt.bestForDates === "string" ? opt.bestForDates : "",
            reviewSummary: typeof opt.reviewSummary === "string" ? opt.reviewSummary : "",
            sourceLinks: sourceLinksForTiming,
          });
          const inferredDifficulty = this._inferDifficultyLevel({
            title: typeof opt.title === "string" ? opt.title : "",
            category: typeof opt.category === "string" ? opt.category : "other",
            whyItMatches: typeof opt.whyItMatches === "string" ? opt.whyItMatches : "",
            bestForDates: typeof opt.bestForDates === "string" ? opt.bestForDates : "",
            reviewSummary: typeof opt.reviewSummary === "string" ? opt.reviewSummary : "",
          });
          const inferredEstimatedDuration = this._inferEstimatedDuration({
            title: typeof opt.title === "string" ? opt.title : "",
            category: typeof opt.category === "string" ? opt.category : "other",
            whyItMatches: typeof opt.whyItMatches === "string" ? opt.whyItMatches : "",
            bestForDates: typeof opt.bestForDates === "string" ? opt.bestForDates : "",
            reviewSummary: typeof opt.reviewSummary === "string" ? opt.reviewSummary : "",
          });
          const estimatedDuration = this._normalizeEstimatedDuration(opt.estimatedDuration) || inferredEstimatedDuration;
          const rawDifficultyLevel = opt.difficultyLevel;
          const hasExplicitDifficultyLevel =
            rawDifficultyLevel === "easy" ||
            rawDifficultyLevel === "moderate" ||
            rawDifficultyLevel === "hard";
          const difficultyLevel = this._normalizeDifficultyLevel(rawDifficultyLevel);
          const rawBestTimeOfDay = opt.bestTimeOfDay;
          const hasExplicitBestTimeOfDay =
            rawBestTimeOfDay === "morning" ||
            rawBestTimeOfDay === "afternoon" ||
            rawBestTimeOfDay === "evening" ||
            rawBestTimeOfDay === "any";
          const bestTimeOfDay = this._normalizeBestTimeOfDay(rawBestTimeOfDay);
          const timeSourceLinksRaw = Array.isArray(opt.timeSourceLinks) ? opt.timeSourceLinks : [];
          const timeSourceLinks = timeSourceLinksRaw
            .map((source) => {
              const s = (source || {}) as Record<string, unknown>;
              if (typeof s.url !== "string" || !s.url.trim()) return null;
              return {
                title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : "Source",
                url: s.url.trim(),
                snippet: typeof s.snippet === "string" ? s.snippet.trim() : null,
              };
            })
            .filter((value): value is { title: string; url: string; snippet: string | null } => Boolean(value))
            .slice(0, 3);

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
            estimatedDuration,
            sourceLinks,
            photoUrls,
            difficultyLevel: hasExplicitDifficultyLevel ? difficultyLevel : inferredDifficulty,
            bestTimeOfDay: hasExplicitBestTimeOfDay ? bestTimeOfDay : inferredTime.bestTimeOfDay,
            timeReason:
              typeof opt.timeReason === "string" && opt.timeReason.trim()
                ? opt.timeReason.trim()
                : inferredTime.timeReason,
            timeSourceLinks: timeSourceLinks.length > 0 ? timeSourceLinks : inferredTime.timeSourceLinks,
            locationMode,
            startCoordinates,
            endCoordinates,
            coordinates:
              coordinates ||
              (locationMode === "route" ? startCoordinates : null),
            place_id: typeof opt.place_id === "string" ? opt.place_id : null,
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

  private _normalizeLookupText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private _buildCompactResearchOptions({
    tripResearchBrief,
    researchOptionSelections,
  }: {
    tripResearchBrief: TripResearchBrief;
    researchOptionSelections: Record<string, ResearchOptionPreference>;
  }) {
    return (tripResearchBrief.popularOptions || []).map((option) => ({
      id: option.id,
      title: option.title,
      category: option.category,
      selection: researchOptionSelections[option.id] || "maybe",
      sourceLinkCount: option.sourceLinks?.length || 0,
      whyItMatches: option.whyItMatches,
      bestForDates: option.bestForDates,
      reviewSummary: option.reviewSummary,
    }));
  }

  private _extractFunctionCallsFromResponse(response: OpenAI.Responses.Response): OpenAI.Responses.ResponseFunctionToolCall[] {
    return (response.output || []).filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
    );
  }

  private async generateAdditionalResearchOptionsWithWebSearch({
    tripInfo,
    currentBrief,
    userRequest,
    count,
    category,
  }: {
    tripInfo: TripInfo;
    currentBrief: TripResearchBrief;
    userRequest: string;
    count: number;
    category?: ResearchCategory;
  }): Promise<{
    success: boolean;
    message: string;
    options: TripResearchBrief["popularOptions"];
  }> {
    const clampedCount = Math.max(1, Math.min(5, count));
    const input = buildAdditionalResearchOptionsInput({
      tripInfo,
      currentOptionTitles: currentBrief.popularOptions.map((option) => option.title),
      userRequest,
      count: clampedCount,
      category,
    });

    try {
      const response = await this.openai.responses.create({
        model: this.model,
        instructions: SYSTEM_PROMPTS.INITIAL_RESEARCH_ADD_OPTIONS,
        input,
        temperature: this.temperature,
        tools: [{ type: "web_search_preview", search_context_size: "high" }],
        tool_choice: "auto",
        text: {
          format: {
            type: "json_schema",
            name: "additional_research_options_response",
            strict: true,
            schema: ADDITIONAL_RESEARCH_OPTIONS_JSON_SCHEMA,
          },
        },
      });

      const parsed = this._parseResearchResponseJson(response);
      const normalizedBrief = this._normalizeTripResearchBrief({
        popularOptions: parsed.popularOptions,
        assumptions: [],
        openQuestions: [],
        dateNotes: [],
      });
      const citations = this._extractUrlCitationsFromResponse(response);
      const mergedBrief = this._mergeCitationLinksIntoBrief({
        brief: normalizedBrief,
        citations,
      });
      const enrichedBrief = await this._enrichResearchBriefWithPlacePhotos({
        brief: mergedBrief,
        destination: tripInfo.destination,
      });

      const existingTitles = new Set(
        currentBrief.popularOptions.map((option) => this._normalizeLookupText(option.title))
      );
      const uniqueOptions: TripResearchBrief["popularOptions"] = [];

      for (const option of enrichedBrief.popularOptions) {
        const normalizedTitle = this._normalizeLookupText(option.title);
        if (!normalizedTitle || existingTitles.has(normalizedTitle)) continue;
        if (!option.sourceLinks || option.sourceLinks.length === 0) continue;
        uniqueOptions.push(option);
        existingTitles.add(normalizedTitle);
        if (uniqueOptions.length >= clampedCount) break;
      }

      return {
        success: true,
        message: typeof parsed.message === "string" ? parsed.message : "I found additional options.",
        options: uniqueOptions,
      };
    } catch (error) {
      console.error("Error in generateAdditionalResearchOptionsWithWebSearch:", error);
      return {
        success: false,
        message: "I couldn't fetch additional options right now.",
        options: [],
      };
    }
  }

  private async _executeAddResearchOptionsTool({
    rawArgs,
    state,
    tripInfo,
  }: {
    rawArgs: unknown;
    state: ResearchToolState;
    tripInfo: TripInfo;
  }): Promise<{ result: ToolExecutionResult; nextState: ResearchToolState }> {
    const parsedArgs = addResearchOptionsArgsSchema.safeParse(rawArgs);
    if (!parsedArgs.success) {
      console.warn("[initial-research-agent] add_research_options validation failed", parsedArgs.error.flatten());
      return {
        result: {
          toolName: "add_research_options",
          ok: false,
          status: "error",
          message: "Invalid arguments for add_research_options.",
          details: { issues: parsedArgs.error.issues.map((issue) => issue.message) },
        },
        nextState: state,
      };
    }

    const count = Math.max(1, Math.min(5, parsedArgs.data.count ?? 3));
    const generation = await this.generateAdditionalResearchOptionsWithWebSearch({
      tripInfo,
      currentBrief: state.tripResearchBrief,
      userRequest: parsedArgs.data.request,
      count,
      category: parsedArgs.data.category,
    });

    if (!generation.success) {
      return {
        result: {
          toolName: "add_research_options",
          ok: false,
          status: "error",
          message: generation.message,
        },
        nextState: state,
      };
    }

    if (generation.options.length === 0) {
      return {
        result: {
          toolName: "add_research_options",
          ok: true,
          status: "not_found",
          message: "No distinct new options matched your request.",
        },
        nextState: state,
      };
    }

    // Additional-options generation often reuses generic ids (e.g., opt1..opt4).
    // If a reused id points to a different title/category, treat it as a new card by assigning a new id.
    const existingById = new Map(
      state.tripResearchBrief.popularOptions.map((option) => [option.id, option])
    );
    const seenIds = new Set(state.tripResearchBrief.popularOptions.map((option) => option.id));
    const withStableUniqueIds = generation.options.map((option, index) => {
      const existing = existingById.get(option.id);
      const sameEntity =
        Boolean(existing) &&
        existing?.category === option.category &&
        this._normalizeLookupText(existing?.title || "") === this._normalizeLookupText(option.title);

      if (!seenIds.has(option.id) || sameEntity) {
        seenIds.add(option.id);
        return option;
      }

      const base = option.id.trim() || `opt${state.tripResearchBrief.popularOptions.length + index + 1}`;
      let nextId = `${base}-add1`;
      let suffix = 1;
      while (seenIds.has(nextId)) {
        suffix += 1;
        nextId = `${base}-add${suffix}`;
      }
      seenIds.add(nextId);
      return { ...option, id: nextId };
    });

    const merged = mergeResearchBriefAndSelections({
      currentBrief: state.tripResearchBrief,
      currentSelections: state.researchOptionSelections,
      incomingBrief: {
        ...state.tripResearchBrief,
        popularOptions: withStableUniqueIds,
      },
    });

    return {
      result: {
        toolName: "add_research_options",
        ok: true,
        status: "success",
        message: generation.message,
        details: {
          addedCount: withStableUniqueIds.length,
          addedOptionIds: withStableUniqueIds.map((option) => option.id),
        },
      },
      nextState: {
        tripResearchBrief: merged.tripResearchBrief,
        researchOptionSelections: merged.researchOptionSelections,
      },
    };
  }

  private async _executeRemoveResearchOptionTool({
    rawArgs,
    state,
  }: {
    rawArgs: unknown;
    state: ResearchToolState;
  }): Promise<{ result: ToolExecutionResult; nextState: ResearchToolState }> {
    const parsedArgs = removeResearchOptionArgsSchema.safeParse(rawArgs);
    if (!parsedArgs.success) {
      console.warn("[initial-research-agent] remove_research_option validation failed", parsedArgs.error.flatten());
      return {
        result: {
          toolName: "remove_research_option",
          ok: false,
          status: "error",
          message: "Invalid arguments for remove_research_option.",
          details: { issues: parsedArgs.error.issues.map((issue) => issue.message) },
        },
        nextState: state,
      };
    }

    const byId = parsedArgs.data.option_id
      ? state.tripResearchBrief.popularOptions.filter((option) => option.id === parsedArgs.data.option_id)
      : [];

    const normalizedTitle = parsedArgs.data.option_title
      ? this._normalizeLookupText(parsedArgs.data.option_title)
      : "";

    const exactTitleMatches = normalizedTitle
      ? state.tripResearchBrief.popularOptions.filter(
        (option) => this._normalizeLookupText(option.title) === normalizedTitle
      )
      : [];

    const substringMatches =
      normalizedTitle && byId.length === 0 && exactTitleMatches.length === 0
        ? state.tripResearchBrief.popularOptions.filter((option) => {
          const candidate = this._normalizeLookupText(option.title);
          return candidate.includes(normalizedTitle) || normalizedTitle.includes(candidate);
        })
        : [];

    const matches = byId.length > 0 ? byId : exactTitleMatches.length > 0 ? exactTitleMatches : substringMatches;

    if (matches.length === 0) {
      const nearMatches =
        normalizedTitle.length > 0
          ? state.tripResearchBrief.popularOptions
            .filter((option) => {
              const title = this._normalizeLookupText(option.title);
              return normalizedTitle
                .split(" ")
                .filter((token) => token.length > 2)
                .some((token) => title.includes(token));
            })
            .slice(0, 5)
            .map((option) => ({ id: option.id, title: option.title }))
          : [];

      return {
        result: {
          toolName: "remove_research_option",
          ok: true,
          status: "not_found",
          message: "I couldn't find a matching card to remove.",
          details: { nearMatches },
        },
        nextState: state,
      };
    }

    if (matches.length > 1) {
      return {
        result: {
          toolName: "remove_research_option",
          ok: true,
          status: "ambiguous",
          message: "Multiple cards match this request. Ask the user to pick one.",
          details: {
            candidates: matches.slice(0, 5).map((option) => ({ id: option.id, title: option.title })),
          },
        },
        nextState: state,
      };
    }

    const target = matches[0];
    const nextBrief: TripResearchBrief = {
      ...state.tripResearchBrief,
      popularOptions: state.tripResearchBrief.popularOptions.filter((option) => option.id !== target.id),
    };
    const nextSelections = { ...state.researchOptionSelections };
    delete nextSelections[target.id];

    return {
      result: {
        toolName: "remove_research_option",
        ok: true,
        status: "success",
        message: `Removed ${target.title}.`,
        details: { removedOptionId: target.id, removedTitle: target.title },
      },
      nextState: {
        tripResearchBrief: nextBrief,
        researchOptionSelections: nextSelections,
      },
    };
  }

  private async _executeInitialResearchToolCall({
    toolCall,
    state,
    tripInfo,
  }: {
    toolCall: OpenAI.Responses.ResponseFunctionToolCall;
    state: ResearchToolState;
    tripInfo: TripInfo;
  }): Promise<{ result: ToolExecutionResult; nextState: ResearchToolState }> {
    let parsedArgs: unknown = {};
    try {
      parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
    } catch {
      return {
        result: {
          toolName: (toolCall.name as InitialResearchToolName) || "add_research_options",
          ok: false,
          status: "error",
          message: "Tool arguments were not valid JSON.",
        },
        nextState: state,
      };
    }

    if (toolCall.name === "add_research_options") {
      return this._executeAddResearchOptionsTool({ rawArgs: parsedArgs, state, tripInfo });
    }

    if (toolCall.name === "remove_research_option") {
      return this._executeRemoveResearchOptionTool({ rawArgs: parsedArgs, state });
    }

    return {
      result: {
        toolName: "add_research_options",
        ok: false,
        status: "error",
        message: `Unknown tool: ${toolCall.name}`,
      },
      nextState: state,
    };
  }

  async runInitialResearchDebriefAgent({
    tripInfo,
    currentBrief,
    researchOptionSelections,
    conversationHistory,
    userMessage,
  }: {
    tripInfo: TripInfo;
    currentBrief: TripResearchBrief;
    researchOptionSelections: Record<string, ResearchOptionPreference>;
    conversationHistory: ConversationMessage[];
    userMessage: string;
  }): Promise<InitialResearchAgentResult> {
    let state: ResearchToolState = {
      tripResearchBrief: currentBrief,
      researchOptionSelections: { ...researchOptionSelections },
    };

    let previousResponseId: string | undefined;
    let input: string | Array<Record<string, unknown>> = buildInitialResearchDebriefAgentInput({
      tripInfo,
      compactBriefOptions: this._buildCompactResearchOptions({
        tripResearchBrief: state.tripResearchBrief,
        researchOptionSelections: state.researchOptionSelections,
      }),
      openQuestions: state.tripResearchBrief.openQuestions || [],
      recentConversation: conversationHistory.slice(-10),
      userMessage,
    });

    try {
      for (let iteration = 1; iteration <= MAX_INITIAL_RESEARCH_TOOL_STEPS; iteration += 1) {
        const response = await this.openai.responses.create({
          model: this.model,
          instructions: SYSTEM_PROMPTS.INITIAL_RESEARCH_TOOL_ROUTER,
          input: input as unknown as OpenAI.Responses.ResponseInput,
          previous_response_id: previousResponseId,
          temperature: this.temperature,
          tools: INITIAL_RESEARCH_TOOLS as unknown as OpenAI.Responses.Tool[],
          tool_choice: "auto",
          parallel_tool_calls: false,
        });

        previousResponseId = response.id;
        const functionCalls = this._extractFunctionCallsFromResponse(response);
        console.log(`[initial-research-agent] iteration=${iteration} function_calls=${functionCalls.length}`);

        if (functionCalls.length === 0) {
          const finalMessage =
            (typeof response.output_text === "string" && response.output_text.trim()) ||
            "I updated your research brief.";
          return {
            success: true,
            message: finalMessage,
            tripResearchBrief: state.tripResearchBrief,
            researchOptionSelections: state.researchOptionSelections,
          };
        }

        const toolOutputs: Array<Record<string, unknown>> = [];
        for (const toolCall of functionCalls) {
          const { result, nextState } = await this._executeInitialResearchToolCall({
            toolCall,
            state,
            tripInfo,
          });
          console.log(
            `[initial-research-agent] tool=${result.toolName} validation_ok=${result.ok} status=${result.status}`
          );
          state = nextState;
          toolOutputs.push({
            type: "function_call_output",
            call_id: toolCall.call_id,
            output: JSON.stringify(result),
          });
        }

        input = toolOutputs;
      }

      return {
        success: true,
        message:
          "I applied what I could from your request. If you want another change, tell me exactly which card to update.",
        tripResearchBrief: state.tripResearchBrief,
        researchOptionSelections: state.researchOptionSelections,
      };
    } catch (error) {
      console.error("Error in runInitialResearchDebriefAgent:", error);
      return {
        success: false,
        message: "Sorry, I couldn't update the research brief right now. Please try again.",
        tripResearchBrief: state.tripResearchBrief,
        researchOptionSelections: state.researchOptionSelections,
      };
    }
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
        source: null,
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

  async searchAccommodationOffers({
    tripInfo,
    selectedActivities,
  }: {
    tripInfo: TripInfo;
    selectedActivities: SuggestedActivity[];
  }): Promise<{
    success: boolean;
    message: string;
    options: AccommodationOption[];
  }> {
    if (!tripInfo.destination || !tripInfo.startDate || !tripInfo.endDate) {
      return {
        success: false,
        message: "Destination and travel dates are required before searching accommodations.",
        options: [],
      };
    }

    const activityHints = selectedActivities
      .slice(0, 8)
      .map((activity) => `${activity.name}${activity.neighborhood ? ` (${activity.neighborhood})` : ""}`)
      .join(", ");

    const input = `Find up-to-date accommodation options for this trip using web search.

Return exactly up to 5 options in JSON.
Trip:
- Source: ${tripInfo.source || "Not specified"}
- Destination: ${tripInfo.destination}
- Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
- Travelers: ${tripInfo.travelers}
- Budget: ${tripInfo.budget || "Not specified"}
- Preferences: ${(tripInfo.preferences || []).join(", ") || "General"}
- Selected activities for area relevance: ${activityHints || "None provided"}

Rules:
- Focus on options realistically bookable for these dates.
- Prefer reputable sources and include a source URL per option when available.
- Include clear tradeoffs in pros/cons.
- Keep summaries concise and practical.`;

    try {
      const response = await this.openai.responses.create({
        model: this.model,
        input,
        temperature: this.temperature,
        tools: [{ type: "web_search_preview", search_context_size: "high" }],
        tool_choice: "auto",
        text: {
          format: {
            type: "json_schema",
            name: "accommodation_search_response",
            strict: true,
            schema: ACCOMMODATION_SEARCH_JSON_SCHEMA,
          },
        },
      });
      const parsed = this._parseResearchResponseJson(response);
      const optionsRaw = Array.isArray(parsed.options) ? parsed.options : [];
      const options: AccommodationOption[] = optionsRaw.slice(0, 5).map((raw, index) => {
        const option = (raw || {}) as Record<string, unknown>;
        return {
          id: typeof option.id === "string" && option.id.trim() ? option.id.trim() : `acc-${index + 1}`,
          name: typeof option.name === "string" ? option.name : `Accommodation ${index + 1}`,
          neighborhood: typeof option.neighborhood === "string" ? option.neighborhood : null,
          nightlyPriceEstimate:
            typeof option.nightlyPriceEstimate === "number" ? option.nightlyPriceEstimate : null,
          currency: typeof option.currency === "string" ? option.currency : "USD",
          rating: typeof option.rating === "number" ? option.rating : null,
          sourceUrl: typeof option.sourceUrl === "string" ? option.sourceUrl : null,
          summary: typeof option.summary === "string" ? option.summary : "",
          pros: Array.isArray(option.pros)
            ? option.pros.filter((value): value is string => typeof value === "string").slice(0, 4)
            : [],
          cons: Array.isArray(option.cons)
            ? option.cons.filter((value): value is string => typeof value === "string").slice(0, 4)
            : [],
        };
      });

      return {
        success: true,
        message:
          typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message
            : `Found ${options.length} accommodation options for ${tripInfo.destination}.`,
        options,
      };
    } catch (error) {
      console.error("Error in searchAccommodationOffers:", error);
      return {
        success: false,
        message: "I couldn't search accommodation options right now. Please try again.",
        options: [],
      };
    }
  }

  async searchFlightOffers({
    tripInfo,
    selectedActivities,
  }: {
    tripInfo: TripInfo;
    selectedActivities: SuggestedActivity[];
  }): Promise<{
    success: boolean;
    message: string;
    options: FlightOption[];
  }> {
    if (!tripInfo.destination || !tripInfo.startDate || !tripInfo.endDate) {
      return {
        success: false,
        message: "Destination and travel dates are required before searching flights.",
        options: [],
      };
    }

    const activityHints = selectedActivities
      .slice(0, 5)
      .map((activity) => activity.name)
      .join(", ");

    const input = `Find up-to-date flight options for this trip using web search.

Return exactly up to 5 options in JSON.
Trip:
- Source: ${tripInfo.source || "Not specified"}
- Destination: ${tripInfo.destination}
- Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
- Travelers: ${tripInfo.travelers}
- Budget: ${tripInfo.budget || "Not specified"}
- Preferences: ${(tripInfo.preferences || []).join(", ") || "General"}
- Planned activities context: ${activityHints || "None provided"}

Rules:
- Include realistic routes and fare estimates with source URLs where possible.
- Include baggage/fare caveats when source indicates restrictions.
- Summaries should explain core tradeoffs (price vs duration vs stops).`;

    try {
      const response = await this.openai.responses.create({
        model: this.model,
        input,
        temperature: this.temperature,
        tools: [{ type: "web_search_preview", search_context_size: "high" }],
        tool_choice: "auto",
        text: {
          format: {
            type: "json_schema",
            name: "flight_search_response",
            strict: true,
            schema: FLIGHT_SEARCH_JSON_SCHEMA,
          },
        },
      });
      const parsed = this._parseResearchResponseJson(response);
      const optionsRaw = Array.isArray(parsed.options) ? parsed.options : [];
      const options: FlightOption[] = optionsRaw.slice(0, 5).map((raw, index) => {
        const option = (raw || {}) as Record<string, unknown>;
        return {
          id: typeof option.id === "string" && option.id.trim() ? option.id.trim() : `flt-${index + 1}`,
          airline: typeof option.airline === "string" ? option.airline : "Unknown Airline",
          routeSummary: typeof option.routeSummary === "string" ? option.routeSummary : "",
          departureWindow: typeof option.departureWindow === "string" ? option.departureWindow : null,
          arrivalWindow: typeof option.arrivalWindow === "string" ? option.arrivalWindow : null,
          duration: typeof option.duration === "string" ? option.duration : null,
          stops: typeof option.stops === "number" ? Math.max(0, Math.floor(option.stops)) : null,
          totalPriceEstimate: typeof option.totalPriceEstimate === "number" ? option.totalPriceEstimate : null,
          currency: typeof option.currency === "string" ? option.currency : "USD",
          sourceUrl: typeof option.sourceUrl === "string" ? option.sourceUrl : null,
          summary: typeof option.summary === "string" ? option.summary : "",
          baggageNotes: typeof option.baggageNotes === "string" ? option.baggageNotes : null,
        };
      });

      return {
        success: true,
        message:
          typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message
            : `Found ${options.length} flight options for ${tripInfo.destination}.`,
        options,
      };
    } catch (error) {
      console.error("Error in searchFlightOffers:", error);
      return {
        success: false,
        message: "I couldn't search flight options right now. Please try again.",
        options: [],
      };
    }
  }

  async generateInitialResearchBrief({
    tripInfo,
    depth = "fast",
  }: {
    tripInfo: TripInfo;
    depth?: "fast" | "deep";
  }): Promise<{
    success: boolean;
    message: string;
    tripResearchBrief: TripResearchBrief | null;
  }> {
    const messages = buildInitialResearchBriefMessages({
      tripInfo,
    });

    try {
      if (depth === "fast") {
        const completion = await this.openai.chat.completions.create({
          messages,
          model: this.model,
          temperature: this.temperature,
          max_tokens: 8000,
          response_format: { type: "json_object" },
        });
        const parsed = this._parseJsonResponse(completion);
        const normalizedBrief = this._normalizeTripResearchBrief(parsed.tripResearchBrief);

        return {
          success: true,
          message:
            (typeof parsed.message === "string" && parsed.message) ||
            "I prepared an initial research brief you can refine.",
          tripResearchBrief: normalizedBrief,
        };
      }

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

  async deepResearchOption({
    tripInfo,
    option,
  }: {
    tripInfo: TripInfo;
    option: ResearchOption;
  }): Promise<{
    success: boolean;
    message: string;
    option: ResearchOption | null;
  }> {
    const input = `Deepen research for exactly one travel option using up-to-date web sources.

Trip context:
Destination: ${tripInfo.destination}
Dates: ${tripInfo.startDate} to ${tripInfo.endDate}
Duration: ${tripInfo.durationDays} days
Preferences: ${(tripInfo.preferences || []).join(", ") || "General tourism"}
Activity level: ${tripInfo.activityLevel}
Budget: ${tripInfo.budget || "Not specified"}

Current option (preserve id and title):
${JSON.stringify(option, null, 2)}

Return one improved option with stronger evidence and date fit.`;

    try {
      const response = await this.openai.responses.create({
        model: this.model,
        input,
        temperature: this.temperature,
        tools: [{ type: "web_search_preview", search_context_size: "high" }],
        tool_choice: "auto",
        text: {
          format: {
            type: "json_schema",
            name: "single_trip_research_option_response",
            strict: true,
            schema: SINGLE_RESEARCH_OPTION_JSON_SCHEMA,
          },
        },
      });

      const raw = this._parseResearchResponseJson(response);
      const normalized = this._normalizeTripResearchBrief({
        summary: "",
        dateNotes: [],
        assumptions: [],
        openQuestions: [],
        popularOptions: [raw.option],
      });
      const baseOption = normalized.popularOptions[0];
      if (!baseOption) {
        return {
          success: false,
          message: "I couldn't deepen that option right now. Please try again.",
          option: null,
        };
      }

      const citations = this._extractUrlCitationsFromResponse(response);
      const withLinks = this._mergeCitationLinksIntoBrief({
        brief: {
          summary: "",
          dateNotes: [],
          assumptions: [],
          openQuestions: [],
          popularOptions: [baseOption],
        },
        citations,
      });
      const withPhotos = await this._enrichResearchBriefWithPlacePhotos({
        brief: withLinks,
        destination: tripInfo.destination,
      });

      const enriched = withPhotos.popularOptions[0] || baseOption;

      return {
        success: true,
        message:
          (typeof raw.message === "string" && raw.message.trim()) ||
          `I ran deeper research on ${option.title}.`,
        option: {
          ...enriched,
          id: option.id,
          title: option.title,
          category: option.category,
        },
      };
    } catch (error) {
      console.error("Error in deepResearchOption:", error);
      return {
        success: false,
        message: "Sorry, I couldn't run deep research for that option. Please try again.",
        option: null,
      };
    }
  }

  async enrichResearchBriefPhotos({
    tripInfo,
    brief,
  }: {
    tripInfo: TripInfo;
    brief: TripResearchBrief;
  }): Promise<{
    success: boolean;
    tripResearchBrief: TripResearchBrief | null;
  }> {
    try {
      const enrichedBrief = await this._enrichResearchBriefWithPlacePhotos({
        brief,
        destination: tripInfo.destination,
      });
      return {
        success: true,
        tripResearchBrief: enrichedBrief,
      };
    } catch (error) {
      console.error("Error in enrichResearchBriefPhotos:", error);
      return {
        success: false,
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
