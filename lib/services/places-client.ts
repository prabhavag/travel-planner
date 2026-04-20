import { Client } from "@googlemaps/google-maps-services-js";
import type { Coordinates } from "@/lib/models/travel-plan";
import {
  buildCachedPlaceInfoFromPlaceDetails,
  buildCachedPlaceInfoFromSearchResult,
  extractLatLngFromGeometry,
  getCachedPlaceInfo,
  setCachedPlaceInfo,
  type CachedPlaceAddressComponent,
  type CachedPlaceInfo,
  type CachedPlacePhoto,
} from "@/lib/services/place-info-cache";

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
  address_components?: CachedPlaceAddressComponent[];
  photos?: CachedPlacePhoto[];
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  locality?: string;
  adminAreaLevel1?: string;
  adminAreaLevel2?: string;
  country?: string;
  countryCode?: string;
  featureName?: string;
  parkName?: string;
  types: string[];
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
  private placeSearchCache = new Map<string, PlaceSearchCacheEntry>();
  private reverseGeocodeCache = new Map<string, ReverseGeocodeCacheEntry>();
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
  }

  private buildPlaceDetailsFromCache(info: CachedPlaceInfo): PlaceDetails {
    return {
      name: info.name,
      formatted_address: info.formattedAddress || undefined,
      formatted_phone_number: info.formattedPhoneNumber || undefined,
      website: info.website || undefined,
      rating: info.rating ?? undefined,
      user_ratings_total: info.userRatingsTotal ?? undefined,
      opening_hours_text: info.openingHoursText || undefined,
      editorial_summary: info.editorialSummary || undefined,
      price_level: info.priceLevel ?? undefined,
      types: info.types,
      geometry: {
        location: {
          lat: info.lat,
          lng: info.lng,
        },
      },
      address_components: info.addressComponents.length > 0 ? info.addressComponents : undefined,
      photos: info.photos.length > 0 ? info.photos : undefined,
    };
  }

  private buildSearchCacheKey(
    query: string,
    location: Coordinates | null,
    radius: number,
    placeType: string | null,
    options: {
      preferTextSearch?: boolean;
      region?: string;
    },
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
    const entry = this.placeSearchCache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.searchCacheTtlMs) {
      this.placeSearchCache.delete(cacheKey);
      return undefined;
    }
    return entry.results;
  }

  private setCachedSearchResults(cacheKey: string, results: PlaceResult[]): void {
    this.placeSearchCache.set(cacheKey, {
      cachedAt: Date.now(),
      results,
    });
  }

  private buildReverseGeocodeCacheKey(location: Coordinates): string {
    return JSON.stringify({
      version: this.reverseGeocodeCacheVersion,
      lat: Number(location.lat.toFixed(3)),
      lng: Number(location.lng.toFixed(3)),
    });
  }

  private getCachedReverseGeocode(cacheKey: string): ReverseGeocodeResult | null | undefined {
    const entry = this.reverseGeocodeCache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.cacheTtlMs) {
      this.reverseGeocodeCache.delete(cacheKey);
      return undefined;
    }
    return entry.result;
  }

  private setCachedReverseGeocode(cacheKey: string, result: ReverseGeocodeResult | null): void {
    this.reverseGeocodeCache.set(cacheKey, {
      cachedAt: Date.now(),
      result,
    });
  }

  private rememberSearchResults(results: PlaceResult[]): void {
    results.forEach((result) => {
      if (!result.place_id) return;
      setCachedPlaceInfo(result.place_id, buildCachedPlaceInfoFromSearchResult(result));
    });
  }

  async searchPlaces(
    query: string,
    location: Coordinates | null = null,
    radius: number = 5000,
    placeType: string | null = null,
    options: {
      preferTextSearch?: boolean;
      region?: string;
    } = {},
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
        const results = this.processResults(response.data.results || []);
        this.setCachedSearchResults(cacheKey, results);
        this.rememberSearchResults(results);
        return results;
      }

      const params: Record<string, unknown> = {
        key: this.apiKey,
        location,
        radius,
        keyword: cleanQuery,
      };
      if (placeType) params.type = placeType;

      const response = await this.client.placesNearby({
        params: params as unknown as Parameters<typeof this.client.placesNearby>[0]["params"],
      });
      const results = this.processResults(response.data.results || []);
      this.setCachedSearchResults(cacheKey, results);
      this.rememberSearchResults(results);
      return results;
    } catch (error) {
      const axiosError = error as {
        message?: string;
        response?: {
          status?: number;
          data?: unknown;
        };
      };
      const status = axiosError.response?.status;
      const message = axiosError.message;
      const data = axiosError.response?.data;

      console.error(`Error searching places for '${cleanQuery}':`, {
        status,
        message,
        data: data ? (typeof data === "string" ? data.substring(0, 200) : data) : "No response data",
      });

      return [];
    }
  }

  private processResults(results: unknown[]): PlaceResult[] {
    return results.slice(0, 10).map((place: unknown) => {
      const candidate = place as {
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
        name: candidate.name,
        place_id: candidate.place_id,
        types: candidate.types,
        rating: candidate.rating || 0,
        user_ratings_total: candidate.user_ratings_total || 0,
        location: candidate.geometry.location,
        vicinity: candidate.vicinity || candidate.formatted_address || "",
        price_level: candidate.price_level,
      };
    });
  }

  async getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
    const cached = getCachedPlaceInfo(placeId);
    if (cached?.hasDetails) {
      return this.buildPlaceDetailsFromCache(cached);
    }
    if (cached === null) {
      return null;
    }

    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          key: this.apiKey,
          fields: [
            "address_components",
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
      if (!result) {
        return null;
      }

      const weekdayText = Array.isArray(result.opening_hours?.weekday_text)
        ? result.opening_hours.weekday_text.filter((value): value is string => typeof value === "string")
        : [];
      const editorialSummary =
        result.editorial_summary && typeof result.editorial_summary.overview === "string"
          ? result.editorial_summary.overview
          : undefined;

      const details: PlaceDetails = {
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
        address_components: Array.isArray(result.address_components)
          ? result.address_components.map((component) => ({
              long_name: component.long_name,
              short_name: component.short_name,
              types: Array.isArray(component.types) ? component.types : [],
            }))
          : undefined,
        photos: (result.photos || []).slice(0, 3).map((photo) => ({
          photo_reference: photo.photo_reference,
        })),
      };

      const fallbackCoordinates = extractLatLngFromGeometry(result.geometry);
      const normalized = buildCachedPlaceInfoFromPlaceDetails(placeId, details, fallbackCoordinates || undefined);
      if (normalized) {
        setCachedPlaceInfo(placeId, normalized);
      }

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
        countryCode: components.find((component) => hasType(component.types, "country"))?.short_name,
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

  async getPlacePhotoUrlsFromId(_placeId: string | null, _maxWidth: number = 400): Promise<string[]> {
    return [];
  }
}

let placesClientInstance: PlacesClient | null = null;

export function getPlacesClient(): PlacesClient {
  if (!placesClientInstance) {
    placesClientInstance = new PlacesClient();
  }
  return placesClientInstance;
}

export { PlacesClient };
