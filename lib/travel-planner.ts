import { getLLMClient, LLMClient } from "./services/llm-client";
import { getPlacesClient, PlacesClient } from "./services/places-client";
import { getGeocodingService, GeocodingService } from "./services/geocoding-service";
import type { TravelPlan, ExpandedDay, Coordinates, TravelRequest } from "./models/travel-plan";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

class TravelPlanner {
  private llmClient: LLMClient;
  private placesClient: PlacesClient;
  private geocoding: GeocodingService;

  constructor() {
    this.llmClient = getLLMClient();
    this.placesClient = getPlacesClient();
    this.geocoding = getGeocodingService();
  }

  async generateTravelPlan(request: TravelRequest) {
    try {
      let duration = 0;
      if (request.start_date && request.end_date) {
        const start = new Date(request.start_date);
        const end = new Date(request.end_date);
        duration = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }

      const destCoords = request.destination ? await this.geocoding.geocode(request.destination) : null;

      const llmPlanData = await this.llmClient.generateTravelPlan({
        ...request,
        duration_days: duration,
      });

      if (destCoords && llmPlanData.itinerary) {
        llmPlanData.itinerary = await this._enrichItineraryWithPlaces(llmPlanData.itinerary, destCoords);
      }

      const formattedPlan = this._formatPlan(llmPlanData, request, duration);

      return formattedPlan;
    } catch (error) {
      console.error("Error inside TravelPlanner:", error);
      throw error;
    }
  }

  async modifyTravelPlan(request: {
    current_plan: TravelPlan;
    user_message: string;
    conversation_history?: ConversationMessage[];
    finalize?: boolean;
  }) {
    try {
      const { current_plan, user_message, conversation_history, finalize } = request;

      const result = await this.llmClient.modifyItinerary(
        current_plan,
        user_message,
        conversation_history || [],
        finalize || false
      );

      if (result.success && result.plan) {
        let destCoords: Coordinates | null = null;
        const plan = result.plan as TravelPlan;
        if (plan.destination) {
          destCoords = await this.geocoding.geocode(plan.destination);
        }

        if (destCoords && plan.itinerary) {
          plan.itinerary = await this._enrichItineraryWithPlaces(plan.itinerary, destCoords);
        }
      }
      return result;
    } catch (error) {
      console.error("Error inside TravelPlanner modify:", error);
      throw error;
    }
  }

  private async _enrichItineraryWithPlaces(
    itineraryData: TravelPlan["itinerary"],
    destinationCoords: Coordinates
  ) {
    if (!itineraryData) return [];

    const enrichedItinerary = [];

    for (const dayData of itineraryData) {
      const enrichedDay = { ...dayData };

      for (const timeSlot of ["morning", "afternoon", "evening"] as const) {
        const activities = enrichedDay[timeSlot];
        if (activities) {
          const enrichedActivities = [];

          for (const activity of activities) {
            const activityName = activity.name;
            if (activityName && destinationCoords) {
              const placeData = await this.placesClient.enrichActivityWithPlaces(
                activityName,
                destinationCoords,
                activity.type === "attraction" ? "tourist_attraction" : "restaurant"
              );

              if (placeData) {
                activity.rating = placeData.rating;
                activity.location = placeData.vicinity;
                activity.user_ratings_total = placeData.user_ratings_total;
                activity.coordinates = placeData.location;
                activity.place_id = placeData.place_id;
              }
            }
            enrichedActivities.push(activity);
          }
          enrichedDay[timeSlot] = enrichedActivities;
        }
      }
      enrichedItinerary.push(enrichedDay);
    }
    return enrichedItinerary;
  }

  private _formatPlan(llmData: unknown, request: TravelRequest, duration: number) {
    const data = llmData as Record<string, unknown>;

    if (data.transportation && !Array.isArray(data.transportation)) {
      data.transportation = [data.transportation];
    }

    return {
      ...data,
      duration_days: duration,
      start_date: request.start_date,
      end_date: request.end_date,
      destination: request.destination || data.destination || "To be decided",
    };
  }

