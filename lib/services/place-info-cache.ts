import fs from "fs";
import os from "os";
import path from "path";
import type { TimelinePlaceCategory } from "@/lib/timeline";

export interface CachedPlaceAddressComponent {
  long_name: string;
  short_name?: string;
  types: string[];
}

export interface CachedPlacePhoto {
  photo_reference: string;
}

export interface CachedPlaceInfo {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  types: string[];
  category: TimelinePlaceCategory;
  vicinity: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  priceLevel: number | null;
  formattedPhoneNumber: string | null;
  website: string | null;
  openingHoursText: string | null;
  editorialSummary: string | null;
  addressComponents: CachedPlaceAddressComponent[];
  photos: CachedPlacePhoto[];
  hasDetails: boolean;
  hasGeocode: boolean;
}

interface CachedPlaceInfoEntry {
  cachedAt: number;
  info: CachedPlaceInfo | null;
}

type AddressComponentSource = {
  long_name?: unknown;
  short_name?: unknown;
  types?: unknown;
};

const CATEGORY_COLORS: Record<TimelinePlaceCategory, string> = {
  "Food & Drink": "#b45309",
  Shopping: "#0f766e",
  Hotels: "#1d4ed8",
  Attractions: "#dc2626",
  Sports: "#047857",
  Airports: "#475569",
  Culture: "#7c3aed",
  Other: "#334155",
};

const FOOD_TYPES = new Set([
  "bakery",
  "bar",
  "cafe",
  "coffee_shop",
  "food_court",
  "grocery_or_supermarket",
  "ice_cream_shop",
  "liquor_store",
  "meal_delivery",
  "meal_takeaway",
  "restaurant",
  "supermarket",
]);

const SHOPPING_TYPES = new Set([
  "book_store",
  "clothing_store",
  "convenience_store",
  "department_store",
  "electronics_store",
  "furniture_store",
  "home_goods_store",
  "market",
  "shopping_mall",
  "store",
]);

const HOTEL_TYPES = new Set([
  "campground",
  "hostel",
  "hotel",
  "lodging",
  "resort_hotel",
  "rv_park",
]);

const ATTRACTION_TYPES = new Set([
  "amusement_park",
  "aquarium",
  "beach",
  "campground",
  "national_park",
  "natural_feature",
  "park",
  "tourist_attraction",
  "visitor_center",
  "zoo",
]);

const SPORTS_TYPES = new Set([
  "athletic_field",
  "bowling_alley",
  "fitness_center",
  "golf_course",
  "gym",
  "ski_resort",
  "sports_activity_location",
  "sports_club",
  "sports_complex",
  "stadium",
]);

const AIRPORT_TYPES = new Set([
  "airport",
  "bus_station",
  "light_rail_station",
  "subway_station",
  "train_station",
  "transit_station",
]);

const CULTURE_TYPES = new Set([
  "art_gallery",
  "church",
  "cultural_landmark",
  "hindu_temple",
  "library",
  "mosque",
  "museum",
  "performing_arts_theater",
  "synagogue",
]);

const cache = new Map<string, CachedPlaceInfoEntry>();
let cacheLoaded = false;
const cacheTtlMs = 1000 * 60 * 60 * 24 * 90;

