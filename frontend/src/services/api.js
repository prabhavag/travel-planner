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

export default api;
