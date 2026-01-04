import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getPlacesClient } from "@/lib/services/places-client";

interface Coordinates {
  lat: number;
  lng: number;
}

interface ActivityOption {
  id: string;
  name: string;
  coordinates?: Coordinates | null;
}

interface MealOption {
  id: string;
  name: string;
  cuisine: string | null;
  description: string;
  rating?: number;
  priceRange: string;
  coordinates?: Coordinates;
  place_id?: string;
}

function priceLevelToRange(priceLevel: number | undefined): string {
  switch (priceLevel) {
    case 0:
      return "Free";
    case 1:
      return "$";
    case 2:
      return "$$";
    case 3:
      return "$$$";
    case 4:
      return "$$$$";
    default:
      return "$$";
  }
}

function inferCuisineFromTypes(types: string[] | undefined): string | null {
  if (!types || types.length === 0) return null;

  const cuisineTypes = [
    "italian_restaurant",
    "chinese_restaurant",
    "japanese_restaurant",
    "mexican_restaurant",
    "indian_restaurant",
    "thai_restaurant",
    "french_restaurant",
    "greek_restaurant",
    "korean_restaurant",
    "vietnamese_restaurant",
    "american_restaurant",
    "mediterranean_restaurant",
    "middle_eastern_restaurant",
    "seafood_restaurant",
    "steakhouse",
    "pizza_restaurant",
    "sushi_restaurant",
    "cafe",
    "bakery",
    "breakfast_restaurant",
    "brunch_restaurant",
  ];

  for (const type of types) {
    if (cuisineTypes.includes(type)) {
      return type
        .replace("_restaurant", "")
        .replace(/_/g, " ")
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }

  if (types.includes("restaurant")) return "Restaurant";
  if (types.includes("cafe")) return "Café";
  if (types.includes("bakery")) return "Bakery";
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, dayNumber, selectedActivities } = await request.json();

    if (!sessionId || !selectedActivities) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId or selectedActivities" },
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

    const targetDay = dayNumber || session.currentExpandDay || 1;

    // Get stored activity suggestions
    const storedSuggestions = session.currentActivitySuggestions;
    if (!storedSuggestions || storedSuggestions.dayNumber !== targetDay) {
      return NextResponse.json(
        {
          success: false,
          message: "No activity suggestions found. Call suggest-activities first.",
        },
        { status: 400 }
      );
    }

    const activitySuggestions = storedSuggestions.suggestions;

    // Helper to get selected activities with coordinates
    const getSelectedWithCoords = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: any[] | undefined,
      selectedIds: string[] | undefined
    ): ActivityOption[] => {
      if (!options || !selectedIds || selectedIds.length === 0) return [];
      return options.filter((opt: ActivityOption) => selectedIds.includes(opt.id) && opt.coordinates);
    };

    const selectedMorning = getSelectedWithCoords(
      activitySuggestions.morningActivities,
      selectedActivities.morningActivities
    );
    const selectedAfternoon = getSelectedWithCoords(
      activitySuggestions.afternoonActivities,
      selectedActivities.afternoonActivities
    );
    const selectedEvening = getSelectedWithCoords(
      activitySuggestions.eveningActivities,
      selectedActivities.eveningActivities
    );

    // Determine reference coordinates for each meal
    const breakfastRef = selectedMorning[0]?.coordinates || null;
    const lunchRef =
      selectedAfternoon[0]?.coordinates ||
      selectedMorning[selectedMorning.length - 1]?.coordinates ||
      null;
    const dinnerRef =
      selectedEvening[0]?.coordinates ||
      selectedAfternoon[selectedAfternoon.length - 1]?.coordinates ||
      null;

    // Initialize PlacesClient
    const placesClient = getPlacesClient();
    if (!placesClient) {
      return NextResponse.json(
        { success: false, message: "Places API not available" },
        { status: 500 }
      );
    }

    const destination = session.tripInfo.destination || "";
    const radius = 1500; // 1.5km radius

    // Search for nearby restaurants for each meal
    const searchMeals = async (
      coords: Coordinates | null,
      mealType: string
    ): Promise<MealOption[]> => {
      try {
        const results = await placesClient.searchPlaces(
          coords ? `${mealType} restaurant` : `${mealType} restaurant ${destination}`,
          coords || undefined,
          coords ? radius : undefined,
          "restaurant"
        );

        return results.slice(0, 3).map((place, idx) => ({
          id: `${mealType[0]}${idx + 1}`,
          name: place.name,
          cuisine: inferCuisineFromTypes(place.types),
          description: place.vicinity || "",
          rating: place.rating,
          priceRange: priceLevelToRange(place.price_level),
          coordinates: place.location,
          place_id: place.place_id,
        }));
      } catch (error) {
        console.warn(`Failed to search ${mealType} restaurants:`, (error as Error).message);
        return [];
      }
    };

    // Search for all meals in parallel
    const [breakfast, lunch, dinner] = await Promise.all([
      searchMeals(breakfastRef, "breakfast"),
      searchMeals(lunchRef, "lunch"),
      searchMeals(dinnerRef, "dinner"),
    ]);

    const mealSuggestions = {
      dayNumber: targetDay,
      breakfast,
      lunch,
      dinner,
    };

    // Store meal suggestions in session
    sessionStore.update(sessionId, {
      currentMealSuggestions: {
        dayNumber: targetDay,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        suggestions: mealSuggestions as any,
      },
    });

    const message =
      "I found some great dining options near your selected activities! Here are restaurant suggestions for breakfast, lunch, and dinner. Select your preferences for each meal.";
    sessionStore.addToConversation(sessionId, "assistant", message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.EXPAND_DAY,
      message,
      mealSuggestions,
      dayNumber: targetDay,
    });
  } catch (error) {
    console.error("Error in suggestMealsNearby:", error);
    return NextResponse.json(
      { success: false, message: "Failed to suggest meals", error: String(error) },
      { status: 500 }
    );
  }
}
