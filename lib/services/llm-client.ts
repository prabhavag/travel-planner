import OpenAI from "openai";
import { TravelPlanSchema, type TripInfo, type SkeletonDay, type ExpandedDay, type DaySuggestions } from "@/lib/models/travel-plan";
import {
  buildTravelPlanPrompt,
  buildModifyItineraryMessages,
  getWelcomeResponse,
  SYSTEM_PROMPTS,
  buildInfoGatheringMessages,
  buildSkeletonMessages,
  buildSuggestActivitiesMessages,
  buildExpandDayFromSelectionsMessages,
  buildExpandDayMessages,
  buildModifyDayMessages,
  buildReviewMessages,
  buildFinalizeMessages,
} from "./prompts";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0.7;

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

  private _parseAndValidateResponse(completion: OpenAI.Chat.Completions.ChatCompletion) {
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from LLM");
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      throw new Error(`Failed to parse LLM response as JSON: ${(parseError as Error).message}`);
    }

    const validation = TravelPlanSchema.safeParse(parsed);
    if (!validation.success) {
      console.warn("LLM response validation warnings:", validation.error.issues);
    }

    return validation.success ? validation.data : parsed;
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

  async generateTravelPlan({
    destination,
    start_date,
    end_date,
    duration_days,
    interest_categories,
    activity_level,
  }: {
    destination?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    duration_days?: number | null;
    interest_categories?: string[];
    activity_level?: string;
  }) {
    if (!destination && !start_date && !end_date) {
      return getWelcomeResponse();
    }

    const prompt = buildTravelPlanPrompt({
      destination,
      start_date,
      end_date,
      duration_days,
      interest_categories,
      activity_level,
    });

    try {
      const completion = await this.openai.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPTS.TRAVEL_PLANNER },
          { role: "user", content: prompt },
        ],
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      });

      return this._parseAndValidateResponse(completion);
    } catch (error) {
      console.error("Error generating travel plan:", error);
      throw error;
    }
  }

  async modifyItinerary(
    currentPlan: unknown,
    userMessage: string,
    conversationHistory: ConversationMessage[],
    finalize: boolean = false
  ) {
    const messages = buildModifyItineraryMessages({
      currentPlan,
      userMessage,
      conversationHistory,
      finalize,
    });

    try {
      const completion = await this.openai.chat.completions.create({
        messages: messages,
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      });

      let modifiedPlan = this._parseAndValidateResponse(completion);

      if (modifiedPlan.transportation && !Array.isArray(modifiedPlan.transportation)) {
        modifiedPlan.transportation = [modifiedPlan.transportation];
      }

      const mergedPlan = { ...(currentPlan as Record<string, unknown>), ...modifiedPlan };

      return {
        success: true,
        plan: mergedPlan,
        message: modifiedPlan.summary || "Itinerary updated!",
      };
    } catch (error) {
      console.error("Error modifying itinerary:", error);
      return {
        success: false,
        plan: currentPlan,
        message: "Sorry, something went wrong while updating the itinerary. Please try again.",
      };
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
        interests: [],
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

  async generateSkeleton({ tripInfo }: { tripInfo: TripInfo }) {
    const messages = buildSkeletonMessages({ tripInfo });

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
        skeleton: response.skeleton,
      };
    } catch (error) {
      console.error("Error generating skeleton:", error);
      return {
        success: false,
        message: "Sorry, I couldn't generate the trip overview. Please try again.",
        skeleton: null,
      };
    }
  }

  async suggestActivities({
    tripInfo,
    skeletonDay,
    userMessage,
  }: {
    tripInfo: TripInfo;
    skeletonDay: SkeletonDay;
    userMessage?: string;
  }) {
    const messages = buildSuggestActivitiesMessages({
      tripInfo,
      skeletonDay,
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
        suggestions: response.suggestions,
      };
    } catch (error) {
      console.error("Error suggesting activities:", error);
      return {
        success: false,
        message: "Sorry, I couldn't generate activity suggestions. Please try again.",
        suggestions: null,
      };
    }
  }

  async expandDayFromSelections({
    tripInfo,
    skeletonDay,
    selections,
    suggestions,
  }: {
    tripInfo: TripInfo;
    skeletonDay: SkeletonDay;
    selections: Record<string, unknown>;
    suggestions: DaySuggestions;
  }) {
    const messages = buildExpandDayFromSelectionsMessages({
      tripInfo,
      skeletonDay,
      selections,
      suggestions,
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
        expandedDay: response.expandedDay,
        suggestModifications: response.suggestModifications,
      };
    } catch (error) {
      console.error("Error expanding day from selections:", error);
      return {
        success: false,
        message: "Sorry, I couldn't create the day plan. Please try again.",
        expandedDay: null,
      };
    }
  }

  async expandDay({
    tripInfo,
    skeletonDay,
    userMessage,
    conversationHistory,
  }: {
    tripInfo: TripInfo;
    skeletonDay: SkeletonDay;
    userMessage?: string;
    conversationHistory?: ConversationMessage[];
  }) {
    const messages = buildExpandDayMessages({
      tripInfo,
      skeletonDay,
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
        expandedDay: response.expandedDay,
        suggestModifications: response.suggestModifications,
      };
    } catch (error) {
      console.error("Error expanding day:", error);
      return {
        success: false,
        message: "Sorry, I couldn't expand this day. Please try again.",
        expandedDay: null,
      };
    }
  }

  async modifyDay({
    tripInfo,
    currentDay,
    userMessage,
    conversationHistory,
  }: {
    tripInfo: TripInfo;
    currentDay: ExpandedDay;
    userMessage: string;
    conversationHistory?: ConversationMessage[];
  }) {
    const messages = buildModifyDayMessages({
      tripInfo,
      currentDay,
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
        expandedDay: response.expandedDay,
        suggestModifications: response.suggestModifications,
      };
    } catch (error) {
      console.error("Error modifying day:", error);
      return {
        success: false,
        message: "Sorry, I couldn't modify this day. Please try again.",
        expandedDay: currentDay,
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

  async finalizePlan({
    tripInfo,
    expandedDays,
  }: {
    tripInfo: TripInfo;
    expandedDays: Record<number, ExpandedDay>;
  }) {
    const messages = buildFinalizeMessages({
      tripInfo,
      expandedDays,
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
        finalPlan: response.finalPlan,
      };
    } catch (error) {
      console.error("Error finalizing plan:", error);
      return {
        success: false,
        message: "Sorry, I couldn't finalize the itinerary. Please try again.",
        finalPlan: null,
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
