const OpenAI = require('openai');
const { TravelPlanSchema } = require('../models/travelPlan');
const { buildTravelPlanPrompt, buildModifyItineraryMessages, getWelcomeResponse, SYSTEM_PROMPTS } = require('./prompts');

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
}

module.exports = LLMClient;
