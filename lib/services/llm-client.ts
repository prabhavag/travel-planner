import OpenAI from "openai";
import {
  type TripInfo,
  type ExpandedDay,
  type SuggestedActivity,
  type DayGroup,
} from "@/lib/models/travel-plan";
import {
  buildInfoGatheringMessages,
  buildReviewMessages,
  buildSuggestTopActivitiesMessages,
  buildGroupActivitiesMessages,
  buildRegenerateDayThemeMessages,
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
    expandedDays,
    userMessage,
    conversationHistory,
  }: {
    tripInfo: TripInfo;
    expandedDays: Record<number, ExpandedDay>;
    userMessage: string;
    conversationHistory?: ConversationMessage[];
  }) {
    const messages = buildReviewMessages({
      tripInfo,
      expandedDays,
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

  async suggestTopActivities({ tripInfo }: { tripInfo: TripInfo }): Promise<{
    success: boolean;
    message: string;
    activities: SuggestedActivity[];
  }> {
    const messages = buildSuggestTopActivitiesMessages({ tripInfo });

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
        activities: response.activities || [],
      };
    } catch (error) {
      console.error("Error suggesting top activities:", error);
      return {
        success: false,
        message: "Sorry, I couldn't generate activity suggestions. Please try again.",
        activities: [],
      };
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
