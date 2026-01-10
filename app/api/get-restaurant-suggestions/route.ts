import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getPlacesClient } from "@/lib/services/places-client";
import type { RestaurantSuggestion, Coordinates } from "@/lib/models/travel-plan";
import { getPriceRangeSymbol } from "@/lib/utils/currency";

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

    // Search for restaurants near the centroid
    const searchRadius = 3000; // 3km radius
    const places = await placesClient.searchPlaces(
      "restaurant",
      centroid,
      searchRadius,
      "restaurant"
    );

    // Convert to RestaurantSuggestion format with photos
    const restaurants: RestaurantSuggestion[] = await Promise.all(
      places.slice(0, 15).map(async (place, index) => {
        // Fetch photo URL for each restaurant
        let photoUrl: string | null = null;
        if (place.place_id) {
          photoUrl = await placesClient.getPlacePhotoUrlFromId(place.place_id, 200);
        }
        return {
          id: `rest${index + 1}`,
          name: place.name,
          cuisine: place.types.find((t) =>
            ["italian_restaurant", "chinese_restaurant", "mexican_restaurant", "japanese_restaurant", "indian_restaurant", "thai_restaurant", "french_restaurant", "american_restaurant", "mediterranean_restaurant", "vietnamese_restaurant", "korean_restaurant", "greek_restaurant"].includes(t)
          )?.replace("_restaurant", "").replace("_", " ") || null,
          rating: place.rating || null,
          priceRange: getPriceRangeSymbol(place.price_level, currency),
          coordinates: place.location,
          place_id: place.place_id,
          vicinity: place.vicinity || null,
          photo_url: photoUrl,
        };
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
