import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { Text, Title, Paragraph, Button, TextInput as PaperInput, ActivityIndicator, Chip } from 'react-native-paper';
import {
    startSession,
    chat,
    generateSkeleton,
    suggestDay,
    confirmDaySelections,
    expandDay,
    modifyDay,
    startReview,
    finalize,
    suggestActivities,
    suggestMealsNearby
} from '../services/api';
import MapComponent from '../components/MapComponent';
import DetailedItineraryView from '../components/DetailedItineraryView';
import SkeletonView from '../components/SkeletonView';

// Workflow states
const WORKFLOW_STATES = {
    INFO_GATHERING: 'INFO_GATHERING',
    SKELETON: 'SKELETON',
    EXPAND_DAY: 'EXPAND_DAY',
    REVIEW: 'REVIEW',
    FINALIZE: 'FINALIZE'
};

const ItineraryScreen = ({ route, navigation }) => {
    // Session state
    const [sessionId, setSessionId] = useState(null);
    const [workflowState, setWorkflowState] = useState(WORKFLOW_STATES.INFO_GATHERING);

    // Trip data
    const [tripInfo, setTripInfo] = useState(null);
    const [skeleton, setSkeleton] = useState(null);
    const [expandedDays, setExpandedDays] = useState({});
    const [currentExpandDay, setCurrentExpandDay] = useState(null);
    const [finalPlan, setFinalPlan] = useState(null);

    // UI state
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [chatInput, setChatInput] = useState('');
    const [chatHistory, setChatHistory] = useState([]);
    const [canProceed, setCanProceed] = useState(false);
    const [canReview, setCanReview] = useState(false);

    // Suggestions state (for day planning) - Legacy combined flow
    const [suggestions, setSuggestions] = useState(null);
    const [selections, setSelections] = useState({
        breakfast: null,
        morningActivities: [],
        lunch: null,
        afternoonActivities: [],
        dinner: null,
        eveningActivities: []
    });

    // Two-step expand day flow state
    const [expandDayStep, setExpandDayStep] = useState('activities'); // 'activities' | 'meals'
    const [activitySuggestions, setActivitySuggestions] = useState(null);
    const [mealSuggestions, setMealSuggestions] = useState(null);
    const [activitySelections, setActivitySelections] = useState({
        morningActivities: [],
        afternoonActivities: [],
        eveningActivities: []
    });
    const [mealSelections, setMealSelections] = useState({
        breakfast: null,
        lunch: null,
        dinner: null
    });

    const chatScrollRef = useRef(null);

    // Auto-scroll chat
    useEffect(() => {
        if (chatScrollRef.current) {
            setTimeout(() => {
                chatScrollRef.current.scrollToEnd?.({ animated: true });
            }, 100);
        }
    }, [chatHistory]);

    // Initialize session on mount
    useEffect(() => {
        initializeSession();
    }, []);

    const initializeSession = async () => {
        try {
            const response = await startSession();
            if (response.success) {
                setSessionId(response.sessionId);
                setWorkflowState(response.workflowState);
                setChatHistory([{ role: 'assistant', content: response.message }]);
            }
        } catch (error) {
            console.error('Failed to start session:', error);
            Alert.alert('Error', 'Failed to start planning session. Please try again.');
        } finally {
            setInitializing(false);
        }
    };

    // Handle chat messages (INFO_GATHERING and REVIEW states)
    const handleChat = async () => {
        if (!chatInput.trim() || !sessionId) return;

        const userMessage = chatInput;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
        setLoading(true);

        try {
            // Use different endpoints based on workflow state
            if (workflowState === WORKFLOW_STATES.EXPAND_DAY && currentExpandDay) {
                // Try to detect if user is referencing a specific day number (e.g., "Day 1")
                const dayMatch = userMessage.match(/day\s*(\d+)/i);
                const mentionedDay = dayMatch ? parseInt(dayMatch[1]) : null;

                // If user mentions a day that's already expanded, modify that day
                // Otherwise, operate on the current day
                const targetDay = (mentionedDay && expandedDays[mentionedDay]) ? mentionedDay : currentExpandDay;

                if (expandedDays[targetDay]) {
                    // Day is already expanded, modify it
                    const response = await modifyDay(sessionId, targetDay, userMessage);
                    if (response.success) {
                        setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                        if (response.expandedDay) {
                            setExpandedDays(response.allExpandedDays || { ...expandedDays, [targetDay]: response.expandedDay });
                        }
                    }
                } else {
                    // Day not yet expanded - generate suggestions with user's context
                    const response = await suggestDay(sessionId, currentExpandDay, userMessage);
                    if (response.success) {
                        setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                        setSuggestions(response.suggestions);
                        // Reset selections when suggestions change
                        setSelections({
                            breakfast: null,
                            morningActivities: [],
                            lunch: null,
                            afternoonActivities: [],
                            dinner: null,
                            eveningActivities: []
                        });
                    }
                }
            } else {
                // INFO_GATHERING or REVIEW
                const response = await chat(sessionId, userMessage);
                if (response.success) {
                    setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                    if (response.tripInfo) {
                        setTripInfo(response.tripInfo);
                    }
                    if (response.canProceed !== undefined) {
                        setCanProceed(response.canProceed);
                    }
                    // Sync skeleton and expandedDays from server (handles destination change clearing)
                    if (response.skeleton !== undefined) {
                        setSkeleton(response.skeleton);
                        // If skeleton is cleared, also reset related state
                        if (response.skeleton === null) {
                            setCurrentExpandDay(null);
                            setFinalPlan(null);
                            setCanReview(false);
                            setSuggestions(null);
                        }
                    }
                    if (response.expandedDays !== undefined) {
                        setExpandedDays(response.expandedDays);
                    }
                }
            }
        } catch (error) {
            console.error('Chat error:', error);
            setChatHistory(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
        } finally {
            setLoading(false);
        }
    };

    // Generate skeleton itinerary
    const handleGenerateSkeleton = async () => {
        if (!sessionId) return;
        setLoading(true);

        try {
            const response = await generateSkeleton(sessionId);
            if (response.success) {
                setWorkflowState(WORKFLOW_STATES.SKELETON);
                setSkeleton(response.skeleton);
                setTripInfo(response.tripInfo);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                setCurrentExpandDay(response.nextDayToExpand || 1);
            }
        } catch (error) {
            console.error('Generate skeleton error:', error);
            Alert.alert('Error', 'Failed to generate trip overview. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Get suggestions for a day - now uses two-step flow (activities first)
    const handleSuggestDay = async (dayNumber) => {
        if (!sessionId) return;
        setLoading(true);
        setCurrentExpandDay(dayNumber);

        // Reset all selections for new day
        setActivitySelections({
            morningActivities: [],
            afternoonActivities: [],
            eveningActivities: []
        });
        setMealSelections({
            breakfast: null,
            lunch: null,
            dinner: null
        });
        setMealSuggestions(null);
        setExpandDayStep('activities');

        // Also reset legacy state
        setSelections({
            breakfast: null,
            morningActivities: [],
            lunch: null,
            afternoonActivities: [],
            dinner: null,
            eveningActivities: []
        });
        setSuggestions(null);

        try {
            // Use new two-step flow: activities first
            const response = await suggestActivities(sessionId, dayNumber);
            if (response.success) {
                setWorkflowState(WORKFLOW_STATES.EXPAND_DAY);
                setActivitySuggestions(response.suggestions);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
            }
        } catch (error) {
            console.error('Suggest activities error:', error);
            Alert.alert('Error', 'Failed to get activity suggestions. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Toggle selection for an activity in the two-step flow
    const toggleActivitySelectionTwoStep = (slotType, optionId) => {
        setActivitySelections(prev => {
            const current = prev[slotType] || [];
            const isSelected = current.includes(optionId);
            return {
                ...prev,
                [slotType]: isSelected
                    ? current.filter(id => id !== optionId)
                    : [...current, optionId]
            };
        });
    };

    // Toggle selection for a meal in the two-step flow
    const toggleMealSelectionTwoStep = (mealType, optionId) => {
        setMealSelections(prev => ({
            ...prev,
            [mealType]: prev[mealType] === optionId ? null : optionId
        }));
    };

    // Confirm activity selections and get meal suggestions (Step 1 -> Step 2)
    const handleConfirmActivities = async () => {
        if (!sessionId || !currentExpandDay) return;
        setLoading(true);

        try {
            const response = await suggestMealsNearby(sessionId, currentExpandDay, activitySelections);
            if (response.success) {
                setMealSuggestions(response.mealSuggestions);
                setExpandDayStep('meals');
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
            }
        } catch (error) {
            console.error('Suggest meals error:', error);
            Alert.alert('Error', 'Failed to get meal suggestions. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Confirm both activity and meal selections to create the final day
    const handleConfirmDayTwoStep = async () => {
        if (!sessionId || !currentExpandDay) return;
        setLoading(true);

        try {
            // Combine activity and meal selections
            const combinedSelections = {
                ...activitySelections,
                ...mealSelections
            };

            const response = await confirmDaySelections(sessionId, currentExpandDay, combinedSelections);
            if (response.success) {
                setExpandedDays(response.allExpandedDays || { ...expandedDays, [currentExpandDay]: response.expandedDay });
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                setCurrentExpandDay(response.nextDayToExpand || currentExpandDay);
                setCanReview(response.canReview || false);

                // Clear two-step flow state
                setActivitySuggestions(null);
                setMealSuggestions(null);
                setExpandDayStep('activities');
            }
        } catch (error) {
            console.error('Confirm day error:', error);
            Alert.alert('Error', 'Failed to confirm day. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Toggle selection for a meal option
    const toggleMealSelection = (mealType, optionId) => {
        setSelections(prev => ({
            ...prev,
            [mealType]: prev[mealType] === optionId ? null : optionId
        }));
    };

    // Toggle selection for an activity option
    const toggleActivitySelection = (slotType, optionId) => {
        setSelections(prev => {
            const current = prev[slotType] || [];
            const isSelected = current.includes(optionId);
            return {
                ...prev,
                [slotType]: isSelected
                    ? current.filter(id => id !== optionId)
                    : [...current, optionId]
            };
        });
    };

    // Confirm selections and create expanded day
    const handleConfirmSelections = async () => {
        if (!sessionId || !currentExpandDay) return;
        setLoading(true);

        try {
            const response = await confirmDaySelections(sessionId, currentExpandDay, selections);
            if (response.success) {
                setExpandedDays(response.allExpandedDays || { ...expandedDays, [currentExpandDay]: response.expandedDay });
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                setCurrentExpandDay(response.nextDayToExpand || currentExpandDay);
                setCanReview(response.canReview || false);
                // Clear suggestions after confirming
                setSuggestions(null);
            }
        } catch (error) {
            console.error('Confirm selections error:', error);
            Alert.alert('Error', 'Failed to confirm selections. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Legacy expand day (without suggestions - used for modifications)
    const handleExpandDay = async (dayNumber) => {
        if (!sessionId) return;
        setLoading(true);
        setCurrentExpandDay(dayNumber);

        try {
            const response = await expandDay(sessionId, dayNumber);
            if (response.success) {
                setWorkflowState(WORKFLOW_STATES.EXPAND_DAY);
                setExpandedDays(response.allExpandedDays || { ...expandedDays, [dayNumber]: response.expandedDay });
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                setCurrentExpandDay(response.nextDayToExpand || dayNumber);
                setCanReview(response.canReview || false);
            }
        } catch (error) {
            console.error('Expand day error:', error);
            Alert.alert('Error', 'Failed to expand day. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Start review phase
    const handleStartReview = async () => {
        if (!sessionId) return;
        setLoading(true);

        try {
            const response = await startReview(sessionId);
            if (response.success) {
                setWorkflowState(WORKFLOW_STATES.REVIEW);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
                if (response.expandedDays) {
                    setExpandedDays(response.expandedDays);
                }
            }
        } catch (error) {
            console.error('Start review error:', error);
            Alert.alert('Error', 'Failed to start review. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Finalize the itinerary
    const handleFinalize = async () => {
        if (!sessionId) return;
        setLoading(true);

        try {
            const response = await finalize(sessionId);
            if (response.success) {
                setWorkflowState(WORKFLOW_STATES.FINALIZE);
                setFinalPlan(response.finalPlan);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.message }]);
            }
        } catch (error) {
            console.error('Finalize error:', error);
            Alert.alert('Error', 'Failed to finalize itinerary. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Helper to validate and normalize coordinates
    const getValidCoordinates = (coords) => {
        if (!coords) return null;
        const lat = typeof coords.lat === 'string' ? parseFloat(coords.lat) : coords.lat;
        const lng = typeof coords.lng === 'string' ? parseFloat(coords.lng) : coords.lng;
        if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
            return { lat, lng };
        }
        return null;
    };

    // Build preview from selected suggestions (for real-time map updates)
    const getSelectedSuggestionsPreview = () => {
        if (!currentExpandDay) return null;

        const getSelectedOption = (options, selectedId) => {
            if (!options || !selectedId) return null;
            return options.find(opt => opt.id === selectedId);
        };

        const getSelectedOptions = (options, selectedIds) => {
            if (!options || !selectedIds || selectedIds.length === 0) return [];
            return options.filter(opt => selectedIds.includes(opt.id));
        };

        // Helper to create map entry with validated coordinates
        const createMapEntry = (item, type) => {
            const coords = getValidCoordinates(item?.coordinates);
            if (!coords) return null;
            return { name: item.name, type, coordinates: coords };
        };

        // Handle two-step flow (activitySuggestions + mealSuggestions)
        if (activitySuggestions) {
            const selectedMorning = getSelectedOptions(activitySuggestions.morningActivities, activitySelections.morningActivities);
            const selectedAfternoon = getSelectedOptions(activitySuggestions.afternoonActivities, activitySelections.afternoonActivities);
            const selectedEvening = getSelectedOptions(activitySuggestions.eveningActivities, activitySelections.eveningActivities);

            // Also include meal selections if in meals step
            const selectedBreakfast = mealSuggestions ? getSelectedOption(mealSuggestions.breakfast, mealSelections.breakfast) : null;
            const selectedLunch = mealSuggestions ? getSelectedOption(mealSuggestions.lunch, mealSelections.lunch) : null;
            const selectedDinner = mealSuggestions ? getSelectedOption(mealSuggestions.dinner, mealSelections.dinner) : null;

            const morning = [
                createMapEntry(selectedBreakfast, 'restaurant'),
                ...selectedMorning.map(a => createMapEntry(a, a.type || 'attraction'))
            ].filter(Boolean);

            const afternoon = [
                createMapEntry(selectedLunch, 'restaurant'),
                ...selectedAfternoon.map(a => createMapEntry(a, a.type || 'attraction'))
            ].filter(Boolean);

            const evening = [
                createMapEntry(selectedDinner, 'restaurant'),
                ...selectedEvening.map(a => createMapEntry(a, a.type || 'attraction'))
            ].filter(Boolean);

            if (morning.length === 0 && afternoon.length === 0 && evening.length === 0) {
                return null;
            }

            return {
                day_number: currentExpandDay,
                date: activitySuggestions.date,
                morning,
                afternoon,
                evening
            };
        }

        // Handle legacy flow (combined suggestions)
        if (!suggestions) return null;

        // Build activities from selections
        const selectedBreakfast = getSelectedOption(suggestions.breakfast, selections.breakfast);
        const selectedMorning = getSelectedOptions(suggestions.morningActivities, selections.morningActivities);
        const selectedLunch = getSelectedOption(suggestions.lunch, selections.lunch);
        const selectedAfternoon = getSelectedOptions(suggestions.afternoonActivities, selections.afternoonActivities);
        const selectedDinner = getSelectedOption(suggestions.dinner, selections.dinner);
        const selectedEvening = getSelectedOptions(suggestions.eveningActivities, selections.eveningActivities);

        // Convert to map format with validated coordinates
        const morning = [
            createMapEntry(selectedBreakfast, 'restaurant'),
            ...selectedMorning.map(a => createMapEntry(a, a.type || 'attraction'))
        ].filter(Boolean);

        const afternoon = [
            createMapEntry(selectedLunch, 'restaurant'),
            ...selectedAfternoon.map(a => createMapEntry(a, a.type || 'attraction'))
        ].filter(Boolean);

        const evening = [
            createMapEntry(selectedDinner, 'restaurant'),
            ...selectedEvening.map(a => createMapEntry(a, a.type || 'attraction'))
        ].filter(Boolean);

        // Only return if there are any selected items with coordinates
        if (morning.length === 0 && afternoon.length === 0 && evening.length === 0) {
            return null;
        }

        return {
            day_number: currentExpandDay,
            date: suggestions.date,
            morning,
            afternoon,
            evening
        };
    };

    // Convert expanded days to itinerary format for map
    const getItineraryForMap = () => {
        // Helper to validate and format activity for map
        const formatActivity = (activity) => {
            if (!activity) return null;
            const coords = getValidCoordinates(activity.coordinates);
            if (!coords) return null;
            return {
                name: activity.name,
                type: activity.type || 'attraction',
                coordinates: coords,
                time: activity.time || activity.timeSlot
            };
        };

        if (finalPlan?.itinerary) {
            // Transform finalPlan.itinerary to include meals merged into time slots
            return finalPlan.itinerary.map(day => {
                const morningWithBreakfast = [
                    formatActivity(day.breakfast),
                    ...(day.morning || []).map(formatActivity)
                ].filter(Boolean);

                const afternoonWithLunch = [
                    formatActivity(day.lunch),
                    ...(day.afternoon || []).map(formatActivity)
                ].filter(Boolean);

                const eveningWithDinner = [
                    formatActivity(day.dinner),
                    ...(day.evening || []).map(formatActivity)
                ].filter(Boolean);

                return {
                    day_number: day.day_number || day.dayNumber,
                    date: day.date,
                    morning: morningWithBreakfast,
                    afternoon: afternoonWithLunch,
                    evening: eveningWithDinner
                };
            });
        }

        // Convert expandedDays to array format, including meals as activities for map display
        const expandedItinerary = Object.values(expandedDays)
            .sort((a, b) => a.dayNumber - b.dayNumber)
            .map(day => {
                // Include meals and activities with valid coordinates
                const morningWithBreakfast = [
                    formatActivity(day.breakfast),
                    ...(day.morning || []).map(formatActivity)
                ].filter(Boolean);

                const afternoonWithLunch = [
                    formatActivity(day.lunch),
                    ...(day.afternoon || []).map(formatActivity)
                ].filter(Boolean);

                const eveningWithDinner = [
                    formatActivity(day.dinner),
                    ...(day.evening || []).map(formatActivity)
                ].filter(Boolean);

                return {
                    day_number: day.dayNumber,
                    date: day.date,
                    morning: morningWithBreakfast,
                    afternoon: afternoonWithLunch,
                    evening: eveningWithDinner
                };
            });

        // Add preview from selected suggestions (if any)
        const suggestionsPreview = getSelectedSuggestionsPreview();
        if (suggestionsPreview) {
            // Check if this day already exists in expanded (shouldn't happen, but be safe)
            const existingDayIndex = expandedItinerary.findIndex(d => d.day_number === suggestionsPreview.day_number);
            if (existingDayIndex === -1) {
                expandedItinerary.push(suggestionsPreview);
                expandedItinerary.sort((a, b) => a.day_number - b.day_number);
            }
        }

        return expandedItinerary;
    };

    // Get workflow state label
    const getStateLabel = () => {
        switch (workflowState) {
            case WORKFLOW_STATES.INFO_GATHERING: return 'Gathering Info';
            case WORKFLOW_STATES.SKELETON: return 'Trip Overview';
            case WORKFLOW_STATES.EXPAND_DAY: return `Planning Day ${currentExpandDay || ''}`;
            case WORKFLOW_STATES.REVIEW: return 'Review';
            case WORKFLOW_STATES.FINALIZE: return 'Finalized';
            default: return '';
        }
    };

    // Render action button based on state
    const renderActionButton = () => {
        switch (workflowState) {
            case WORKFLOW_STATES.INFO_GATHERING:
                return canProceed ? (
                    <Button
                        mode="contained"
                        onPress={handleGenerateSkeleton}
                        loading={loading}
                        disabled={loading}
                        style={styles.actionButton}
                    >
                        Generate Trip Overview
                    </Button>
                ) : null;

            case WORKFLOW_STATES.SKELETON:
                return (
                    <Button
                        mode="contained"
                        onPress={() => handleSuggestDay(1)}
                        loading={loading}
                        disabled={loading}
                        style={styles.actionButton}
                    >
                        Start Planning Day 1
                    </Button>
                );

            case WORKFLOW_STATES.EXPAND_DAY:
                const totalDays = skeleton?.days?.length || 0;
                const expandedCount = Object.keys(expandedDays).length;

                // Two-step flow: Activity suggestions active
                if (activitySuggestions) {
                    if (expandDayStep === 'activities') {
                        // Step 1: Confirm activities to get meal suggestions
                        const hasActivitySelections =
                            activitySelections.morningActivities.length > 0 ||
                            activitySelections.afternoonActivities.length > 0 ||
                            activitySelections.eveningActivities.length > 0;

                        return (
                            <Button
                                mode="contained"
                                onPress={handleConfirmActivities}
                                loading={loading}
                                disabled={loading || !hasActivitySelections}
                                style={[styles.actionButton, styles.confirmButton]}
                            >
                                Confirm Activities & Find Nearby Restaurants
                            </Button>
                        );
                    } else {
                        // Step 2: Confirm meals to create the final day
                        return (
                            <Button
                                mode="contained"
                                onPress={handleConfirmDayTwoStep}
                                loading={loading}
                                disabled={loading}
                                style={[styles.actionButton, styles.confirmButton]}
                            >
                                Confirm Day {currentExpandDay}
                            </Button>
                        );
                    }
                }

                // Legacy flow: Combined suggestions active
                if (suggestions) {
                    return (
                        <Button
                            mode="contained"
                            onPress={handleConfirmSelections}
                            loading={loading}
                            disabled={loading}
                            style={[styles.actionButton, styles.confirmButton]}
                        >
                            Confirm Selections for Day {currentExpandDay}
                        </Button>
                    );
                }

                if (expandedCount >= totalDays) {
                    return (
                        <Button
                            mode="contained"
                            onPress={handleStartReview}
                            loading={loading}
                            disabled={loading}
                            style={styles.actionButton}
                        >
                            Review All Days
                        </Button>
                    );
                } else {
                    // Find the next unexpanded day
                    const nextUnexpandedDay = skeleton?.days?.find(d => !expandedDays[d.dayNumber]);
                    if (nextUnexpandedDay) {
                        return (
                            <Button
                                mode="contained"
                                onPress={() => handleSuggestDay(nextUnexpandedDay.dayNumber)}
                                loading={loading}
                                disabled={loading}
                                style={styles.actionButton}
                            >
                                Continue to Day {nextUnexpandedDay.dayNumber}
                            </Button>
                        );
                    }
                }
                return null;

            case WORKFLOW_STATES.REVIEW:
                return (
                    <Button
                        mode="contained"
                        onPress={handleFinalize}
                        loading={loading}
                        disabled={loading}
                        style={[styles.actionButton, styles.finalizeButton]}
                    >
                        Finalize Itinerary
                    </Button>
                );

            default:
                return null;
        }
    };

    // Render a single option card
    const renderOptionCard = (option, isSelected, onPress, type = 'activity') => {
        const icon = type === 'meal' ? '🍽️' : '📍';
        return (
            <View
                key={option.id}
                style={[
                    styles.optionCard,
                    isSelected && styles.optionCardSelected
                ]}
            >
                <View style={styles.optionHeader}>
                    <Text style={styles.optionIcon}>{icon}</Text>
                    <Text style={[styles.optionName, isSelected && styles.optionNameSelected]}>
                        {option.name}
                    </Text>
                </View>
                <Text style={styles.optionDescription}>{option.description}</Text>
                <View style={styles.optionMeta}>
                    {option.cuisine && <Text style={styles.optionMetaText}>{option.cuisine}</Text>}
                    {option.type && <Text style={styles.optionMetaText}>{option.type}</Text>}
                    {option.priceRange && <Text style={styles.optionMetaText}>{option.priceRange}</Text>}
                    {option.estimatedDuration && <Text style={styles.optionMetaText}>{option.estimatedDuration}</Text>}
                    {option.estimatedCost != null && <Text style={styles.optionMetaText}>${option.estimatedCost}</Text>}
                </View>
                <Button
                    mode={isSelected ? "contained" : "outlined"}
                    onPress={onPress}
                    compact
                    style={styles.selectButton}
                >
                    {isSelected ? 'Selected' : 'Select'}
                </Button>
            </View>
        );
    };

    // Render suggestions section - Two-step flow (activities first, then meals)
    const renderSuggestions = () => {
        // Handle two-step flow
        if (activitySuggestions) {
            return renderTwoStepSuggestions();
        }

        // Legacy flow fallback
        if (!suggestions) return null;

        const sections = [
            { key: 'breakfast', label: '🌅 Breakfast Options', options: suggestions.breakfast, type: 'meal' },
            { key: 'morningActivities', label: '☀️ Morning Activities', options: suggestions.morningActivities, type: 'activity' },
            { key: 'lunch', label: '🍽️ Lunch Options', options: suggestions.lunch, type: 'meal' },
            { key: 'afternoonActivities', label: '🌤️ Afternoon Activities', options: suggestions.afternoonActivities, type: 'activity' },
            { key: 'dinner', label: '🌙 Dinner Options', options: suggestions.dinner, type: 'meal' },
            { key: 'eveningActivities', label: '✨ Evening Activities', options: suggestions.eveningActivities, type: 'activity' }
        ];

        return (
            <View style={styles.suggestionsContainer}>
                <Text style={styles.suggestionsTitle}>
                    Day {suggestions.dayNumber}: {suggestions.theme}
                </Text>
                <Text style={styles.suggestionsSubtitle}>
                    Select your preferences for each time slot:
                </Text>

                {sections.map(section => {
                    if (!section.options || section.options.length === 0) return null;

                    const isMeal = section.type === 'meal';

                    return (
                        <View key={section.key} style={styles.suggestionSection}>
                            <Text style={styles.sectionLabel}>{section.label}</Text>
                            <View style={styles.optionsRow}>
                                {section.options.map(option => {
                                    const isSelected = isMeal
                                        ? selections[section.key] === option.id
                                        : (selections[section.key] || []).includes(option.id);

                                    return renderOptionCard(
                                        option,
                                        isSelected,
                                        () => isMeal
                                            ? toggleMealSelection(section.key, option.id)
                                            : toggleActivitySelection(section.key, option.id),
                                        section.type
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}
            </View>
        );
    };

    // Render two-step flow suggestions (activities first, then meals)
    const renderTwoStepSuggestions = () => {
        const activitySections = [
            { key: 'morningActivities', label: '☀️ Morning Activities', options: activitySuggestions?.morningActivities || [] },
            { key: 'afternoonActivities', label: '🌤️ Afternoon Activities', options: activitySuggestions?.afternoonActivities || [] },
            { key: 'eveningActivities', label: '✨ Evening Activities', options: activitySuggestions?.eveningActivities || [] }
        ];

        const mealSections = mealSuggestions ? [
            { key: 'breakfast', label: '🌅 Breakfast Options', options: mealSuggestions.breakfast || [] },
            { key: 'lunch', label: '🍽️ Lunch Options', options: mealSuggestions.lunch || [] },
            { key: 'dinner', label: '🌙 Dinner Options', options: mealSuggestions.dinner || [] }
        ] : [];

        return (
            <View style={styles.suggestionsContainer}>
                <Text style={styles.suggestionsTitle}>
                    Day {activitySuggestions.dayNumber}: {activitySuggestions.theme}
                </Text>

                {/* Step indicator */}
                <View style={styles.stepIndicator}>
                    <View style={[styles.stepBadge, expandDayStep === 'activities' && styles.stepBadgeActive]}>
                        <Text style={[styles.stepText, expandDayStep === 'activities' && styles.stepTextActive]}>
                            1. Activities
                        </Text>
                    </View>
                    <Text style={styles.stepArrow}>→</Text>
                    <View style={[styles.stepBadge, expandDayStep === 'meals' && styles.stepBadgeActive]}>
                        <Text style={[styles.stepText, expandDayStep === 'meals' && styles.stepTextActive]}>
                            2. Meals
                        </Text>
                    </View>
                </View>

                {/* Activity sections */}
                <Text style={styles.suggestionsSubtitle}>
                    {expandDayStep === 'activities'
                        ? 'Select your activities for each time slot:'
                        : 'Your selected activities:'}
                </Text>

                {activitySections.map(section => {
                    if (!section.options || section.options.length === 0) return null;

                    return (
                        <View key={section.key} style={[
                            styles.suggestionSection,
                            expandDayStep === 'meals' && styles.confirmedSection
                        ]}>
                            <Text style={styles.sectionLabel}>{section.label}</Text>
                            <View style={styles.optionsRow}>
                                {section.options.map(option => {
                                    const isSelected = (activitySelections[section.key] || []).includes(option.id);

                                    // In meals step, only show selected activities
                                    if (expandDayStep === 'meals' && !isSelected) return null;

                                    return renderOptionCard(
                                        option,
                                        isSelected,
                                        expandDayStep === 'activities'
                                            ? () => toggleActivitySelectionTwoStep(section.key, option.id)
                                            : () => {}, // No action in meals step
                                        'activity'
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}

                {/* Meal sections (only visible in step 2) */}
                {expandDayStep === 'meals' && mealSections.length > 0 && (
                    <>
                        <Text style={[styles.suggestionsSubtitle, { marginTop: 20 }]}>
                            Select restaurants near your activities:
                        </Text>

                        {mealSections.map(section => {
                            if (!section.options || section.options.length === 0) return null;

                            return (
                                <View key={section.key} style={styles.suggestionSection}>
                                    <Text style={styles.sectionLabel}>{section.label}</Text>
                                    <View style={styles.optionsRow}>
                                        {section.options.map(option => {
                                            const isSelected = mealSelections[section.key] === option.id;

                                            return renderOptionCard(
                                                option,
                                                isSelected,
                                                () => toggleMealSelectionTwoStep(section.key, option.id),
                                                'meal'
                                            );
                                        })}
                                    </View>
                                </View>
                            );
                        })}
                    </>
                )}
            </View>
        );
    };

    if (initializing) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" />
                <Text style={{ marginTop: 10 }}>Starting your planning session...</Text>
            </View>
        );
    }

    const itineraryForMap = getItineraryForMap();
    const isFinalized = workflowState === WORKFLOW_STATES.FINALIZE;

    return (
        <View style={styles.container}>
            <View style={styles.mainContent}>
                {/* Left Panel: Map + Itinerary View */}
                <ScrollView style={styles.leftPanel} contentContainerStyle={styles.leftPanelContent}>
                    <View style={styles.mapContainer}>
                        <MapComponent itinerary={itineraryForMap} destination={tripInfo?.destination} />
                    </View>

                    {/* Skeleton View - SKELETON and EXPAND_DAY states */}
                    {(workflowState === WORKFLOW_STATES.SKELETON ||
                      workflowState === WORKFLOW_STATES.EXPAND_DAY ||
                      workflowState === WORKFLOW_STATES.REVIEW) &&
                     skeleton && !isFinalized && (
                        <SkeletonView
                            skeleton={skeleton}
                            tripInfo={tripInfo}
                            expandedDays={expandedDays}
                            currentExpandDay={currentExpandDay}
                            onExpandDay={handleSuggestDay}
                        />
                    )}

                    {/* Detailed Itinerary View - FINALIZE state */}
                    {isFinalized && finalPlan?.itinerary && (
                        <DetailedItineraryView itinerary={finalPlan.itinerary} />
                    )}
                </ScrollView>

                {/* Right Panel: Chat */}
                <View style={styles.chatPanel}>
                    {/* Header */}
                    <View style={styles.chatHeader}>
                        <Title style={styles.headerTitle}>
                            {tripInfo?.destination || 'Planning Your Trip'}
                        </Title>
                        {tripInfo?.startDate && tripInfo?.endDate && (
                            <Paragraph>{tripInfo.startDate} - {tripInfo.endDate}</Paragraph>
                        )}
                        <Chip style={styles.stateChip} textStyle={styles.stateChipText}>
                            {getStateLabel()}
                        </Chip>
                    </View>

                    {/* Chat Messages */}
                    <ScrollView
                        ref={chatScrollRef}
                        style={styles.chatScroll}
                        contentContainerStyle={styles.chatContent}
                    >
                        <View style={styles.conversation}>
                            {chatHistory.map((msg, idx) => (
                                <View
                                    key={idx}
                                    style={[
                                        styles.messageBubble,
                                        msg.role === 'user' ? styles.userBubble : styles.assistantBubble
                                    ]}
                                >
                                    <Text style={msg.role === 'user' ? styles.userText : styles.assistantText}>
                                        {msg.content}
                                    </Text>
                                </View>
                            ))}
                            {loading && <ActivityIndicator style={{ marginTop: 10 }} />}
                        </View>

                        {/* Suggestions UI */}
                        {renderSuggestions()}

                        {/* Action Button */}
                        {renderActionButton()}
                    </ScrollView>

                    {/* Chat Input */}
                    <View style={styles.inputArea}>
                        <PaperInput
                            mode="outlined"
                            value={chatInput}
                            onChangeText={setChatInput}
                            placeholder={
                                workflowState === WORKFLOW_STATES.EXPAND_DAY
                                    ? "Suggest changes for this day..."
                                    : "Type your message..."
                            }
                            style={styles.chatInput}
                            onSubmitEditing={handleChat}
                            disabled={loading || isFinalized}
                        />
                        <Button
                            mode="contained"
                            onPress={handleChat}
                            loading={loading}
                            disabled={loading || !chatInput.trim() || isFinalized}
                            style={styles.sendButton}
                        >
                            Send
                        </Button>
                    </View>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f0f2f5',
        height: 'calc(100vh - 50px)',
        maxHeight: 'calc(100vh - 50px)',
        overflow: 'hidden',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f0f2f5',
    },
    mainContent: {
        flex: 1,
        flexDirection: 'row',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
    },
    leftPanel: {
        width: '60%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
    },
    leftPanelContent: {
        flexGrow: 1,
        paddingBottom: 20,
    },
    mapContainer: {
        height: 400,
        minHeight: 300,
    },
    chatPanel: {
        width: '40%',
        backgroundColor: '#fff',
        borderLeftWidth: 1,
        borderLeftColor: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
    },
    chatHeader: {
        padding: 15,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        alignItems: 'center',
        backgroundColor: '#fff',
        flexShrink: 0,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1a1a1a',
    },
    stateChip: {
        marginTop: 8,
        backgroundColor: '#1f77b4',
    },
    stateChipText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    chatScroll: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
    },
    chatContent: {
        padding: 15,
        paddingBottom: 20,
    },
    conversation: {
        marginBottom: 20,
    },
    messageBubble: {
        padding: 12,
        borderRadius: 15,
        marginBottom: 10,
        maxWidth: '85%',
    },
    userBubble: {
        backgroundColor: '#0084ff',
        alignSelf: 'flex-end',
    },
    assistantBubble: {
        backgroundColor: '#e4e6eb',
        alignSelf: 'flex-start',
    },
    userText: {
        color: '#fff',
    },
    assistantText: {
        color: '#1c1e21',
    },
    inputArea: {
        flexShrink: 0,
        padding: 15,
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    chatInput: {
        flex: 1,
        marginRight: 10,
        backgroundColor: '#f0f2f5',
    },
    sendButton: {
        borderRadius: 20,
    },
    actionButton: {
        marginTop: 15,
        marginBottom: 10,
        backgroundColor: '#1f77b4',
    },
    finalizeButton: {
        backgroundColor: '#4CAF50',
    },
    confirmButton: {
        backgroundColor: '#2196F3',
    },
    // Suggestions styles
    suggestionsContainer: {
        marginTop: 15,
        marginBottom: 10,
        padding: 15,
        backgroundColor: '#f8f9fa',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    suggestionsTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1a1a1a',
        marginBottom: 5,
    },
    suggestionsSubtitle: {
        fontSize: 14,
        color: '#666',
        marginBottom: 15,
    },
    suggestionSection: {
        marginBottom: 20,
    },
    sectionLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 10,
    },
    optionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    optionCard: {
        flex: 1,
        minWidth: 200,
        maxWidth: '48%',
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 12,
        borderWidth: 2,
        borderColor: '#e0e0e0',
        marginBottom: 10,
    },
    optionCardSelected: {
        borderColor: '#1f77b4',
        backgroundColor: '#e3f2fd',
    },
    optionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    optionIcon: {
        fontSize: 16,
        marginRight: 6,
    },
    optionName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        flex: 1,
    },
    optionNameSelected: {
        color: '#1f77b4',
    },
    optionDescription: {
        fontSize: 12,
        color: '#666',
        marginBottom: 8,
        lineHeight: 18,
    },
    optionMeta: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 8,
    },
    optionMetaText: {
        fontSize: 11,
        color: '#888',
        backgroundColor: '#f0f0f0',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    selectButton: {
        marginTop: 4,
    },
    // Two-step flow styles
    stepIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 15,
        gap: 10,
    },
    stepBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#e0e0e0',
    },
    stepBadgeActive: {
        backgroundColor: '#1f77b4',
    },
    stepText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
    },
    stepTextActive: {
        color: '#fff',
    },
    stepArrow: {
        fontSize: 16,
        color: '#999',
    },
    confirmedSection: {
        opacity: 0.7,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
        padding: 8,
    },
});

export default ItineraryScreen;