  async geocodeExpandedDay(expandedDay: ExpandedDay, destination: string): Promise<ExpandedDay> {
    if (!expandedDay || !destination) {
      return expandedDay;
    }

    const destCoords = await this.geocoding.geocode(destination);
    if (!destCoords) {
      console.warn("Could not geocode destination:", destination);
      return expandedDay;
    }

    const geocodePlace = async (name: string, type: string = "tourist_attraction"): Promise<Coordinates | null> => {
      if (!name) return null;
      try {
        const placeData = await this.placesClient.enrichActivityWithPlaces(name, destCoords, type);
        if (placeData && placeData.location) {
          return {
            lat: placeData.location.lat,
            lng: placeData.location.lng,
          };
        }
      } catch (err) {
        console.warn(`Failed to geocode ${name}:`, (err as Error).message);
      }
      return null;
    };

    // Geocode meals
    for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
      const meal = expandedDay[mealType];
      if (meal && meal.name && !meal.coordinates?.lat) {
        const coords = await geocodePlace(meal.name, "restaurant");
        if (coords) {
          meal.coordinates = coords;
        }
      }
    }

    // Geocode activities in each time slot
    for (const timeSlot of ["morning", "afternoon", "evening"] as const) {
      const activities = expandedDay[timeSlot];
      if (activities && Array.isArray(activities)) {
        for (const activity of activities) {
          if (activity.name && !activity.coordinates?.lat) {
            const placeType = activity.type === "restaurant" ? "restaurant" : "tourist_attraction";
            const coords = await geocodePlace(activity.name, placeType);
            if (coords) {
              activity.coordinates = coords;
            }
          }
        }
      }
    }

    return expandedDay;
  }

  async enrichFinalPlan(finalPlan: TravelPlan): Promise<TravelPlan> {
    if (!finalPlan || !finalPlan.destination) {
      return finalPlan;
    }

    const destCoords = await this.geocoding.geocode(finalPlan.destination);
    if (!destCoords) {
      console.warn("Could not geocode destination:", finalPlan.destination);
      return finalPlan;
    }

    if (finalPlan.itinerary && Array.isArray(finalPlan.itinerary)) {
      for (const day of finalPlan.itinerary) {
        // Enrich meals
        for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
          const meal = day[mealType];
          if (meal && meal.name) {
            const placeData = await this.placesClient.enrichActivityWithPlaces(meal.name, destCoords, "restaurant");
            if (placeData) {
              meal.rating = placeData.rating;
              meal.place_id = placeData.place_id;
              meal.coordinates = {
                lat: placeData.location?.lat,
                lng: placeData.location?.lng,
              };
            }
          }
        }

        // Enrich activities
        for (const timeSlot of ["morning", "afternoon", "evening"] as const) {
          const activities = day[timeSlot];
          if (activities && Array.isArray(activities)) {
            for (const activity of activities) {
              if (activity.name) {
                const placeType = activity.type === "restaurant" ? "restaurant" : "tourist_attraction";
                const placeData = await this.placesClient.enrichActivityWithPlaces(activity.name, destCoords, placeType);
                if (placeData) {
                  activity.rating = placeData.rating;
                  activity.place_id = placeData.place_id;
                  activity.user_ratings_total = placeData.user_ratings_total;
                  activity.location = placeData.vicinity;
                  activity.coordinates = placeData.location;
                }
              }
            }
          }
        }
      }
    }

    return finalPlan;
  }
}

// Export singleton
let travelPlannerInstance: TravelPlanner | null = null;

export function getTravelPlanner(): TravelPlanner {
  if (!travelPlannerInstance) {
    travelPlannerInstance = new TravelPlanner();
  }
  return travelPlannerInstance;
}

export { TravelPlanner };
