const TravelPlanner = require('../travelPlanner');
const { TravelRequestSchema } = require('../models/travelPlan');
const LLMClient = require('../services/llmClient');
const { sessionStore, WORKFLOW_STATES } = require('../services/sessionStore');
const { getSessionWelcomeMessage } = require('../services/prompts');
const GeocodingService = require('../services/geocodingService');
const PlacesClient = require('../services/placesClient');

const planner = new TravelPlanner();
const llmClient = new LLMClient();
let geocodingService;
try {
    geocodingService = new GeocodingService();
} catch (error) {
    console.warn('Geocoding service not available:', error.message);
}

/**
 * Check if user message indicates they want to change destination
 * Returns the new destination if detected, null otherwise
 */
function detectDestinationChange(message) {
    if (!message) return null;
    const lowerMsg = message.toLowerCase();

    // Patterns that indicate destination change intent
    const changePatterns = [
        /let'?s?\s+(?:go|travel|visit|head)\s+to\s+(.+?)(?:\s+instead|$)/i,
        /(?:change|switch)\s+(?:destination|location|trip)\s+to\s+(.+)/i,
        /(?:i\s+)?(?:want|would like|prefer)\s+to\s+(?:go|travel|visit)\s+(?:to\s+)?(.+?)(?:\s+instead|$)/i,
        /(?:actually|never\s*mind),?\s+(?:let'?s?\s+)?(?:go|do|visit)\s+(.+?)(?:\s+instead|$)/i,
        /how\s+about\s+(.+?)\s+instead/i,
        /^(.+?)\s+instead(?:\s+of|$)/i
    ];

    for (const pattern of changePatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            // Clean up the extracted destination
            let destination = match[1].trim();
            // Remove trailing punctuation
            destination = destination.replace(/[.,!?]+$/, '').trim();
            // Filter out non-destination phrases
            if (destination.length > 1 && destination.length < 100 &&
                !destination.match(/^(that|this|something|somewhere|else)$/i)) {
                return destination;
            }
        }
    }

    return null;
}

/**
 * Reset session for a new destination
 */
function resetSessionForNewDestination(sessionId, newDestination) {
    const session = sessionStore.get(sessionId);
    if (!session) return null;

    sessionStore.update(sessionId, {
        workflowState: WORKFLOW_STATES.INFO_GATHERING,
        tripInfo: {
            ...session.tripInfo,
            destination: newDestination
        },
        skeleton: null,
        expandedDays: {},
        currentExpandDay: null,
        currentSuggestions: null,
        finalPlan: null
    });

    return sessionStore.get(sessionId);
}

/**
 * Geocode all options in suggestions that don't have coordinates
 * Runs geocoding in parallel for better performance
 */
async function geocodeSuggestions(suggestions, destination) {
    if (!geocodingService || !suggestions) return suggestions;

    const slotKeys = ['breakfast', 'lunch', 'dinner', 'morningActivities', 'afternoonActivities', 'eveningActivities'];
    const geocodePromises = [];

    for (const key of slotKeys) {
        const options = suggestions[key];
        if (!Array.isArray(options)) continue;

        for (const option of options) {
            // Parse coordinates if they exist but might be strings
            if (option.coordinates) {
                const lat = parseFloat(option.coordinates.lat);
                const lng = parseFloat(option.coordinates.lng);
                if (!isNaN(lat) && !isNaN(lng)) {
                    option.coordinates = { lat, lng };
                }
            }

            const hasValidCoords = option.coordinates &&
                typeof option.coordinates.lat === 'number' &&
                typeof option.coordinates.lng === 'number' &&
                !isNaN(option.coordinates.lat) &&
                !isNaN(option.coordinates.lng);

            if (!hasValidCoords) {
                // Geocode places without valid coordinates
                const promise = (async () => {
                    const searchQuery = `${option.name}, ${destination}`;
                    try {
                        const coords = await geocodingService.geocode(searchQuery);
                        if (coords) {
                            option.coordinates = coords;
                        }
                    } catch (err) {
                        console.warn(`Failed to geocode ${option.name}:`, err.message);
                    }
                })();
                geocodePromises.push(promise);
            }
        }
    }

    if (geocodePromises.length > 0) {
        await Promise.all(geocodePromises);
    }

    return suggestions;
}

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

