import axios from 'axios';
import { Platform } from 'react-native';

// For Android Emulator use 10.0.2.2, for iOS Simulator use localhost
const BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000/api' : 'http://localhost:3000/api';

const api = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export const generatePlan = async (data) => {
    try {
        const response = await api.post('/generate-plan', data);
        return response.data;
    } catch (error) {
        console.error('Error generating plan:', error);
        throw error;
    }
};

export const modifyPlan = async (data) => {
    try {
        const response = await api.post('/modify-plan', data);
        return response.data;
    } catch (error) {
        console.error('Error modifying plan:', error);
        throw error;
    }
};

// Get frontend config (API keys, etc.)
export const getConfig = async () => {
    try {
        const response = await api.get('/config');
        return response.data;
    } catch (error) {
        console.error("Config fetch error", error);
        return {};
    }
}

// ==================== NEW SESSION-BASED WORKFLOW API ====================

// Start a new planning session
export const startSession = async () => {
    try {
        const response = await api.post('/start-session');
        return response.data;
    } catch (error) {
        console.error('Error starting session:', error);
        throw error;
    }
};

// Chat with the assistant (INFO_GATHERING and REVIEW states)
export const chat = async (sessionId, message) => {
    try {
        const response = await api.post('/chat', { sessionId, message });
        return response.data;
    } catch (error) {
        console.error('Error in chat:', error);
        throw error;
    }
};

// Generate skeleton itinerary (day themes)
export const generateSkeleton = async (sessionId) => {
    try {
        const response = await api.post('/generate-skeleton', { sessionId });
        return response.data;
    } catch (error) {
        console.error('Error generating skeleton:', error);
        throw error;
    }
};

// Get suggestions for a day's activities and meals
export const suggestDay = async (sessionId, dayNumber, userMessage = '') => {
    try {
        const response = await api.post('/suggest-day', { sessionId, dayNumber, userMessage });
        return response.data;
    } catch (error) {
        console.error('Error getting suggestions:', error);
        throw error;
    }
};

// Confirm user selections and create expanded day
export const confirmDaySelections = async (sessionId, dayNumber, selections) => {
    try {
        const response = await api.post('/confirm-day-selections', { sessionId, dayNumber, selections });
        return response.data;
    } catch (error) {
        console.error('Error confirming selections:', error);
        throw error;
    }
};

// Expand a specific day with activities
export const expandDay = async (sessionId, dayNumber, userMessage = '') => {
    try {
        const response = await api.post('/expand-day', { sessionId, dayNumber, userMessage });
        return response.data;
    } catch (error) {
        console.error('Error expanding day:', error);
        throw error;
    }
};

// Modify an already-expanded day
export const modifyDay = async (sessionId, dayNumber, userMessage) => {
    try {
        const response = await api.post('/modify-day', { sessionId, dayNumber, userMessage });
        return response.data;
    } catch (error) {
        console.error('Error modifying day:', error);
        throw error;
    }
};

// Start review phase
export const startReview = async (sessionId) => {
    try {
        const response = await api.post('/start-review', { sessionId });
        return response.data;
    } catch (error) {
        console.error('Error starting review:', error);
        throw error;
    }
};

// Finalize the itinerary
export const finalize = async (sessionId) => {
    try {
        const response = await api.post('/finalize', { sessionId });
        return response.data;
    } catch (error) {
        console.error('Error finalizing:', error);
        throw error;
    }
};

// Get session state
export const getSession = async (sessionId) => {
    try {
        const response = await api.get(`/session/${sessionId}`);
        return response.data;
    } catch (error) {
        console.error('Error getting session:', error);
        throw error;
    }
};

// ==================== TWO-STEP EXPAND DAY FLOW ====================

// Suggest activities only (no meals) - Step 1
export const suggestActivities = async (sessionId, dayNumber, userMessage = '') => {
    try {
        const response = await api.post('/suggest-activities', { sessionId, dayNumber, userMessage });
        return response.data;
    } catch (error) {
        console.error('Error suggesting activities:', error);
        throw error;
    }
};

// Suggest meals nearby selected activities - Step 2
export const suggestMealsNearby = async (sessionId, dayNumber, selectedActivities) => {
    try {
        const response = await api.post('/suggest-meals-nearby', { sessionId, dayNumber, selectedActivities });
        return response.data;
    } catch (error) {
        console.error('Error suggesting meals:', error);
        throw error;
    }
};

export default api;
