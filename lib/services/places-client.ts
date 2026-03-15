import fs from "fs";
import os from "os";
import path from "path";
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

export interface ReverseGeocodeResult {
  formattedAddress: string;
  locality?: string;
  adminAreaLevel1?: string;
  adminAreaLevel2?: string;
  country?: string;
  featureName?: string;
  parkName?: string;
  types: string[];
}

interface PlaceDetailsCacheEntry {
  cachedAt: number;
  details: PlaceDetails | null;
}

interface PlaceSearchCacheEntry {
  cachedAt: number;
  results: PlaceResult[];
}

interface ReverseGeocodeCacheEntry {
  cachedAt: number;
  result: ReverseGeocodeResult | null;
}

class PlacesClient {
  private client: Client;
  private apiKey: string;
  private placeDetailsCache = new Map<string, PlaceDetailsCacheEntry>();
  private placeSearchCache = new Map<string, PlaceSearchCacheEntry>();
  private reverseGeocodeCache = new Map<string, ReverseGeocodeCacheEntry>();
  private cacheLoaded = false;
  private readonly detailsCachePath: string;
  private readonly searchCachePath: string;
  private readonly reverseGeocodeCachePath: string;
  private readonly cacheTtlMs = 1000 * 60 * 60 * 24 * 30;
  private readonly searchCacheTtlMs = 1000 * 60 * 60 * 24 * 7;
  private readonly reverseGeocodeCacheVersion = 3;

  constructor() {
    const rawApiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
    if (!rawApiKey) {
      throw new Error("GOOGLE_PLACES_API_KEY or GOOGLE_GEOCODING_API_KEY not set.");
    }

    this.apiKey = rawApiKey.replace(/[^\x20-\x7E]/g, "").trim();
    if (!this.apiKey) {
      throw new Error("GOOGLE_PLACES_API_KEY / GOOGLE_GEOCODING_API_KEY is empty after sanitation.");
    }

    this.client = new Client({});
    const basePath = process.env.PLACES_CACHE_PATH || path.join(os.tmpdir(), "travel-planner-place-details-cache.json");
    this.detailsCachePath = basePath;
    this.searchCachePath = basePath.replace(/\.json$/i, ".search.json");
    this.reverseGeocodeCachePath = basePath.replace(/\.json$/i, ".geocode.json");
  }

  private loadCache(): void {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;

    try {
      if (fs.existsSync(this.detailsCachePath)) {
        const raw = fs.readFileSync(this.detailsCachePath, "utf8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as Record<string, PlaceDetailsCacheEntry>;
          for (const [placeId, entry] of Object.entries(parsed)) {
            if (!entry || typeof entry.cachedAt !== "number") continue;
            this.placeDetailsCache.set(placeId, {
              cachedAt: entry.cachedAt,
              details: entry.details ?? null,
            });
          }
        }
      }

      if (fs.existsSync(this.searchCachePath)) {
        const raw = fs.readFileSync(this.searchCachePath, "utf8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as Record<string, PlaceSearchCacheEntry>;
          for (const [cacheKey, entry] of Object.entries(parsed)) {
            if (!entry || typeof entry.cachedAt !== "number" || !Array.isArray(entry.results)) continue;
            this.placeSearchCache.set(cacheKey, {
              cachedAt: entry.cachedAt,
              results: entry.results,
            });
          }
        }
      }

      if (fs.existsSync(this.reverseGeocodeCachePath)) {
        const raw = fs.readFileSync(this.reverseGeocodeCachePath, "utf8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as Record<string, ReverseGeocodeCacheEntry>;
          for (const [cacheKey, entry] of Object.entries(parsed)) {
            if (!entry || typeof entry.cachedAt !== "number") continue;
            this.reverseGeocodeCache.set(cacheKey, {
              cachedAt: entry.cachedAt,
              result: entry.result ?? null,
            });
          }
        }
      }
    } catch (error) {
      console.warn("Failed to load Places cache:", (error as Error).message);
    }
  }

  private persistDetailsCache(): void {
    try {
      const serialized = JSON.stringify(Object.fromEntries(this.placeDetailsCache), null, 2);
      fs.writeFileSync(this.detailsCachePath, serialized, "utf8");
    } catch (error) {
      console.warn("Failed to persist Places details cache:", (error as Error).message);
    }
  }

