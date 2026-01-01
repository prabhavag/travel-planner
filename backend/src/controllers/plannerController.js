const TravelPlanner = require('../travelPlanner');
const { TravelRequestSchema } = require('../models/travelPlan');
const LLMClient = require('../services/llmClient');

const planner = new TravelPlanner();
const llmClient = new LLMClient();

exports.generatePlan = async (req, res) => {
    try {
        // Validate request body
        const validatedRequest = TravelRequestSchema.parse(req.body);

        const plan = await planner.generateTravelPlan(validatedRequest);

        res.json({ success: true, plan });
    } catch (error) {
        console.error("Error in generatePlan:", error);
        if (error.name === 'ZodError') {
            return res.status(400).json({ success: false, message: "Invalid input", errors: error.errors });
        }
        res.status(500).json({ success: false, message: "Failed to generate plan", error: error.message });
    }
};

exports.modifyPlan = async (req, res) => {
    try {
        const { current_plan, user_message, conversation_history, finalize } = req.body;

        // Allow empty user_message when finalizing
        if (!current_plan || (!user_message && !finalize)) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const result = await planner.modifyTravelPlan({
            current_plan,
            user_message: user_message || "",
            conversation_history,
            finalize: finalize || false
        });

        res.json(result);

    } catch (error) {
        console.error("Error in modifyPlan:", error);
        res.status(500).json({ success: false, message: "Failed to modify plan", error: error.message });
    }
};

