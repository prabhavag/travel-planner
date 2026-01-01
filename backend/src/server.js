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
app.post('/api/generate-plan', plannerController.generatePlan);
app.post('/api/modify-plan', plannerController.modifyPlan);
app.get('/api/config', (req, res) => {
    res.json({ googleMapsApiKey: process.env.GOOGLE_PLACES_API_KEY || '' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
