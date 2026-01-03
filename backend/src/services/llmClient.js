const OpenAI = require('openai');
const { TravelPlanSchema } = require('../models/travelPlan');
const {
    buildTravelPlanPrompt,
    buildModifyItineraryMessages,
    getWelcomeResponse,
    SYSTEM_PROMPTS,
    // New workflow message builders
    buildInfoGatheringMessages,
    buildSkeletonMessages,
    buildSuggestActivitiesMessages,
    buildSuggestDayMessages,
    buildExpandDayFromSelectionsMessages,
    buildExpandDayMessages,
    buildModifyDayMessages,
    buildReviewMessages,
    buildFinalizeMessages
} = require('./prompts');

// Default configuration values
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.7;

class LLMClient {
    /**
     * Create an LLM client instance
     * @param {Object} options - Configuration options
     * @param {string} [options.model] - Model to use (default: gpt-4o-mini or LLM_MODEL env var)
     * @param {number} [options.temperature] - Temperature for generation (default: 0.7 or LLM_TEMPERATURE env var)
     */
    constructor(options = {}) {
        const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("LLM API key not configured");
        }

        this.openai = new OpenAI({ apiKey });
        this.model = options.model || process.env.LLM_MODEL || DEFAULT_MODEL;
        const envTemp = process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : null;
        this.temperature = options.temperature ?? envTemp ?? DEFAULT_TEMPERATURE;
    }

    /**
     * Validate and parse LLM response content
     * @param {Object} completion - OpenAI completion response
     * @returns {Object} Parsed and validated response
     * @throws {Error} If response is invalid
     */
    _parseAndValidateResponse(completion) {
        const content = completion.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Empty response from LLM");
        }

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (parseError) {
            throw new Error(`Failed to parse LLM response as JSON: ${parseError.message}`);
        }

        // Validate against schema (safeParse returns success/error without throwing)
        const validation = TravelPlanSchema.safeParse(parsed);
        if (!validation.success) {
            console.warn("LLM response validation warnings:", validation.error.issues);
            // Return parsed data anyway - schema is lenient with optional fields
            // This allows the LLM some flexibility while still catching major issues
        }

        return validation.success ? validation.data : parsed;
    }

    async generateTravelPlan({
        destination,
        start_date,
        end_date,
        duration_days,
        interest_categories,
        activity_level
    }) {
        // If not enough info to start planning, return a welcoming prompt
        if (!destination && !start_date && !end_date) {
            return getWelcomeResponse();
        }

        const prompt = buildTravelPlanPrompt({
            destination,
            start_date,
            end_date,
            duration_days,
            interest_categories,
            activity_level
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: "system", content: SYSTEM_PROMPTS.TRAVEL_PLANNER },
                    { role: "user", content: prompt }
                ],
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            return this._parseAndValidateResponse(completion);

        } catch (error) {
            console.error("Error generating travel plan:", error);
            throw error;
        }
    }

    async modifyItinerary(currentPlan, userMessage, conversationHistory, finalize = false) {
        const messages = buildModifyItineraryMessages({
            currentPlan,
            userMessage,
            conversationHistory,
            finalize
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages: messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            let modifiedPlan = this._parseAndValidateResponse(completion);

            // Ensure transportation is a list
            if (modifiedPlan.transportation && !Array.isArray(modifiedPlan.transportation)) {
                modifiedPlan.transportation = [modifiedPlan.transportation];
            }

            // Merge with original plan
            const mergedPlan = { ...currentPlan, ...modifiedPlan };

            return {
                success: true,
                plan: mergedPlan,
                message: modifiedPlan.summary || "Itinerary updated!"
            };

        } catch (error) {
            console.error("Error modifying itinerary:", error);
            return {
                success: false,
                plan: currentPlan,
                message: "Sorry, something went wrong while updating the itinerary. Please try again."
            };
        }
    }

    // ==================== NEW WORKFLOW METHODS ====================

    /**
     * Parse JSON response without schema validation (for flexible workflow responses)
     */
    _parseJsonResponse(completion) {
        const content = completion.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Empty response from LLM");
        }

        try {
            return JSON.parse(content);
        } catch (parseError) {
            throw new Error(`Failed to parse LLM response as JSON: ${parseError.message}`);
        }
    }

    /**
     * INFO_GATHERING: Process user message and extract trip info
     */
    async gatherInfo({ tripInfo, userMessage, conversationHistory }) {
        const messages = buildInfoGatheringMessages({
            tripInfo,
            userMessage,
            conversationHistory
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            // Ensure tripInfo has all expected fields
            const updatedTripInfo = {
                destination: null,
                startDate: null,
                endDate: null,
                durationDays: null,
                interests: [],
                activityLevel: 'moderate',
                travelers: 1,
                budget: null,
                ...tripInfo,
                ...response.tripInfo
            };

            // Calculate duration if we have both dates
            if (updatedTripInfo.startDate && updatedTripInfo.endDate && !updatedTripInfo.durationDays) {
                const start = new Date(updatedTripInfo.startDate);
                const end = new Date(updatedTripInfo.endDate);
                updatedTripInfo.durationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            }

            return {
                success: true,
                message: response.message,
                tripInfo: updatedTripInfo,
                isComplete: response.isComplete || false,
                missingInfo: response.missingInfo || []
            };

        } catch (error) {
            console.error("Error in gatherInfo:", error);
            return {
                success: false,
                message: "Sorry, I had trouble understanding that. Could you rephrase?",
                tripInfo,
                isComplete: false,
                missingInfo: []
            };
        }
    }

    /**
     * SKELETON: Generate day themes
     */
    async generateSkeleton({ tripInfo }) {
        const messages = buildSkeletonMessages({ tripInfo });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                skeleton: response.skeleton
            };

        } catch (error) {
            console.error("Error generating skeleton:", error);
            return {
                success: false,
                message: "Sorry, I couldn't generate the trip overview. Please try again.",
                skeleton: null
            };
        }
    }

    /**
     * SUGGEST_ACTIVITIES: Generate activity options only (no meals)
     */
    async suggestActivities({ tripInfo, skeletonDay, userMessage }) {
        const messages = buildSuggestActivitiesMessages({
            tripInfo,
            skeletonDay,
            userMessage
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                suggestions: response.suggestions
            };

        } catch (error) {
            console.error("Error suggesting activities:", error);
            return {
                success: false,
                message: "Sorry, I couldn't generate activity suggestions. Please try again.",
                suggestions: null
            };
        }
    }

    /**
     * SUGGEST_DAY: Generate options for activities and meals
     */
    async suggestDay({ tripInfo, skeletonDay, userMessage }) {
        const messages = buildSuggestDayMessages({
            tripInfo,
            skeletonDay,
            userMessage
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                suggestions: response.suggestions
            };

        } catch (error) {
            console.error("Error suggesting day options:", error);
            return {
                success: false,
                message: "Sorry, I couldn't generate suggestions. Please try again.",
                suggestions: null
            };
        }
    }

    /**
     * EXPAND_DAY_FROM_SELECTIONS: Generate day from user selections
     */
    async expandDayFromSelections({ tripInfo, skeletonDay, selections, suggestions }) {
        const messages = buildExpandDayFromSelectionsMessages({
            tripInfo,
            skeletonDay,
            selections,
            suggestions
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                expandedDay: response.expandedDay,
                suggestModifications: response.suggestModifications
            };

        } catch (error) {
            console.error("Error expanding day from selections:", error);
            return {
                success: false,
                message: "Sorry, I couldn't create the day plan. Please try again.",
                expandedDay: null
            };
        }
    }

    /**
     * EXPAND_DAY: Generate detailed activities for a day
     */
    async expandDay({ tripInfo, skeletonDay, userMessage, conversationHistory }) {
        const messages = buildExpandDayMessages({
            tripInfo,
            skeletonDay,
            userMessage,
            conversationHistory
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                expandedDay: response.expandedDay,
                suggestModifications: response.suggestModifications
            };

        } catch (error) {
            console.error("Error expanding day:", error);
            return {
                success: false,
                message: "Sorry, I couldn't expand this day. Please try again.",
                expandedDay: null
            };
        }
    }

    /**
     * MODIFY_DAY: Modify an existing expanded day
     */
    async modifyDay({ tripInfo, currentDay, userMessage, conversationHistory }) {
        const messages = buildModifyDayMessages({
            tripInfo,
            currentDay,
            userMessage,
            conversationHistory
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                expandedDay: response.expandedDay,
                suggestModifications: response.suggestModifications
            };

        } catch (error) {
            console.error("Error modifying day:", error);
            return {
                success: false,
                message: "Sorry, I couldn't modify this day. Please try again.",
                expandedDay: currentDay
            };
        }
    }

    /**
     * REVIEW: Handle feedback during review phase
     */
    async reviewPlan({ tripInfo, expandedDays, userMessage, conversationHistory }) {
        const messages = buildReviewMessages({
            tripInfo,
            expandedDays,
            userMessage,
            conversationHistory
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                modifications: response.modifications || null,
                readyToFinalize: response.readyToFinalize || false
            };

        } catch (error) {
            console.error("Error in review:", error);
            return {
                success: false,
                message: "Sorry, I had trouble processing your feedback. Please try again.",
                modifications: null,
                readyToFinalize: false
            };
        }
    }

    /**
     * FINALIZE: Enhance the itinerary with final details
     */
    async finalizePlan({ tripInfo, expandedDays }) {
        const messages = buildFinalizeMessages({
            tripInfo,
            expandedDays
        });

        try {
            const completion = await this.openai.chat.completions.create({
                messages,
                model: this.model,
                temperature: this.temperature,
                response_format: { type: "json_object" }
            });

            const response = this._parseJsonResponse(completion);

            return {
                success: true,
                message: response.message,
                finalPlan: response.finalPlan
            };

        } catch (error) {
            console.error("Error finalizing plan:", error);
            return {
                success: false,
                message: "Sorry, I couldn't finalize the itinerary. Please try again.",
                finalPlan: null
            };
        }
    }
}

module.exports = LLMClient;