// ==================== NEW SESSION-BASED WORKFLOW ENDPOINTS ====================

/**
 * Start a new planning session
 */
exports.startSession = async (req, res) => {
    try {
        const session = sessionStore.create();
        const welcomeMessage = getSessionWelcomeMessage();

        // Add welcome message to conversation history
        sessionStore.addToConversation(session.sessionId, 'assistant', welcomeMessage);

        res.json({
            success: true,
            sessionId: session.sessionId,
            workflowState: session.workflowState,
            message: welcomeMessage
        });

    } catch (error) {
        console.error("Error in startSession:", error);
        res.status(500).json({ success: false, message: "Failed to start session", error: error.message });
    }
};

/**
 * Chat endpoint for INFO_GATHERING and REVIEW states
 */
exports.chat = async (req, res) => {
    try {
        const { sessionId, message } = req.body;

        if (!sessionId || !message) {
            return res.status(400).json({ success: false, message: "Missing sessionId or message" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        // Add user message to history
        sessionStore.addToConversation(sessionId, 'user', message);

        // Handle based on workflow state
        if (session.workflowState === WORKFLOW_STATES.INFO_GATHERING) {
            const result = await llmClient.gatherInfo({
                tripInfo: session.tripInfo,
                userMessage: message,
                conversationHistory: session.conversationHistory
            });

            // Check if destination changed - if so, clear old trip data
            const oldDestination = session.tripInfo.destination;
            const newDestination = result.tripInfo.destination;
            const destinationChanged = oldDestination && newDestination &&
                oldDestination.toLowerCase() !== newDestination.toLowerCase();

            if (destinationChanged) {
                // Clear old trip data when destination changes
                sessionStore.update(sessionId, {
                    tripInfo: result.tripInfo,
                    skeleton: null,
                    expandedDays: {},
                    currentExpandDay: null,
                    currentSuggestions: null,
                    finalPlan: null
                });
            } else {
                // Update session with new trip info
                sessionStore.update(sessionId, { tripInfo: result.tripInfo });
            }
            sessionStore.addToConversation(sessionId, 'assistant', result.message);

            // Get updated session to return current state
            const updatedSession = sessionStore.get(sessionId);

            res.json({
                success: true,
                sessionId,
                workflowState: updatedSession.workflowState,
                message: result.message,
                tripInfo: result.tripInfo,
                canProceed: result.isComplete,
                missingInfo: result.missingInfo,
                // Include these so frontend can sync state when destination changes
                skeleton: updatedSession.skeleton,
                expandedDays: updatedSession.expandedDays
            });

        } else if (session.workflowState === WORKFLOW_STATES.REVIEW) {
            const result = await llmClient.reviewPlan({
                tripInfo: session.tripInfo,
                expandedDays: session.expandedDays,
                userMessage: message,
                conversationHistory: session.conversationHistory
            });

            // Apply any modifications
            if (result.modifications) {
                for (const [dayNum, dayData] of Object.entries(result.modifications)) {
                    sessionStore.setExpandedDay(sessionId, parseInt(dayNum), dayData);
                }
            }

            sessionStore.addToConversation(sessionId, 'assistant', result.message);

            res.json({
                success: true,
                sessionId,
                workflowState: session.workflowState,
                message: result.message,
                expandedDays: session.expandedDays,
                readyToFinalize: result.readyToFinalize
            });

        } else {
            res.status(400).json({
                success: false,
                message: `Chat not available in ${session.workflowState} state. Use the appropriate endpoint.`
            });
        }

    } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ success: false, message: "Failed to process message", error: error.message });
    }
};

/**
 * Generate skeleton itinerary (day themes)
 */
