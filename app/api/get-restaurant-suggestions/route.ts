import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getPlacesClient } from "@/lib/services/places-client";
import type { RestaurantSuggestion, Coordinates } from "@/lib/models/travel-plan";
import { getPriceRangeSymbol } from "@/lib/utils/currency";

const RESTAURANT_TYPE_TOKENS = [
  "italian_restaurant",
  "chinese_restaurant",
  "mexican_restaurant",
  "japanese_restaurant",
  "indian_restaurant",
  "thai_restaurant",
  "french_restaurant",
  "american_restaurant",
  "mediterranean_restaurant",
  "vietnamese_restaurant",
  "korean_restaurant",
  "greek_restaurant",
];

/**
 * Get centroid of coordinates
 */
function getCentroid(coordinates: Coordinates[]): Coordinates {
  if (coordinates.length === 0) {
    return { lat: 0, lng: 0 };
  }
  const sum = coordinates.reduce(
    (acc, coord) => ({ lat: acc.lat + coord.lat, lng: acc.lng + coord.lng }),
    { lat: 0, lng: 0 }
  );
  return {
    lat: sum.lat / coordinates.length,
    lng: sum.lng / coordinates.length,
  };
}

function dedupePlacesById<T extends { place_id: string }>(places: T[]): T[] {
  const byId = new Map<string, T>();
  for (const place of places) {
    if (!byId.has(place.place_id)) {
      byId.set(place.place_id, place);
    }
  }
  return Array.from(byId.values());
}

/**
 * Get currency from session activities
 */
function getCurrencyFromSession(session: ReturnType<typeof sessionStore.get>): string {
  if (!session) return "USD";

  // Try to get currency from grouped days activities
  for (const day of session.groupedDays || []) {
    for (const activity of day.activities || []) {
      if (activity.currency) {
        return activity.currency;
      }
    }
  }

  // Fallback to suggested activities
  for (const activity of session.suggestedActivities || []) {
    if (activity.currency) {
      return activity.currency;
    }
  }

  return "USD";
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId" },
        { status: 400 }
      );
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Session not found or expired" },
        { status: 404 }
      );
    }

    // Validate state
    if (session.workflowState !== WORKFLOW_STATES.DAY_ITINERARY) {
      return NextResponse.json(
        {
          success: false,
          message: "Can only get restaurant suggestions from DAY_ITINERARY state",
        },
        { status: 400 }
      );
    }

    let placesClient;
    try {
      placesClient = getPlacesClient();
    } catch {
      return NextResponse.json(
        { success: false, message: "Places API not configured" },
        { status: 500 }
      );
    }

    // Collect all activity coordinates from grouped days
    const allCoordinates: Coordinates[] = [];
    for (const day of session.groupedDays) {
      for (const activity of day.activities) {
        if (activity.coordinates) {
          allCoordinates.push(activity.coordinates);
        }
      }
    }

    if (allCoordinates.length === 0) {
      return NextResponse.json(
        { success: false, message: "No activity coordinates available" },
        { status: 400 }
      );
    }

    // Get centroid of all activities for restaurant search
    const centroid = getCentroid(allCoordinates);

    // Get currency from session activities
    const currency = getCurrencyFromSession(session);

    // Primary pass: centroid search.
    let places = await placesClient.searchPlaces("restaurant", centroid, 3000, "restaurant");

    // Fallback 1: broader centroid radius.
    if (places.length === 0) {
      places = await placesClient.searchPlaces("restaurant", centroid, 12000, "restaurant");
    }

    // Fallback 2: search around each activity coordinate and merge.
    if (places.length === 0) {
      const perActivityResults = await Promise.all(
        allCoordinates.slice(0, 8).map((coord) =>
          placesClient.searchPlaces("restaurant", coord, 6000, "restaurant")
        )
      );
      places = dedupePlacesById(perActivityResults.flat());
    }

    // Fallback 3: destination text search.
    if (places.length === 0 && session.tripInfo.destination) {
      places = await placesClient.searchPlaces(
        `restaurants in ${session.tripInfo.destination}`,
        null,
        5000,
        "restaurant"
      );
    }

    // Convert to RestaurantSuggestion format with photos
    const restaurants: RestaurantSuggestion[] = await Promise.all(
      places.slice(0, 10).map(async (place, index) => {
        try {
          const details = place.place_id ? await placesClient.getPlaceDetails(place.place_id) : null;
          const photoUrls =
            details?.photos
              ?.slice(0, 3)
              .map((photo) => placesClient.getPlacePhotoUrl(photo.photo_reference, 300))
              .filter((url): url is string => Boolean(url)) || [];
          return {
            id: `rest${index + 1}`,
            name: place.name,
            cuisine:
              place.types.find((t) => RESTAURANT_TYPE_TOKENS.includes(t))?.replace("_restaurant", "").replace("_", " ") ||
              null,
            rating: details?.rating ?? place.rating ?? null,
            user_ratings_total: details?.user_ratings_total ?? null,
            priceRange: getPriceRangeSymbol(details?.price_level ?? place.price_level, currency),
            coordinates: place.location,
            place_id: place.place_id,
            vicinity: place.vicinity || null,
            formatted_address: details?.formatted_address ?? null,
            opening_hours: details?.opening_hours_text ?? null,
            website: details?.website ?? null,
            editorial_summary: details?.editorial_summary ?? null,
            photo_url: photoUrls[0] ?? null,
            photo_urls: photoUrls,
          };
        } catch {
          return {
            id: `rest${index + 1}`,
            name: place.name,
            cuisine:
              place.types.find((t) => RESTAURANT_TYPE_TOKENS.includes(t))?.replace("_restaurant", "").replace("_", " ") ||
              null,
            rating: place.rating || null,
            user_ratings_total: null,
            priceRange: getPriceRangeSymbol(place.price_level, currency),
            coordinates: place.location,
            place_id: place.place_id,
            vicinity: place.vicinity || null,
            formatted_address: null,
            opening_hours: null,
            website: null,
            editorial_summary: null,
            photo_url: null,
            photo_urls: [],
          };
        }
      })
    );

    // Update session
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.MEAL_PREFERENCES,
      restaurantSuggestions: restaurants,
      selectedRestaurantIds: [],
    });

    const message = `Found ${restaurants.length} restaurants near your activities. Select the ones you'd like to add to your itinerary!`;

    sessionStore.addToConversation(sessionId, "assistant", message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.MEAL_PREFERENCES,
      message,
      restaurantSuggestions: restaurants,
    });
  } catch (error) {
    console.error("Error in getRestaurantSuggestions:", error);
    return NextResponse.json(
      { success: false, message: "Failed to get restaurant suggestions", error: String(error) },
      { status: 500 }
    );
  }
}
