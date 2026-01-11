import OpenAI from "openai";
import {
  type TripInfo,
  type SuggestedActivity,
  type DayGroup,
  type GroupedDay,
} from "@/lib/models/travel-plan";
import {
  buildInfoGatheringMessages,
  buildReviewMessages,
  buildSuggestTopActivitiesMessages,
  buildGroupActivitiesMessages,
  buildRegenerateDayThemeMessages,
  buildSuggestActivitiesChatMessages,
} from "./prompts";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0.5;

interface LLMClientOptions {
  model?: string;
  temperature?: number;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

class LLMClient {
  private openai: OpenAI;
  private model: string;
  private temperature: number;

  constructor(options: LLMClientOptions = {}) {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("LLM API key not configured");
    }

    this.openai = new OpenAI({ apiKey });
    this.model = options.model || process.env.LLM_MODEL || DEFAULT_MODEL;
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

  async gatherInfo({
    tripInfo,
    userMessage,
    conversationHistory,
  }: {
    tripInfo: TripInfo | null;
    userMessage: string;
    conversationHistory: ConversationMessage[];
  }) {
    const messages = buildInfoGatheringMessages({
      tripInfo,
      userMessage,
      conversationHistory,
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
    conversationHistory,
  }: {
    tripInfo: TripInfo;
    groupedDays: GroupedDay[];
    userMessage: string;
    conversationHistory?: ConversationMessage[];
  }) {
    const messages = buildReviewMessages({
      tripInfo,
      groupedDays,
      userMessage,
      conversationHistory,
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

  async *suggestTopActivities({ tripInfo }: { tripInfo: TripInfo }): AsyncGenerator<
    | { type: "message"; message: string }
    | { type: "activity"; activity: SuggestedActivity }
    | { type: "complete" }
    | { type: "error"; message: string }
  > {
    const messages = buildSuggestTopActivitiesMessages({ tripInfo });
    console.log("Suggesting top activities with messages:", messages);

    try {
      const stream = await this.openai.chat.completions.create({
        messages,
        model: this.model,
        temperature: this.temperature,
        stream: true,
        // Note: No response_format since JSONL is not valid JSON
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
                yield { type: "activity", activity: parsed as SuggestedActivity };
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
            yield { type: "activity", activity: parsed as SuggestedActivity };
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
    conversationHistory,
  }: {
    tripInfo: TripInfo;
    suggestedActivities: SuggestedActivity[];
    selectedActivityIds: string[];
    userMessage: string;
    conversationHistory: ConversationMessage[];
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
      conversationHistory,
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
        newActivities: response.newActivities || [],
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
