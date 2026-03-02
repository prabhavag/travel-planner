import { Client } from "@googlemaps/google-maps-services-js";
import type { Coordinates } from "@/lib/models/travel-plan";

export interface PlaceResult {
  name: string;
  place_id: string;
  types: string[];
  rating: number;
  user_ratings_total: number;
  location: Coordinates;
  vicinity: string;
  price_level?: number;
}

export interface PlaceDetails {
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: unknown;
  opening_hours_text?: string;
  editorial_summary?: string;
  price_level?: number;
  types?: string[];
  geometry?: unknown;
  photos?: Array<{ photo_reference: string }>;
}

class PlacesClient {
  private client: Client;
  private apiKey: string;

  constructor() {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_PLACES_API_KEY not set.");
    }

    if (!apiKey.trim()) {
      throw new Error("GOOGLE_PLACES_API_KEY is empty.");
    }

    this.client = new Client({});
    this.apiKey = apiKey.trim();
  }

  async searchPlaces(
    query: string,
    location: Coordinates | null = null,
    radius: number = 5000,
    placeType: string | null = null
  ): Promise<PlaceResult[]> {
    try {
      if (location) {
        // Nearby search
        const params: Record<string, unknown> = {
          key: this.apiKey,
          location: location,
          radius: radius,
          keyword: query,
        };
        if (placeType) params.type = placeType;

        const response = await this.client.placesNearby({
          params: params as unknown as Parameters<typeof this.client.placesNearby>[0]["params"],
        });
        return this._processResults(response.data.results || []);
      } else {
        // Text search
        const params: Record<string, unknown> = {
          key: this.apiKey,
          query: query,
        };
        if (placeType) params.type = placeType;

        const response = await this.client.textSearch({
          params: params as unknown as Parameters<typeof this.client.textSearch>[0]["params"],
        });
        return this._processResults(response.data.results || []);
      }
    } catch (error) {
      console.error("Error searching places:", (error as Error).message);
      return [];
    }
  }

  private _processResults(results: unknown[]): PlaceResult[] {
    return results.slice(0, 10).map((place: unknown) => {
      const p = place as {
        name: string;
        place_id: string;
        types: string[];
        rating?: number;
        user_ratings_total?: number;
        geometry: { location: { lat: number; lng: number } };
        vicinity?: string;
        formatted_address?: string;
        price_level?: number;
      };
      return {
        name: p.name,
        place_id: p.place_id,
        types: p.types,
        rating: p.rating || 0.0,
        user_ratings_total: p.user_ratings_total || 0,
        location: p.geometry.location,
        vicinity: p.vicinity || p.formatted_address || "",
        price_level: p.price_level,
      };
    });
  }

  async getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          key: this.apiKey,
          fields: [
            "name",
            "formatted_address",
            "formatted_phone_number",
            "website",
            "rating",
            "user_ratings_total",
            "opening_hours",
            "editorial_summary",
            "price_level",
            "types",
            "geometry",
          ],
        },
      });

      const result = response.data.result;
      if (!result) return null;
      const weekdayText = Array.isArray(result.opening_hours?.weekday_text)
        ? result.opening_hours.weekday_text.filter((value): value is string => typeof value === "string")
        : [];
      const editorialSummary =
        result.editorial_summary && typeof result.editorial_summary.overview === "string"
          ? result.editorial_summary.overview
          : undefined;

      return {
        name: result.name || "",
        formatted_address: result.formatted_address,
        formatted_phone_number: result.formatted_phone_number,
        website: result.website,
        rating: result.rating,
        user_ratings_total: result.user_ratings_total,
        opening_hours: result.opening_hours,
        opening_hours_text: weekdayText[0],
        editorial_summary: editorialSummary,
        price_level: result.price_level,
        types: result.types,
        geometry: result.geometry,
        photos: (result.photos || []).slice(0, 3).map((p) => ({
          photo_reference: p.photo_reference,
        })),
      };
    } catch (error) {
      console.error("Error getting place details:", (error as Error).message);
      return null;
    }
  }

  getPlacePhotoUrl(photoReference: string | null, maxWidth: number = 400): string | null {
    if (!photoReference) return null;
    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${this.apiKey}`;
  }

  async getPlacePhotoUrlsFromId(placeId: string | null, maxWidth: number = 400): Promise<string[]> {
    return [];
  }

}

// Export singleton
let placesClientInstance: PlacesClient | null = null;

export function getPlacesClient(): PlacesClient {
  if (!placesClientInstance) {
    placesClientInstance = new PlacesClient();
  }
  return placesClientInstance;
}

export { PlacesClient };
