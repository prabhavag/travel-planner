# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the Application

```bash
# Start the application
./run.sh

# Or directly with npm
npm run dev
```

The app runs on http://localhost:3000

### Development

```bash
# Next.js with Turbopack
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint
```

### Installing Dependencies

```bash
npm install
```

## Architecture

This is a full-stack AI travel planning application built with Next.js (App Router).

### App Structure (`/app/`)

- **page.tsx** - Main landing page
- **planner/** - Travel planner interface
- **api/** - API route handlers:
  - `start-session/` - Initialize session, begin INFO_GATHERING
  - `chat/` - Chat in INFO_GATHERING, SUGGEST_ACTIVITIES, or REVIEW states
  - `suggest-activities/` - Generate top 10-15 activities for destination
  - `select-activities/` - Record user's activity selections
  - `group-days/` - Organize selected activities into day groups
  - `adjust-day-groups/` - Modify day groupings
  - `confirm-day-grouping/` - Confirm day structure
  - `get-restaurant-suggestions/` - Find restaurants near activities
  - `meal-preferences/` - Add/skip restaurants
  - `start-review/` - Transition to REVIEW state
  - `finalize/` - Enrich with Places API, generate final plan
  - `session/[sessionId]/` - Get current session state

### Components (`/components/`)

- **MapComponent.tsx** - Google Maps integration
- **DetailedItineraryView.tsx** - Day-by-day itinerary with activity details
- **ui/** - Reusable UI components (Button, Card, Badge, etc.)

### Services (`/lib/services/`)

- **llm-client.ts** - OpenAI for itinerary generation with workflow-specific methods
- **places-client.ts** - Google Places for activity enrichment (coordinates, photos, ratings)
- **geocoding-service.ts** - Location coordinate lookup
- **session-store.ts** - In-memory session management with 30-min TTL
- **prompts.ts** - Externalized LLM prompts for each workflow state

### Shared (`/lib/`)

- **api-client.ts** - Frontend API client for API routes
- **models/travel-plan.ts** - TypeScript types and Zod schemas

### Data Flow

1. Map view on the left (60%), chat sidebar on the right (40%)
2. Session-based workflow with the following states:
   1. **INFO_GATHERING** - Collect destination, dates, interests via chat
   2. **SUGGEST_ACTIVITIES** - Generate top 10-15 activities for destination
   3. **SELECT_ACTIVITIES** - User selects which activities interest them
   4. **GROUP_DAYS** - Organize selected activities into daily itineraries
   5. **DAY_ITINERARY** - Present day-by-day breakdown, user can add restaurants
   6. **MEAL_PREFERENCES** - User selects restaurants or skips
   7. **REVIEW** - Final review, user can request changes
   8. **FINALIZE** - Enrich with Places API, generate final itinerary

## Environment Variables

Required in `.env` (root directory):
- `OPENAI_API_KEY` - For itinerary generation
- `GOOGLE_PLACES_API_KEY` - Google Places for activity enrichment
- `GOOGLE_GEOCODING_API_KEY` - Location coordinate lookup