export function getPlaceInfoCachePath(): string {
  const basePath =
    process.env.PLACES_CACHE_PATH || path.join(os.tmpdir(), "travel-planner-place-details-cache.json");
  return basePath.replace(/\.json$/i, ".timeline-place-info.json");
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTypes(types: string[] | undefined): string[] {
  return (types || []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function matchesAnyType(types: string[], expected: Set<string>): boolean {
  return types.some((type) => expected.has(type));
}

function mergeString(nextValue: string | null, currentValue: string | null): string | null {
  return nextValue && nextValue !== "null" ? nextValue : currentValue;
}

function mergeNumber(nextValue: number | null, currentValue: number | null): number | null {
  return nextValue != null ? nextValue : currentValue;
}

function mergeTypes(currentTypes: string[], nextTypes: string[]): string[] {
  return Array.from(new Set([...currentTypes, ...nextTypes]));
}

function normalizeAddressComponents(
  components: Array<CachedPlaceAddressComponent | AddressComponentSource> | undefined,
): CachedPlaceAddressComponent[] {
  if (!Array.isArray(components)) return [];

  const normalized: CachedPlaceAddressComponent[] = [];

  components.forEach((component) => {
    const longName = normalizeString(component.long_name);
    if (!longName) return;

    normalized.push({
      long_name: longName,
      short_name: normalizeString(component.short_name) || undefined,
      types: Array.isArray(component.types)
        ? component.types
            .map((type) => normalizeString(type))
            .filter((type): type is string => Boolean(type))
        : [],
    });
  });

  return normalized;
}

function normalizePhotos(photos: Array<{ photo_reference?: unknown }> | undefined): CachedPlacePhoto[] {
  if (!Array.isArray(photos)) return [];

  return photos
    .map((photo) => {
      const reference = normalizeString(photo.photo_reference);
      return reference ? { photo_reference: reference } : null;
    })
    .filter((photo): photo is CachedPlacePhoto => Boolean(photo));
}

function loadCache(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;

  try {
    const cachePath = getPlaceInfoCachePath();
    if (!fs.existsSync(cachePath)) return;

    const raw = fs.readFileSync(cachePath, "utf8");
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw) as Record<string, CachedPlaceInfoEntry>;
    for (const [placeId, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.cachedAt !== "number") continue;
      cache.set(placeId, {
        cachedAt: entry.cachedAt,
        info: normalizeCachedPlaceInfo(entry.info),
      });
    }
  } catch (error) {
    console.warn("Failed to load place info cache:", (error as Error).message);
  }
}

function persistCache(): void {
  try {
    fs.writeFileSync(getPlaceInfoCachePath(), JSON.stringify(Object.fromEntries(cache), null, 2), "utf8");
  } catch (error) {
    console.warn("Failed to persist place info cache:", (error as Error).message);
  }
}

function normalizeCachedPlaceInfo(info: unknown): CachedPlaceInfo | null {
  if (!info || typeof info !== "object") return null;

  const candidate = info as Partial<CachedPlaceInfo>;
  const placeId = normalizeString(candidate.placeId);
  const name = normalizeString(candidate.name);
  const lat = normalizeNumber(candidate.lat);
  const lng = normalizeNumber(candidate.lng);
  if (!placeId || !name || lat == null || lng == null) return null;

  const types = normalizeTypes(Array.isArray(candidate.types) ? candidate.types : undefined);
  const category = candidate.category && typeof candidate.category === "string"
    ? candidate.category
    : categorizePlaceTypes(types);

  return {
    placeId,
    name,
    formattedAddress: normalizeString(candidate.formattedAddress),
    city: normalizeString(candidate.city),
    region: normalizeString(candidate.region),
    country: normalizeString(candidate.country),
    countryCode: normalizeString(candidate.countryCode),
    lat,
    lng,
    types,
    category,
    vicinity: normalizeString(candidate.vicinity),
    rating: normalizeNumber(candidate.rating),
    userRatingsTotal: normalizeNumber(candidate.userRatingsTotal),
    priceLevel: normalizeNumber(candidate.priceLevel),
    formattedPhoneNumber: normalizeString(candidate.formattedPhoneNumber),
    website: normalizeString(candidate.website),
    openingHoursText: normalizeString(candidate.openingHoursText),
    editorialSummary: normalizeString(candidate.editorialSummary),
    addressComponents: normalizeAddressComponents(candidate.addressComponents),
    photos: normalizePhotos(candidate.photos),
    hasDetails: Boolean(candidate.hasDetails),
    hasGeocode: Boolean(candidate.hasGeocode),
  };
}

export function getCachedPlaceInfo(placeId: string): CachedPlaceInfo | null | undefined {
  loadCache();
  const entry = cache.get(placeId);
  if (!entry) return undefined;

  if (Date.now() - entry.cachedAt > cacheTtlMs) {
    cache.delete(placeId);
    persistCache();
    return undefined;
  }

  return entry.info;
}

export function hasResolvedPlaceInfo(info: CachedPlaceInfo): boolean {
  return info.hasDetails || info.hasGeocode;
}

export function setCachedPlaceInfo(placeId: string, info: CachedPlaceInfo | null): void {
  loadCache();
  const existing = cache.get(placeId)?.info ?? null;
  const merged = mergeCachedPlaceInfo(existing, info);

  cache.set(placeId, {
    cachedAt: Date.now(),
    info: merged,
  });
  persistCache();
}

function mergeCachedPlaceInfo(
  current: CachedPlaceInfo | null,
  nextValue: CachedPlaceInfo | null,
): CachedPlaceInfo | null {
  if (!nextValue) return current;
  if (!current) return nextValue;

  const mergedTypes = mergeTypes(current.types, nextValue.types);
  const mergedCategory =
    nextValue.category !== "Other" || current.category === "Other"
      ? nextValue.category
      : current.category;

  return {
    placeId: current.placeId,
    name: mergeString(nextValue.name, current.name) || current.placeId,
    formattedAddress: mergeString(nextValue.formattedAddress, current.formattedAddress),
    city: mergeString(nextValue.city, current.city),
    region: mergeString(nextValue.region, current.region),
    country: mergeString(nextValue.country, current.country),
    countryCode: mergeString(nextValue.countryCode, current.countryCode),
    lat: Number.isFinite(nextValue.lat) ? nextValue.lat : current.lat,
    lng: Number.isFinite(nextValue.lng) ? nextValue.lng : current.lng,
    types: mergedTypes,
    category: mergedCategory,
    vicinity: mergeString(nextValue.vicinity, current.vicinity),
    rating: mergeNumber(nextValue.rating, current.rating),
    userRatingsTotal: mergeNumber(nextValue.userRatingsTotal, current.userRatingsTotal),
    priceLevel: mergeNumber(nextValue.priceLevel, current.priceLevel),
    formattedPhoneNumber: mergeString(nextValue.formattedPhoneNumber, current.formattedPhoneNumber),
    website: mergeString(nextValue.website, current.website),
    openingHoursText: mergeString(nextValue.openingHoursText, current.openingHoursText),
    editorialSummary: mergeString(nextValue.editorialSummary, current.editorialSummary),
    addressComponents:
      nextValue.addressComponents.length > 0 ? nextValue.addressComponents : current.addressComponents,
    photos: nextValue.photos.length > 0 ? nextValue.photos : current.photos,
    hasDetails: current.hasDetails || nextValue.hasDetails,
    hasGeocode: current.hasGeocode || nextValue.hasGeocode,
  };
}

export function extractLatLngFromGeometry(
  geometry: unknown,
  fallback?: { lat: number; lng: number },
): { lat: number; lng: number } | null {
  if (typeof geometry === "object" && geometry !== null) {
    const candidate = geometry as {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    const lat = candidate.location?.lat;
    const lng = candidate.location?.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat: lat as number,
        lng: lng as number,
      };
    }
  }

  if (fallback && Number.isFinite(fallback.lat) && Number.isFinite(fallback.lng)) {
    return fallback;
  }

  return null;
}

export function getAddressComponent(
  components: CachedPlaceAddressComponent[] | undefined,
  type: string,
  variant: "long_name" | "short_name" = "long_name",
): string | null {
  const component = components?.find((item) => item.types.includes(type));
  const value = component?.[variant];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function categorizePlaceTypes(types: string[] | undefined): TimelinePlaceCategory {
  const normalized = normalizeTypes(types);

  if (matchesAnyType(normalized, AIRPORT_TYPES)) return "Airports";
  if (matchesAnyType(normalized, HOTEL_TYPES)) return "Hotels";
  if (matchesAnyType(normalized, FOOD_TYPES) || normalized.some((type) => type.endsWith("_restaurant"))) {
    return "Food & Drink";
  }
  if (matchesAnyType(normalized, CULTURE_TYPES)) return "Culture";
  if (matchesAnyType(normalized, SPORTS_TYPES)) return "Sports";
  if (matchesAnyType(normalized, SHOPPING_TYPES) || normalized.some((type) => type.endsWith("_store"))) {
    return "Shopping";
  }
  if (matchesAnyType(normalized, ATTRACTION_TYPES)) return "Attractions";
  return "Other";
}

export function getTimelineCategoryColor(category: TimelinePlaceCategory): string {
  return CATEGORY_COLORS[category];
}

export function buildCachedPlaceInfoFromSearchResult(place: {
  name: string;
  place_id: string;
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
  location: { lat: number; lng: number };
  vicinity?: string;
  price_level?: number;
}): CachedPlaceInfo {
  const types = normalizeTypes(place.types);

  return {
    placeId: place.place_id,
    name: normalizeString(place.name) || place.place_id,
    formattedAddress: null,
    city: null,
    region: null,
    country: null,
    countryCode: null,
    lat: place.location.lat,
    lng: place.location.lng,
    types,
    category: categorizePlaceTypes(types),
    vicinity: normalizeString(place.vicinity),
    rating: normalizeNumber(place.rating),
    userRatingsTotal: normalizeNumber(place.user_ratings_total),
    priceLevel: normalizeNumber(place.price_level),
    formattedPhoneNumber: null,
    website: null,
    openingHoursText: null,
    editorialSummary: null,
    addressComponents: [],
    photos: [],
    hasDetails: false,
    hasGeocode: false,
  };
}

export function buildCachedPlaceInfoFromPlaceDetails(
  placeId: string,
  details: {
    name: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    website?: string;
    rating?: number;
    user_ratings_total?: number;
    opening_hours_text?: string;
    editorial_summary?: string;
    price_level?: number;
    types?: string[];
    geometry?: unknown;
    address_components?: CachedPlaceAddressComponent[];
    photos?: Array<{ photo_reference?: string }>;
  },
  fallbackCoordinates?: { lat: number; lng: number },
): CachedPlaceInfo | null {
  const coordinates = extractLatLngFromGeometry(details.geometry, fallbackCoordinates);
  if (!coordinates) return null;

  const addressComponents = normalizeAddressComponents(details.address_components);
  const types = normalizeTypes(details.types);
  const city =
    getAddressComponent(addressComponents, "locality") ||
    getAddressComponent(addressComponents, "postal_town") ||
    getAddressComponent(addressComponents, "administrative_area_level_3") ||
    getAddressComponent(addressComponents, "administrative_area_level_2");
  const region =
    getAddressComponent(addressComponents, "administrative_area_level_1", "short_name") ||
    getAddressComponent(addressComponents, "administrative_area_level_1");
  const country = getAddressComponent(addressComponents, "country");
  const countryCode = getAddressComponent(addressComponents, "country", "short_name");

  return {
    placeId,
    name: normalizeString(details.name) || placeId,
    formattedAddress: normalizeString(details.formatted_address),
    city,
    region,
    country,
    countryCode,
    lat: coordinates.lat,
    lng: coordinates.lng,
    types,
    category: categorizePlaceTypes(types),
    vicinity: null,
    rating: normalizeNumber(details.rating),
    userRatingsTotal: normalizeNumber(details.user_ratings_total),
    priceLevel: normalizeNumber(details.price_level),
    formattedPhoneNumber: normalizeString(details.formatted_phone_number),
    website: normalizeString(details.website),
    openingHoursText: normalizeString(details.opening_hours_text),
    editorialSummary: normalizeString(details.editorial_summary),
    addressComponents,
    photos: normalizePhotos(details.photos),
    hasDetails: true,
    hasGeocode: false,
  };
}

export function buildCachedPlaceInfoFromGeocode(
  placeId: string,
  coordinates: { lat: number; lng: number },
  geocode: {
    formattedAddress?: string;
    locality?: string;
    adminAreaLevel1?: string;
    adminAreaLevel2?: string;
    country?: string;
    countryCode?: string;
    featureName?: string;
    parkName?: string;
    types?: string[];
  },
): CachedPlaceInfo {
  const types = normalizeTypes(geocode.types);

  return {
    placeId,
    name:
      normalizeString(geocode.parkName) ||
      normalizeString(geocode.featureName) ||
      normalizeString(geocode.locality) ||
      normalizeString(geocode.adminAreaLevel2) ||
      normalizeString(geocode.formattedAddress) ||
      placeId,
    formattedAddress: normalizeString(geocode.formattedAddress),
    city: normalizeString(geocode.locality) || normalizeString(geocode.adminAreaLevel2),
    region: normalizeString(geocode.adminAreaLevel1),
    country: normalizeString(geocode.country),
    countryCode: normalizeString(geocode.countryCode),
    lat: coordinates.lat,
    lng: coordinates.lng,
    types,
    category:
      normalizeString(geocode.parkName) || normalizeString(geocode.featureName)
        ? "Attractions"
        : categorizePlaceTypes(types),
    vicinity: null,
    rating: null,
    userRatingsTotal: null,
    priceLevel: null,
    formattedPhoneNumber: null,
    website: null,
    openingHoursText: null,
    editorialSummary: null,
    addressComponents: [],
    photos: [],
    hasDetails: false,
    hasGeocode: true,
  };
}
