const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const plannerController = require('./controllers/plannerController');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/health', (req, res) => res.send('Travel Planner API is running'));

// Legacy endpoints (kept for backward compatibility)
app.post('/api/generate-plan', plannerController.generatePlan);
app.post('/api/modify-plan', plannerController.modifyPlan);

// Config endpoint
app.get('/api/config', (req, res) => {
    res.json({ googleMapsApiKey: process.env.GOOGLE_PLACES_API_KEY || '' });
});

// New session-based workflow endpoints
app.post('/api/start-session', plannerController.startSession);
app.post('/api/chat', plannerController.chat);
app.post('/api/generate-skeleton', plannerController.generateSkeleton);
app.post('/api/suggest-day', plannerController.suggestDay);
app.post('/api/confirm-day-selections', plannerController.confirmDaySelections);
app.post('/api/expand-day', plannerController.expandDay);
app.post('/api/modify-day', plannerController.modifyDay);
app.post('/api/start-review', plannerController.startReview);
app.post('/api/finalize', plannerController.finalize);
app.get('/api/session/:sessionId', plannerController.getSession);

// Two-step expand day flow (activities first, then meals nearby)
app.post('/api/suggest-activities', plannerController.suggestActivities);
app.post('/api/suggest-meals-nearby', plannerController.suggestMealsNearby);

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
