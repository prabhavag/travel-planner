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
  - `chat/` - Chat in INFO_GATHERING or REVIEW states
  - `generate-skeleton/` - Generate day themes after info complete
  - `expand-day/` - Expand a specific day with activities + meals
  - `modify-day/` - Modify an already-expanded day
  - `suggest-activities/` - Suggest activities for a day
  - `suggest-meals-nearby/` - Find restaurants near selected activities
  - `confirm-day-selections/` - Confirm user selections
  - `start-review/` - Transition to REVIEW state
  - `finalize/` - Enrich with Places API, generate final plan
  - `session/[sessionId]/` - Get current session state

### Components (`/components/`)

- **MapComponent.tsx** - Google Maps integration
- **SkeletonView.tsx** - Display day themes and progress during planning
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
   2. **SKELETON** - Generate day themes only (no detailed activities)
   3. **EXPAND_DAY** - Expand each day with activities + meals
   4. **REVIEW** - All days expanded, user can edit any day
   5. **FINALIZE** - Enrich with Places API, generate final itinerary

## Environment Variables

Required in `.env` (root directory):
- `OPENAI_API_KEY` - For itinerary generation
- `GOOGLE_PLACES_API_KEY` - Google Places for activity enrichment
- `GOOGLE_GEOCODING_API_KEY` - Location coordinate lookup
