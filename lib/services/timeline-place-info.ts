import { getPlacesClient, type PlaceDetails } from "@/lib/services/places-client";
import {
  buildCachedPlaceInfoFromGeocode,
  buildCachedPlaceInfoFromPlaceDetails,
  categorizePlaceTypes,
  extractLatLngFromGeometry,
  getAddressComponent,
  getCachedPlaceInfo,
  getTimelineCategoryColor,
  hasResolvedPlaceInfo,
  setCachedPlaceInfo,
  type CachedPlaceInfo,
} from "@/lib/services/place-info-cache";

export type TimelinePlaceInfo = CachedPlaceInfo;

async function buildTimelinePlaceInfo(
  placeId: string,
  fallbackCoordinates: { lat: number; lng: number },
): Promise<TimelinePlaceInfo | null> {
  let placesClient;
  try {
    placesClient = getPlacesClient();
  } catch {
    return null;
  }

  const details = await placesClient.getPlaceDetails(placeId);
  if (!details) {
    try {
      const geocoded = await placesClient.reverseGeocode(fallbackCoordinates);
      if (!geocoded) return null;
      return buildCachedPlaceInfoFromGeocode(placeId, fallbackCoordinates, geocoded);
    } catch {
      return null;
    }
  }

  const placeInfo = buildCachedPlaceInfoFromPlaceDetails(placeId, details, fallbackCoordinates);
  if (!placeInfo) {
    return null;
  }

  if (placeInfo.city && placeInfo.country) {
    return placeInfo;
  }

  const coordinates = extractLatLngFromGeometry(details.geometry, fallbackCoordinates);
  if (!coordinates) {
    return placeInfo;
  }

  const geocoded = await placesClient.reverseGeocode(coordinates);
  if (!geocoded) {
    return placeInfo;
  }

  const geocodedPlace = buildCachedPlaceInfoFromGeocode(placeId, coordinates, {
    ...geocoded,
    formattedAddress: placeInfo.formattedAddress || geocoded.formattedAddress,
    locality:
      placeInfo.city ||
      geocoded.locality ||
      getAddressComponent(placeInfo.addressComponents, "administrative_area_level_2") ||
      undefined,
    adminAreaLevel1:
      placeInfo.region ||
      geocoded.adminAreaLevel1 ||
      getAddressComponent(placeInfo.addressComponents, "administrative_area_level_1", "short_name") ||
      getAddressComponent(placeInfo.addressComponents, "administrative_area_level_1") ||
      undefined,
    country: placeInfo.country || geocoded.country,
    countryCode: placeInfo.countryCode || geocoded.countryCode,
    featureName: placeInfo.name,
    types: placeInfo.types.length > 0 ? placeInfo.types : geocoded.types,
  });

  return {
    ...placeInfo,
    formattedAddress: placeInfo.formattedAddress || geocodedPlace.formattedAddress,
    city: placeInfo.city || geocodedPlace.city,
    region: placeInfo.region || geocodedPlace.region,
    country: placeInfo.country || geocodedPlace.country,
    countryCode: placeInfo.countryCode || geocodedPlace.countryCode,
    category: placeInfo.category === "Other" ? geocodedPlace.category : placeInfo.category,
    hasGeocode: true,
  };
}

export async function resolveTimelinePlaceInfo(
  placeId: string,
  fallbackCoordinates: { lat: number; lng: number },
): Promise<TimelinePlaceInfo | null> {
  const cached = getCachedPlaceInfo(placeId);
  if (cached && hasResolvedPlaceInfo(cached)) {
    return cached;
  }
  if (cached === null) {
    return null;
  }

  const info = await buildTimelinePlaceInfo(placeId, fallbackCoordinates);
  setCachedPlaceInfo(placeId, info);
  if (!info) {
    return null;
  }
  return getCachedPlaceInfo(placeId) ?? info;
}

export async function resolveTimelinePlaceInfoMap(
  places: Array<{ placeId: string; lat: number; lng: number }>,
): Promise<Map<string, TimelinePlaceInfo | null>> {
  const uniquePlaces = Array.from(new Map(places.map((place) => [place.placeId, place] as const)).values());
  const resolved = new Map<string, TimelinePlaceInfo | null>();

  for (let index = 0; index < uniquePlaces.length; index += 8) {
    const batch = uniquePlaces.slice(index, index + 8);
    const results = await Promise.all(
      batch.map(async (place) => [
        place.placeId,
        await resolveTimelinePlaceInfo(place.placeId, { lat: place.lat, lng: place.lng }),
      ] as const),
    );

    results.forEach(([placeId, info]) => {
      resolved.set(placeId, info);
    });
  }

  return resolved;
}

export {
  categorizePlaceTypes,
  extractLatLngFromGeometry,
  getAddressComponent,
  getTimelineCategoryColor,
};

export type { PlaceDetails };
