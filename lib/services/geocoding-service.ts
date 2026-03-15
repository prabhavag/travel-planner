import { Client } from "@googlemaps/google-maps-services-js";
import type { Coordinates } from "@/lib/models/travel-plan";

export interface GeocodeResult {
  location: Coordinates | null;
  countryName?: string;
  countryCode?: string;
}

class GeocodingService {
  private client: Client;
  private apiKey: string;

  constructor() {
    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_GEOCODING_API_KEY not set.");
    }

    if (!apiKey.trim()) {
      throw new Error("GOOGLE_GEOCODING_API_KEY is empty.");
    }

    this.client = new Client({});
    this.apiKey = apiKey.trim();
  }

  async geocode(address: string): Promise<Coordinates | null> {
    const result = await this.geocodeWithCountry(address);
    return result.location;
  }

  async geocodeWithCountry(address: string): Promise<GeocodeResult> {
    try {
      const response = await this.client.geocode({
        params: {
          address: address,
          key: this.apiKey,
        },
      });

      if (response.data.results && response.data.results.length > 0) {
        const primary = response.data.results[0];
        const location = primary.geometry.location;
        const countryComponent = Array.isArray(primary.address_components)
          ? primary.address_components.find((component) => (component.types as string[])?.includes("country"))
          : undefined;
        return {
          location: { lat: location.lat, lng: location.lng },
          countryName: countryComponent?.long_name,
          countryCode: countryComponent?.short_name,
        };
      }
      return { location: null };
    } catch (error) {
      console.error(`Geocoding error for '${address}':`, (error as Error).message);
      return { location: null };
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const response = await this.client.reverseGeocode({
        params: {
          latlng: { lat, lng },
          key: this.apiKey,
        },
      });

      if (response.data.results && response.data.results.length > 0) {
        return response.data.results[0].formatted_address;
      }
      return null;
    } catch (error) {
      console.error("Reverse geocoding error:", (error as Error).message);
      return null;
    }
  }
}

// Export singleton
let geocodingServiceInstance: GeocodingService | null = null;

export function getGeocodingService(): GeocodingService {
  if (!geocodingServiceInstance) {
    geocodingServiceInstance = new GeocodingService();
  }
  return geocodingServiceInstance;
}

export { GeocodingService };