exports.generateSkeleton = async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Missing sessionId" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        if (session.workflowState !== WORKFLOW_STATES.INFO_GATHERING) {
            return res.status(400).json({
                success: false,
                message: "Can only generate skeleton from INFO_GATHERING state"
            });
        }

        // Check if we have required info
        if (!session.tripInfo.destination || !session.tripInfo.startDate || !session.tripInfo.endDate) {
            return res.status(400).json({
                success: false,
                message: "Missing required trip info: destination, startDate, or endDate"
            });
        }

        const result = await llmClient.generateSkeleton({ tripInfo: session.tripInfo });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Update session
        sessionStore.update(sessionId, {
            workflowState: WORKFLOW_STATES.SKELETON,
            skeleton: result.skeleton,
            currentExpandDay: 1
        });
        sessionStore.addToConversation(sessionId, 'assistant', result.message);

        res.json({
            success: true,
            sessionId,
            workflowState: WORKFLOW_STATES.SKELETON,
            message: result.message,
            skeleton: result.skeleton,
            tripInfo: session.tripInfo,
            nextDayToExpand: 1
        });

    } catch (error) {
        console.error("Error in generateSkeleton:", error);
        res.status(500).json({ success: false, message: "Failed to generate skeleton", error: error.message });
    }
};

/**
 * Get suggestions for a day's activities and meals
 */
exports.suggestDay = async (req, res) => {
    try {
        const { sessionId, dayNumber, userMessage } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Missing sessionId" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        if (session.workflowState !== WORKFLOW_STATES.SKELETON &&
            session.workflowState !== WORKFLOW_STATES.EXPAND_DAY) {
            return res.status(400).json({
                success: false,
                message: "Can only suggest days from SKELETON or EXPAND_DAY state"
            });
        }

        const targetDay = dayNumber || session.currentExpandDay || 1;
        const skeletonDay = session.skeleton?.days?.find(d => d.dayNumber === targetDay);

        if (!skeletonDay) {
            return res.status(400).json({
                success: false,
                message: `Day ${targetDay} not found in skeleton`
            });
        }

        const result = await llmClient.suggestDay({
            tripInfo: session.tripInfo,
            skeletonDay,
            userMessage: userMessage || ''
        });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Geocode suggestions to ensure all options have coordinates for map display
        let suggestions = result.suggestions;
        try {
            suggestions = await geocodeSuggestions(suggestions, session.tripInfo.destination);
        } catch (geocodeError) {
            console.warn('Geocoding suggestions failed:', geocodeError.message);
        }

        // Store suggestions in session for later confirmation
        sessionStore.update(sessionId, {
            currentSuggestions: {
                dayNumber: targetDay,
                suggestions: suggestions
            }
        });

        sessionStore.addToConversation(sessionId, 'assistant', result.message);

        res.json({
            success: true,
            sessionId,
            workflowState: session.workflowState,
            message: result.message,
            suggestions: suggestions,
            dayNumber: targetDay
        });

    } catch (error) {
        console.error("Error in suggestDay:", error);
        res.status(500).json({ success: false, message: "Failed to suggest day options", error: error.message });
    }
};

/**
 * Confirm user selections and expand the day
 */
