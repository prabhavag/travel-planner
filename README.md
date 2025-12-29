# ✈️ Travel Planner

A Streamlit-based travel planning application that generates personalized travel plans with multiple options based on different budgets and preferences.

## Features

- 🌍 **Multi-Plan Generation**: Creates 3 travel plan variants (Budget-Friendly, Balanced, Comfort-Focused)
- ✈️ **Flight Recommendations**: Integrates with Amadeus API for real-time flight search and booking
- 🏨 **Accommodation Suggestions**: Hotel recommendations with pricing
- 📅 **Day-by-Day Itineraries**: Detailed daily schedules with activities for mornings, afternoons, and evenings
- 💰 **Cost Breakdowns**: Complete cost analysis including transportation, accommodation, activities, food, and local transport
- 🗺️ **Real Places Integration**: Uses Google Places API to enrich itineraries with real locations and ratings

## Technology Stack

- **Frontend**: Streamlit
- **LLM**: OpenAI GPT-3.5-turbo (or DeepSeek)
- **Flights API**: Amadeus Flight Offers Search API (with booking capability)
- **Places API**: Google Places API
- **Geocoding**: Google Geocoding API
- **Language**: Python 3.8+

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd travel-planner
```

### 2. Install Dependencies

```bash
conda create -n travel-planner
conda activate tranver-planner
pip install -r requirements.txt
```

### 3. Set Up API Keys

Create a `.env` file in the root directory:

```bash
# LLM API Key (choose one)
OPENAI_API_KEY=sk-your-openai-api-key-here
# DEEPSEEK_API_KEY=your-deepseek-api-key-here

# Amadeus API (for Flight Search and Booking)
AMADEUS_CLIENT_ID=your-amadeus-client-id-here
AMADEUS_CLIENT_SECRET=your-amadeus-client-secret-here
AMADEUS_ENVIRONMENT=test  # Use "test" for sandbox or "production" for live

# Google APIs
GOOGLE_PLACES_API_KEY=your-google-places-api-key-here
GOOGLE_GEOCODING_API_KEY=your-google-geocoding-api-key-here
```

**For Streamlit Cloud deployment**, use Streamlit Secrets (see Streamlit Cloud app settings).

**Important**: Set usage limits and restrictions on your API keys in provider dashboards.

### 4. Get API Keys

#### OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key

#### Amadeus API Credentials
1. Go to [Amadeus for Developers](https://developers.amadeus.com/)
2. Sign up for a free account
3. Create a new app in your dashboard
4. Get your `CLIENT_ID` and `CLIENT_SECRET`
5. Use the test environment for development (free tier available)
6. The Amadeus API provides real-time flight search and booking capabilities from over 500 airlines

#### Google Places API Key
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable "Places API" and "Geocoding API"
4. Go to "Credentials" and create an API key
5. The $200 free credit should cover most usage

### 5. Run the Application

```bash
streamlit run app.py
```

The app will open in your default web browser at `http://localhost:8501`

### 6. Deploy to Streamlit Cloud (Optional)

For deploying to Streamlit Cloud:
1. Push your code to GitHub
2. Connect your repository to [Streamlit Cloud](https://streamlit.io/cloud)
3. Streamlit will automatically detect `requirements.txt`
4. Set up your API keys in Streamlit Secrets (see Streamlit Cloud app settings)
5. Deploy!
