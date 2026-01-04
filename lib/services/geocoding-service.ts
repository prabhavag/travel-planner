import { Client } from "@googlemaps/google-maps-services-js";
import type { Coordinates } from "@/lib/models/travel-plan";

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
    try {
      const response = await this.client.geocode({
        params: {
          address: address,
          key: this.apiKey,
        },
      });

      if (response.data.results && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        return { lat: location.lat, lng: location.lng };
      }
      return null;
    } catch (error) {
      console.error(`Geocoding error for '${address}':`, (error as Error).message);
      return null;
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