exports.confirmDaySelections = async (req, res) => {
    try {
        const { sessionId, dayNumber, selections } = req.body;

        if (!sessionId || !selections) {
            return res.status(400).json({ success: false, message: "Missing sessionId or selections" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        const targetDay = dayNumber || session.currentExpandDay || 1;
        const skeletonDay = session.skeleton?.days?.find(d => d.dayNumber === targetDay);

        if (!skeletonDay) {
            return res.status(400).json({
                success: false,
                message: `Day ${targetDay} not found in skeleton`
            });
        }

        // Get stored suggestions
        const storedSuggestions = session.currentSuggestions;
        if (!storedSuggestions || storedSuggestions.dayNumber !== targetDay) {
            return res.status(400).json({
                success: false,
                message: "No suggestions found for this day. Call suggest-day first."
            });
        }

        const result = await llmClient.expandDayFromSelections({
            tripInfo: session.tripInfo,
            skeletonDay,
            selections,
            suggestions: storedSuggestions.suggestions
        });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Copy coordinates from selected suggestions to expanded day
        // This preserves the coordinates we already have, avoiding extra API calls
        let expandedDay = result.expandedDay;
        const suggestions = storedSuggestions.suggestions;

        // Helper to find selected option and copy coordinates
        const copyCoordinates = (targetItem, optionsList, selectedId) => {
            if (!targetItem || !optionsList || !selectedId) return;
            const selected = optionsList.find(opt => opt.id === selectedId);
            if (selected?.coordinates) {
                targetItem.coordinates = selected.coordinates;
            }
        };

        // Copy meal coordinates
        copyCoordinates(expandedDay.breakfast, suggestions.breakfast, selections.breakfast);
        copyCoordinates(expandedDay.lunch, suggestions.lunch, selections.lunch);
        copyCoordinates(expandedDay.dinner, suggestions.dinner, selections.dinner);

        // Copy activity coordinates (match by name since activities array might be reordered)
        const copyActivityCoordinates = (activities, optionsList) => {
            if (!activities || !optionsList) return;
            for (const activity of activities) {
                const match = optionsList.find(opt =>
                    opt.name === activity.name ||
                    opt.name?.toLowerCase() === activity.name?.toLowerCase()
                );
                if (match?.coordinates) {
                    activity.coordinates = match.coordinates;
                }
            }
        };

        copyActivityCoordinates(expandedDay.morning, suggestions.morningActivities);
        copyActivityCoordinates(expandedDay.afternoon, suggestions.afternoonActivities);
        copyActivityCoordinates(expandedDay.evening, suggestions.eveningActivities);

        // Fallback: try geocoding any items still missing coordinates
        try {
            expandedDay = await planner.geocodeExpandedDay(expandedDay, session.tripInfo.destination);
        } catch (geocodeError) {
            console.warn("Geocoding failed, continuing with existing coordinates:", geocodeError.message);
        }

        // Store expanded day
        sessionStore.setExpandedDay(sessionId, targetDay, expandedDay);

        // Calculate next day to expand
        const totalDays = session.skeleton.days.length;
        const expandedDayNumbers = Object.keys(session.expandedDays).map(Number);
        const nextDay = targetDay < totalDays ? targetDay + 1 : null;
        const allDaysExpanded = expandedDayNumbers.length >= totalDays;

        // Update workflow state and clear suggestions
        sessionStore.update(sessionId, {
            workflowState: WORKFLOW_STATES.EXPAND_DAY,
            currentExpandDay: nextDay || targetDay,
            currentSuggestions: null
        });
        sessionStore.addToConversation(sessionId, 'assistant', result.message);

        res.json({
            success: true,
            sessionId,
            workflowState: WORKFLOW_STATES.EXPAND_DAY,
            message: result.message,
            expandedDay: expandedDay,
            allExpandedDays: session.expandedDays,
            currentDay: targetDay,
            nextDayToExpand: nextDay,
            canReview: allDaysExpanded,
            suggestModifications: result.suggestModifications
        });

    } catch (error) {
        console.error("Error in confirmDaySelections:", error);
        res.status(500).json({ success: false, message: "Failed to confirm selections", error: error.message });
    }
};

/**
 * Expand a specific day with activities and meals
 */
exports.expandDay = async (req, res) => {
    try {
        const { sessionId, dayNumber, userMessage } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Missing sessionId" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        if (session.workflowState !== WORKFLOW_STATES.SKELETON &&
            session.workflowState !== WORKFLOW_STATES.EXPAND_DAY) {
            return res.status(400).json({
                success: false,
                message: "Can only expand days from SKELETON or EXPAND_DAY state"
            });
        }

        const targetDay = dayNumber || session.currentExpandDay || 1;
        const skeletonDay = session.skeleton?.days?.find(d => d.dayNumber === targetDay);

        if (!skeletonDay) {
            return res.status(400).json({
                success: false,
                message: `Day ${targetDay} not found in skeleton`
            });
        }

        if (userMessage) {
            sessionStore.addToConversation(sessionId, 'user', userMessage);
        }

        const result = await llmClient.expandDay({
            tripInfo: session.tripInfo,
            skeletonDay,
            userMessage: userMessage || '',
            conversationHistory: session.conversationHistory
        });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Geocode activities immediately for map display
        let expandedDay = result.expandedDay;
        try {
            expandedDay = await planner.geocodeExpandedDay(expandedDay, session.tripInfo.destination);
        } catch (geocodeError) {
            console.warn("Geocoding failed, continuing without coordinates:", geocodeError.message);
        }

        // Store expanded day
        sessionStore.setExpandedDay(sessionId, targetDay, expandedDay);

        // Calculate next day to expand
        const totalDays = session.skeleton.days.length;
        const expandedDayNumbers = Object.keys(session.expandedDays).map(Number);
        const nextDay = targetDay < totalDays ? targetDay + 1 : null;
        const allDaysExpanded = expandedDayNumbers.length >= totalDays;

        // Update workflow state
        sessionStore.update(sessionId, {
            workflowState: WORKFLOW_STATES.EXPAND_DAY,
            currentExpandDay: nextDay || targetDay
        });
        sessionStore.addToConversation(sessionId, 'assistant', result.message);

        res.json({
            success: true,
            sessionId,
            workflowState: WORKFLOW_STATES.EXPAND_DAY,
            message: result.message,
            expandedDay: expandedDay,
            allExpandedDays: session.expandedDays,
            currentDay: targetDay,
            nextDayToExpand: nextDay,
            canReview: allDaysExpanded,
            suggestModifications: result.suggestModifications
        });

    } catch (error) {
        console.error("Error in expandDay:", error);
        res.status(500).json({ success: false, message: "Failed to expand day", error: error.message });
    }
};

/**
 * Modify an already-expanded day
 */
exports.modifyDay = async (req, res) => {
    try {
        const { sessionId, dayNumber, userMessage } = req.body;

        if (!sessionId || !dayNumber || !userMessage) {
            return res.status(400).json({ success: false, message: "Missing sessionId, dayNumber, or userMessage" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        const currentDay = session.expandedDays[dayNumber];
        if (!currentDay) {
            return res.status(400).json({
                success: false,
                message: `Day ${dayNumber} has not been expanded yet`
            });
        }

        sessionStore.addToConversation(sessionId, 'user', userMessage);

        const result = await llmClient.modifyDay({
            tripInfo: session.tripInfo,
            currentDay,
            userMessage,
            conversationHistory: session.conversationHistory
        });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Update the day
        sessionStore.setExpandedDay(sessionId, dayNumber, result.expandedDay);
        sessionStore.addToConversation(sessionId, 'assistant', result.message);

        res.json({
            success: true,
            sessionId,
            workflowState: session.workflowState,
            message: result.message,
            expandedDay: result.expandedDay,
            allExpandedDays: session.expandedDays,
            suggestModifications: result.suggestModifications
        });

    } catch (error) {
        console.error("Error in modifyDay:", error);
        res.status(500).json({ success: false, message: "Failed to modify day", error: error.message });
    }
};

/**
 * Start the review phase
 */
exports.startReview = async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Missing sessionId" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        // Check all days are expanded
        const totalDays = session.skeleton?.days?.length || 0;
        const expandedCount = Object.keys(session.expandedDays).length;

        if (expandedCount < totalDays) {
            return res.status(400).json({
                success: false,
                message: `Not all days expanded. ${expandedCount}/${totalDays} completed.`
            });
        }

        // Build review message
        const daysSummary = Object.values(session.expandedDays)
            .sort((a, b) => a.dayNumber - b.dayNumber)
            .map(day => `Day ${day.dayNumber}: ${day.theme}`)
            .join('\n');

        const reviewMessage = `Great! Here's your complete trip overview:\n\n${daysSummary}\n\nYou can now review each day, request changes, or finalize your itinerary. What would you like to do?`;

        sessionStore.update(sessionId, { workflowState: WORKFLOW_STATES.REVIEW });
        sessionStore.addToConversation(sessionId, 'assistant', reviewMessage);

        res.json({
            success: true,
            sessionId,
            workflowState: WORKFLOW_STATES.REVIEW,
            message: reviewMessage,
            tripInfo: session.tripInfo,
            skeleton: session.skeleton,
            expandedDays: session.expandedDays
        });

    } catch (error) {
        console.error("Error in startReview:", error);
        res.status(500).json({ success: false, message: "Failed to start review", error: error.message });
    }
};

/**
 * Finalize the itinerary with Places API enrichment
 */
exports.finalize = async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Missing sessionId" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        // Generate enhanced plan from LLM
        const llmResult = await llmClient.finalizePlan({
            tripInfo: session.tripInfo,
            expandedDays: session.expandedDays
        });

        if (!llmResult.success) {
            return res.status(500).json(llmResult);
        }

        // Enrich with Places API
        let finalPlan = llmResult.finalPlan;
        try {
            finalPlan = await planner.enrichFinalPlan(finalPlan);
        } catch (enrichError) {
            console.warn("Places enrichment failed, continuing without:", enrichError.message);
        }

        // Update session
        sessionStore.update(sessionId, {
            workflowState: WORKFLOW_STATES.FINALIZE,
            finalPlan
        });
        sessionStore.addToConversation(sessionId, 'assistant', llmResult.message);

        res.json({
            success: true,
            sessionId,
            workflowState: WORKFLOW_STATES.FINALIZE,
            message: llmResult.message,
            finalPlan
        });

    } catch (error) {
        console.error("Error in finalize:", error);
        res.status(500).json({ success: false, message: "Failed to finalize itinerary", error: error.message });
    }
};

// ==================== TWO-STEP EXPAND DAY FLOW ====================

/**
 * Geocode activity suggestions (no meals)
 */
async function geocodeActivitySuggestions(suggestions, destination) {
    if (!geocodingService || !suggestions) return suggestions;

    const geocodeOption = async (option) => {
        if (option.coordinates) return option;
        try {
            const query = `${option.name}, ${destination}`;
            const coords = await geocodingService.geocode(query);
            if (coords) {
                return { ...option, coordinates: coords };
            }
        } catch (error) {
            console.warn(`Failed to geocode ${option.name}:`, error.message);
        }
        return option;
    };

    // Geocode all activity options in parallel
    const [morning, afternoon, evening] = await Promise.all([
        Promise.all((suggestions.morningActivities || []).map(geocodeOption)),
        Promise.all((suggestions.afternoonActivities || []).map(geocodeOption)),
        Promise.all((suggestions.eveningActivities || []).map(geocodeOption))
    ]);

    return {
        ...suggestions,
        morningActivities: morning,
        afternoonActivities: afternoon,
        eveningActivities: evening
    };
}

/**
 * Convert Google Places price_level to price range string
 */
function priceLevelToRange(priceLevel) {
    switch (priceLevel) {
        case 0: return 'Free';
        case 1: return '$';
        case 2: return '$$';
        case 3: return '$$$';
        case 4: return '$$$$';
        default: return '$$'; // Default to moderate
    }
}

/**
 * Infer cuisine type from Google Places types array
 */
function inferCuisineFromTypes(types) {
    if (!types || types.length === 0) return null;

    const cuisineTypes = [
        'italian_restaurant', 'chinese_restaurant', 'japanese_restaurant',
        'mexican_restaurant', 'indian_restaurant', 'thai_restaurant',
        'french_restaurant', 'greek_restaurant', 'korean_restaurant',
        'vietnamese_restaurant', 'american_restaurant', 'mediterranean_restaurant',
        'middle_eastern_restaurant', 'seafood_restaurant', 'steakhouse',
        'pizza_restaurant', 'sushi_restaurant', 'cafe', 'bakery',
        'breakfast_restaurant', 'brunch_restaurant'
    ];

    for (const type of types) {
        if (cuisineTypes.includes(type)) {
            // Convert type to readable format
            return type.replace('_restaurant', '').replace(/_/g, ' ')
                .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
    }

    // Fallback based on common types
    if (types.includes('restaurant')) return 'Restaurant';
    if (types.includes('cafe')) return 'Café';
    if (types.includes('bakery')) return 'Bakery';
    return null;
}

/**
 * Suggest activities only (no meals) - Step 1 of two-step flow
 */
exports.suggestActivities = async (req, res) => {
    try {
        const { sessionId, dayNumber, userMessage } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Missing sessionId" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        if (session.workflowState !== WORKFLOW_STATES.SKELETON &&
            session.workflowState !== WORKFLOW_STATES.EXPAND_DAY) {
            return res.status(400).json({
                success: false,
                message: "Can only suggest activities from SKELETON or EXPAND_DAY state"
            });
        }

        const targetDay = dayNumber || session.currentExpandDay || 1;
        const skeletonDay = session.skeleton?.days?.find(d => d.dayNumber === targetDay);

        if (!skeletonDay) {
            return res.status(400).json({
                success: false,
                message: `Day ${targetDay} not found in skeleton`
            });
        }

        const result = await llmClient.suggestActivities({
            tripInfo: session.tripInfo,
            skeletonDay,
            userMessage: userMessage || ''
        });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Geocode activity suggestions
        let suggestions = result.suggestions;
        try {
            suggestions = await geocodeActivitySuggestions(suggestions, session.tripInfo.destination);
        } catch (geocodeError) {
            console.warn('Geocoding activity suggestions failed:', geocodeError.message);
        }

        // Store activity suggestions in session
        sessionStore.update(sessionId, {
            workflowState: WORKFLOW_STATES.EXPAND_DAY,
            currentExpandDay: targetDay,
            currentActivitySuggestions: {
                dayNumber: targetDay,
                suggestions: suggestions
            }
        });

        sessionStore.addToConversation(sessionId, 'assistant', result.message);

        res.json({
            success: true,
            sessionId,
            workflowState: WORKFLOW_STATES.EXPAND_DAY,
            message: result.message,
            suggestions: suggestions,
            dayNumber: targetDay
        });

    } catch (error) {
        console.error("Error in suggestActivities:", error);
        res.status(500).json({ success: false, message: "Failed to suggest activities", error: error.message });
    }
};

/**
 * Suggest meals nearby selected activities - Step 2 of two-step flow
 */
exports.suggestMealsNearby = async (req, res) => {
    try {
        const { sessionId, dayNumber, selectedActivities } = req.body;

        if (!sessionId || !selectedActivities) {
            return res.status(400).json({ success: false, message: "Missing sessionId or selectedActivities" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        const targetDay = dayNumber || session.currentExpandDay || 1;

        // Get stored activity suggestions
        const storedSuggestions = session.currentActivitySuggestions;
        if (!storedSuggestions || storedSuggestions.dayNumber !== targetDay) {
            return res.status(400).json({
                success: false,
                message: "No activity suggestions found. Call suggest-activities first."
            });
        }

        // Find reference coordinates for each meal based on selected activities
        const activitySuggestions = storedSuggestions.suggestions;

        // Helper to get selected activities with coordinates
        const getSelectedWithCoords = (options, selectedIds) => {
            if (!options || !selectedIds || selectedIds.length === 0) return [];
            return options.filter(opt => selectedIds.includes(opt.id) && opt.coordinates);
        };

        const selectedMorning = getSelectedWithCoords(activitySuggestions.morningActivities, selectedActivities.morningActivities);
        const selectedAfternoon = getSelectedWithCoords(activitySuggestions.afternoonActivities, selectedActivities.afternoonActivities);
        const selectedEvening = getSelectedWithCoords(activitySuggestions.eveningActivities, selectedActivities.eveningActivities);

        // Determine reference coordinates for each meal
        // Breakfast: near first morning activity
        // Lunch: near last morning or first afternoon activity
        // Dinner: near last afternoon or first evening activity
        const breakfastRef = selectedMorning[0]?.coordinates || null;
        const lunchRef = selectedAfternoon[0]?.coordinates ||
                         selectedMorning[selectedMorning.length - 1]?.coordinates || null;
        const dinnerRef = selectedEvening[0]?.coordinates ||
                          selectedAfternoon[selectedAfternoon.length - 1]?.coordinates || null;

        // Initialize PlacesClient
        let placesClient;
        try {
            placesClient = new PlacesClient();
        } catch (error) {
            console.error("PlacesClient initialization failed:", error);
            return res.status(500).json({
                success: false,
                message: "Places API not available"
            });
        }

        const destination = session.tripInfo.destination;
        const radius = 1500; // 1.5km radius

        // Search for nearby restaurants for each meal
        const searchMeals = async (coords, mealType) => {
            if (!coords) {
                // Fallback: text search in destination
                const results = await placesClient.searchPlaces(
                    `${mealType} restaurant ${destination}`,
                    null,
                    null,
                    'restaurant'
                );
                return results.slice(0, 3).map((place, idx) => ({
                    id: `${mealType[0]}${idx + 1}`,
                    name: place.name,
                    cuisine: inferCuisineFromTypes(place.types),
                    description: place.vicinity || '',
                    rating: place.rating,
                    priceRange: priceLevelToRange(place.price_level),
                    coordinates: place.location,
                    place_id: place.place_id
                }));
            }

            const results = await placesClient.searchPlaces(
                `${mealType} restaurant`,
                coords,
                radius,
                'restaurant'
            );

            return results.slice(0, 3).map((place, idx) => ({
                id: `${mealType[0]}${idx + 1}`,
                name: place.name,
                cuisine: inferCuisineFromTypes(place.types),
                description: place.vicinity || '',
                rating: place.rating,
                priceRange: priceLevelToRange(place.price_level),
                coordinates: place.location,
                place_id: place.place_id
            }));
        };

        // Search for all meals in parallel
        const [breakfast, lunch, dinner] = await Promise.all([
            searchMeals(breakfastRef, 'breakfast'),
            searchMeals(lunchRef, 'lunch'),
            searchMeals(dinnerRef, 'dinner')
        ]);

        const mealSuggestions = {
            dayNumber: targetDay,
            breakfast,
            lunch,
            dinner
        };

        // Store meal suggestions in session
        sessionStore.update(sessionId, {
            currentMealSuggestions: {
                dayNumber: targetDay,
                suggestions: mealSuggestions
            }
        });

        const message = `I found some great dining options near your selected activities! Here are restaurant suggestions for breakfast, lunch, and dinner. Select your preferences for each meal.`;
        sessionStore.addToConversation(sessionId, 'assistant', message);

        res.json({
            success: true,
            sessionId,
            workflowState: WORKFLOW_STATES.EXPAND_DAY,
            message,
            mealSuggestions,
            dayNumber: targetDay
        });

    } catch (error) {
        console.error("Error in suggestMealsNearby:", error);
        res.status(500).json({ success: false, message: "Failed to suggest meals", error: error.message });
    }
};

/**
 * Get current session state
 */
exports.getSession = async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Missing sessionId" });
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found or expired" });
        }

        res.json({
            success: true,
            sessionId: session.sessionId,
            workflowState: session.workflowState,
            tripInfo: session.tripInfo,
            skeleton: session.skeleton,
            expandedDays: session.expandedDays,
            currentExpandDay: session.currentExpandDay,
            finalPlan: session.finalPlan,
            conversationHistory: session.conversationHistory
        });

    } catch (error) {
        console.error("Error in getSession:", error);
        res.status(500).json({ success: false, message: "Failed to get session", error: error.message });
    }
};