  private persistSearchCache(): void {
    try {
      const serialized = JSON.stringify(Object.fromEntries(this.placeSearchCache), null, 2);
      fs.writeFileSync(this.searchCachePath, serialized, "utf8");
    } catch (error) {
      console.warn("Failed to persist Places search cache:", (error as Error).message);
    }
  }

  private persistReverseGeocodeCache(): void {
    try {
      const serialized = JSON.stringify(Object.fromEntries(this.reverseGeocodeCache), null, 2);
      fs.writeFileSync(this.reverseGeocodeCachePath, serialized, "utf8");
    } catch (error) {
      console.warn("Failed to persist reverse geocode cache:", (error as Error).message);
    }
  }

  private getCachedPlaceDetails(placeId: string): PlaceDetails | null | undefined {
    this.loadCache();
    const entry = this.placeDetailsCache.get(placeId);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.cacheTtlMs) {
      this.placeDetailsCache.delete(placeId);
      return undefined;
    }
    if (entry.details == null) {
      return undefined;
    }
    return entry.details;
  }

  private setCachedPlaceDetails(placeId: string, details: PlaceDetails | null): void {
    this.loadCache();
    this.placeDetailsCache.set(placeId, {
      cachedAt: Date.now(),
      details,
    });
    this.persistDetailsCache();
  }

  private buildSearchCacheKey(
    query: string,
    location: Coordinates | null,
    radius: number,
    placeType: string | null,
    options: {
      preferTextSearch?: boolean;
      region?: string;
    }
  ): string {
    return JSON.stringify({
      query: query.trim().toLowerCase(),
      location: location
        ? {
          lat: Number(location.lat.toFixed(4)),
          lng: Number(location.lng.toFixed(4)),
        }
        : null,
      radius,
      placeType,
      preferTextSearch: Boolean(options.preferTextSearch),
      region: options.region || null,
    });
  }

  private getCachedSearchResults(cacheKey: string): PlaceResult[] | undefined {
    this.loadCache();
    const entry = this.placeSearchCache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.searchCacheTtlMs) {
      this.placeSearchCache.delete(cacheKey);
      return undefined;
    }
    return entry.results;
  }

  private setCachedSearchResults(cacheKey: string, results: PlaceResult[]): void {
    this.loadCache();
    this.placeSearchCache.set(cacheKey, {
      cachedAt: Date.now(),
      results,
    });
    this.persistSearchCache();
  }

  private buildReverseGeocodeCacheKey(location: Coordinates): string {
    return JSON.stringify({
      version: this.reverseGeocodeCacheVersion,
      lat: Number(location.lat.toFixed(3)),
      lng: Number(location.lng.toFixed(3)),
    });
  }

  private getCachedReverseGeocode(cacheKey: string): ReverseGeocodeResult | null | undefined {
    this.loadCache();
    const entry = this.reverseGeocodeCache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.cacheTtlMs) {
      this.reverseGeocodeCache.delete(cacheKey);
      return undefined;
    }
    if (entry.result == null) {
      return undefined;
    }
    return entry.result;
  }

  private setCachedReverseGeocode(cacheKey: string, result: ReverseGeocodeResult | null): void {
    this.loadCache();
    this.reverseGeocodeCache.set(cacheKey, {
      cachedAt: Date.now(),
      result,
    });
    this.persistReverseGeocodeCache();
  }

  async searchPlaces(
    query: string,
    location: Coordinates | null = null,
    radius: number = 5000,
    placeType: string | null = null,
    options: {
      preferTextSearch?: boolean;
      region?: string;
    } = {}
  ): Promise<PlaceResult[]> {
    const cleanQuery = query.replace(/[^\x20-\x7E]/g, "").trim();
    const cacheKey = this.buildSearchCacheKey(cleanQuery, location, radius, placeType, options);
    const cached = this.getCachedSearchResults(cacheKey);
    if (cached) {
      return cached;
    }
    try {
      const useTextSearch = !location || options.preferTextSearch;
      if (useTextSearch) {
        const params: Record<string, unknown> = {
          key: this.apiKey,
          query: cleanQuery,
        };
        if (placeType) params.type = placeType;
        if (location) {
          params.location = location;
          params.radius = radius;
        }
        if (options.region) params.region = options.region;

        const response = await this.client.textSearch({
          params: params as unknown as Parameters<typeof this.client.textSearch>[0]["params"],
        });
        const results = this._processResults(response.data.results || []);
        this.setCachedSearchResults(cacheKey, results);
        return results;
      }

      // Nearby search
      const params: Record<string, unknown> = {
        key: this.apiKey,
        location: location,
        radius: radius,
        keyword: cleanQuery,
      };
      if (placeType) params.type = placeType;

      const response = await this.client.placesNearby({
        params: params as unknown as Parameters<typeof this.client.placesNearby>[0]["params"],
      });
      const results = this._processResults(response.data.results || []);
      this.setCachedSearchResults(cacheKey, results);
      return results;
    } catch (error) {
      const axiosError = error as any;
      const status = axiosError.response?.status;
      const message = axiosError.message;
      const data = axiosError.response?.data;

      console.error(`Error searching places for '${cleanQuery}':`, {
        status,
        message,
        data: data ? (typeof data === 'string' ? data.substring(0, 200) : data) : 'No response data'
      });

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
    const cached = this.getCachedPlaceDetails(placeId);
    if (cached !== undefined) {
      return cached;
    }

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
            // "photos",
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

      const details = {
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
      this.setCachedPlaceDetails(placeId, details);
      return details;
    } catch (error) {
      console.error("Error getting place details:", (error as Error).message);
      return null;
    }
  }

  async reverseGeocode(location: Coordinates): Promise<ReverseGeocodeResult | null> {
    const cacheKey = this.buildReverseGeocodeCacheKey(location);
    const cached = this.getCachedReverseGeocode(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const response = await this.client.reverseGeocode({
        params: {
          latlng: location,
          key: this.apiKey,
          result_type: [
            "locality",
            "postal_town",
            "administrative_area_level_2",
            "administrative_area_level_1",
            "natural_feature",
            "park",
          ],
        } as unknown as Parameters<typeof this.client.reverseGeocode>[0]["params"],
      });

      const results = Array.isArray(response.data.results) ? response.data.results : [];
      const hasType = (types: unknown, expected: string) =>
        Array.isArray(types) && types.some((type) => String(type) === expected);
      const getResultName = (result: (typeof results)[number] | undefined): string | undefined => {
        if (!result) return undefined;

        const components = Array.isArray(result.address_components) ? result.address_components : [];
        const firstComponent = components.find((component) => typeof component.long_name === "string")?.long_name;
        if (firstComponent?.trim()) return firstComponent.trim();

        const formattedAddress = typeof result.formatted_address === "string" ? result.formatted_address.trim() : "";
        if (!formattedAddress) return undefined;

        return formattedAddress.split(",")[0]?.trim() || undefined;
      };
      const prioritized =
        results.find((result) => hasType(result.types, "locality")) ||
        results.find((result) => hasType(result.types, "postal_town")) ||
        results.find((result) => hasType(result.types, "administrative_area_level_2")) ||
        results[0];
      const featureResult = results.find((result) => hasType(result.types, "natural_feature"));
      const parkResult = results.find((result) => hasType(result.types, "park"));

      if (!prioritized) {
        this.setCachedReverseGeocode(cacheKey, null);
        return null;
      }

      const components = Array.isArray(prioritized.address_components) ? prioritized.address_components : [];
      const getComponent = (type: string) =>
        components.find((component) => hasType(component.types, type))?.long_name;

      const result: ReverseGeocodeResult = {
        formattedAddress: prioritized.formatted_address || "",
        locality: getComponent("locality") || getComponent("postal_town"),
        adminAreaLevel1: getComponent("administrative_area_level_1"),
        adminAreaLevel2: getComponent("administrative_area_level_2"),
        country: getComponent("country"),
        featureName: getResultName(featureResult),
        parkName: getResultName(parkResult),
        types: Array.isArray(prioritized.types) ? prioritized.types : [],
      };
      this.setCachedReverseGeocode(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Error reverse geocoding:", (error as Error).message);
      return null;
    }
  }

  getPlacePhotoUrl(photoReference: string | null, maxWidth: number = 400): string | null {
    if (!photoReference) return null;
    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${this.apiKey}`;
  }

  async getPlacePhotoUrlsFromId(placeId: string | null, maxWidth: number = 400): Promise<string[]> {
    return [];
    /*
    if (!placeId) return [];
    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          key: this.apiKey,
          fields: ["photos"],
        },
      });
      const result = response.data.result;

      if (!result || !result.photos || result.photos.length === 0) {
        return [];
      }

      return result.photos
        .slice(0, 3)
        .map((photo) => this.getPlacePhotoUrl(photo.photo_reference, maxWidth))
        .filter((url): url is string => Boolean(url));
    } catch {
      return [];
    }
    */
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
