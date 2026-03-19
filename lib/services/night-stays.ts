import type {
  AccommodationOption,
  DayGroup,
  GroupedDay,
  NightStay,
  TripInfo,
} from "@/lib/models/travel-plan";
import { computeActivitiesCentroid } from "@/lib/services/day-grouping";
import { getLLMClient } from "@/lib/services/llm-client";
import { getGeocodingService } from "@/lib/services/geocoding-service";
import { getPlacesClient } from "@/lib/services/places-client";

type NightStayAssignment = {
  dayGroups: DayGroup[];
  groupedDays: GroupedDay[];
};

function buildDefaultStayLabel({
  tripInfo,
  selectedAccommodation,
}: {
  tripInfo: TripInfo;
  selectedAccommodation?: AccommodationOption | null;
}): string {
  if (selectedAccommodation?.neighborhood) return selectedAccommodation.neighborhood;
  if (selectedAccommodation?.name) return selectedAccommodation.name;
  if (tripInfo.destination) return `Near ${tripInfo.destination}`;
  return "Central area";
}

function normalizeNightStay({
  label,
  notes,
  coordinates,
  fallbackLabel,
}: {
  label: string | null | undefined;
  notes?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  fallbackLabel: string;
}): NightStay {
  return {
    label: (label && label.trim()) || fallbackLabel,
    notes: notes ?? null,
    coordinates: coordinates ?? null,
  };
}

function haversineDistanceKm(
  a: { lat: number; lng: number } | null,
  b: { lat: number; lng: number } | null
): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return r * c;
}

function computeStayCentroid(activities: GroupedDay["activities"]): { lat: number; lng: number } | null {
  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  const addPoint = (point?: { lat: number; lng: number } | null) => {
    if (!point) return;
    sumLat += point.lat;
    sumLng += point.lng;
    count += 1;
  };

  for (const activity of activities) {
    if (activity.locationMode === "route") {
      addPoint(activity.startCoordinates ?? null);
      addPoint(activity.endCoordinates ?? null);
      for (const waypoint of activity.routeWaypoints ?? []) {
        addPoint(waypoint.coordinates);
      }
      continue;
    }

    addPoint(activity.coordinates ?? null);
    addPoint(activity.startCoordinates ?? null);
    addPoint(activity.endCoordinates ?? null);
  }

  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count };
}

function sortActivitiesForDrive(activities: GroupedDay["activities"]): GroupedDay["activities"] {
  const score: Record<NonNullable<GroupedDay["activities"][number]["bestTimeOfDay"]>, number> = {
    morning: 0,
    afternoon: 1,
    evening: 2,
    any: 3,
  };
  return [...activities].sort((a, b) => {
    const aScore = score[a.bestTimeOfDay ?? "any"] ?? 3;
    const bScore = score[b.bestTimeOfDay ?? "any"] ?? 3;
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
}

function activityDrivePoint(activity: GroupedDay["activities"][number]): { lat: number; lng: number } | null {
  if (activity.locationMode === "route") {
    return activity.startCoordinates ?? activity.endCoordinates ?? activity.coordinates ?? null;
  }
  return activity.coordinates ?? activity.startCoordinates ?? activity.endCoordinates ?? null;
}

function computeDriveScore(
  stay: { lat: number; lng: number } | null,
  activities: GroupedDay["activities"]
): number {
  if (!stay) return Number.POSITIVE_INFINITY;
  const ordered = sortActivitiesForDrive(activities)
    .map((activity) => activityDrivePoint(activity))
    .filter((point): point is { lat: number; lng: number } => Boolean(point));
  if (ordered.length === 0) return Number.POSITIVE_INFINITY;

  let total = haversineDistanceKm(stay, ordered[0]);
  for (let i = 1; i < ordered.length; i += 1) {
    total += haversineDistanceKm(ordered[i - 1], ordered[i]);
  }
  total += haversineDistanceKm(ordered[ordered.length - 1], stay);
  return total;
}

export async function assignNightStays({
  tripInfo,
  dayGroups,
  groupedDays,
  selectedAccommodation,
  accommodationOptions,
}: {
  tripInfo: TripInfo;
  dayGroups: DayGroup[];
  groupedDays: GroupedDay[];
  selectedAccommodation?: AccommodationOption | null;
  accommodationOptions?: AccommodationOption[];
}): Promise<NightStayAssignment> {
  if (!groupedDays.length) {
    return { dayGroups, groupedDays };
  }

  const fallbackLabel = buildDefaultStayLabel({ tripInfo, selectedAccommodation });
  let nightStaySuggestions: Array<{ dayNumber: number; candidates: NightStay[] }> = [];

  const verifiedLodgingAreas: Record<number, string[]> = {};
  const placesClient = getPlacesClient();

  if (!selectedAccommodation) {
    try {
      // Find verified lodging areas for each day by querying Places API around the day's centroid
      for (const day of groupedDays) {
        const centroid = computeStayCentroid(day.activities) ?? computeActivitiesCentroid(day.activities);
        if (centroid) {
          const places = await placesClient.searchPlaces("hotel", centroid, 15000, "lodging");
          const areas = new Set<string>();
          for (const place of places) {
            // Use vicinity (which is often the town/city for lodging near searches) or name
            if (place.vicinity) {
              // Vicinity for lodging is often "City" or "Street, City". Try to extract the general area.
              const parts = place.vicinity.split(",");
              areas.add(parts[parts.length - 1].trim());
            } else if (place.name) {
              areas.add(place.name);
            }
          }
          if (areas.size > 0) {
            verifiedLodgingAreas[day.dayNumber] = Array.from(areas).slice(0, 5);
          }
        }
      }

      const llmClient = getLLMClient();
      const response = await llmClient.determineNightStays({
        tripInfo,
        groupedDays,
        selectedAccommodation: null,
        accommodationOptions,
        verifiedLodgingAreas,
      });
      if (response.success) {
        nightStaySuggestions = response.nightStays;
      }
    } catch (error) {
      console.error("Night stay LLM stage failed:", error);
    }
  }

  if (selectedAccommodation && nightStaySuggestions.length === 0) {
    nightStaySuggestions = groupedDays.map((day) => ({
      dayNumber: day.dayNumber,
      candidates: [{ label: fallbackLabel, notes: null, coordinates: null }],
    }));
  }

  const stayByDay = new Map<number, NightStay>();
  let geocodingService: ReturnType<typeof getGeocodingService> | null = null;

  if (!selectedAccommodation) {
    try {
      geocodingService = getGeocodingService();
    } catch (error) {
      console.error("Geocoding service unavailable:", error);
      geocodingService = null;
    }
  }

  for (const day of groupedDays) {
    const centroid = computeStayCentroid(day.activities) ?? computeActivitiesCentroid(day.activities);
    const suggestion = nightStaySuggestions.find((stay) => stay.dayNumber === day.dayNumber);
    const candidates = suggestion?.candidates ?? [];

    let bestCandidate: NightStay | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const scoredCandidates: NightStay["candidates"] = [];

    if (candidates.length > 0 && geocodingService) {
      const locationPromises = candidates.map(async (candidate) => {
        const query = tripInfo.destination
          ? `${candidate.label}, ${tripInfo.destination}`
          : candidate.label;
        const location = await geocodingService!.geocode(query);
        const driveScore = computeDriveScore(location, day.activities);
        return { candidate, location, driveScore };
      });
      const resolvedLocations = await Promise.all(locationPromises);
      let firstGeocodedCandidate: NightStay | null = null;

      for (const { candidate, location, driveScore } of resolvedLocations) {
        scoredCandidates.push({
          label: candidate.label,
          notes: candidate.notes ?? null,
          coordinates: location,
          driveScoreKm: Number.isFinite(driveScore) ? Math.round(driveScore * 10) / 10 : null,
        });
        if (!firstGeocodedCandidate && location) {
          firstGeocodedCandidate = {
            label: candidate.label,
            notes: candidate.notes ?? null,
            coordinates: location,
          };
        }
        if (Number.isFinite(driveScore) && driveScore < bestDistance) {
          bestDistance = driveScore;
          bestCandidate = {
            label: candidate.label,
            notes: candidate.notes ?? null,
            coordinates: location,
          };
        }
      }

      if (!bestCandidate && firstGeocodedCandidate) {
        bestCandidate = firstGeocodedCandidate;
      }
    }

    if (!bestCandidate && candidates.length > 0) {
      bestCandidate = {
        label: candidates[0].label,
        notes: candidates[0].notes ?? null,
        coordinates: centroid,
      };
      scoredCandidates.push({
        label: candidates[0].label,
        notes: candidates[0].notes ?? null,
        coordinates: centroid,
        driveScoreKm: null,
      });
    }

    const nightStay = normalizeNightStay({
      label: bestCandidate?.label ?? null,
      notes: bestCandidate?.notes ?? null,
      coordinates: bestCandidate?.coordinates ?? centroid,
      fallbackLabel,
    });
    if (scoredCandidates && scoredCandidates.length > 0) {
      nightStay.candidates = scoredCandidates.sort((a, b) => {
        const aScore = a.driveScoreKm ?? Number.POSITIVE_INFINITY;
        const bScore = b.driveScoreKm ?? Number.POSITIVE_INFINITY;
        return aScore - bScore;
      });
    }
    stayByDay.set(day.dayNumber, nightStay);
  }

  const updatedDayGroups = dayGroups.map((group) => ({
    ...group,
    nightStay: stayByDay.get(group.dayNumber) ?? null,
  }));

  const updatedGroupedDays = groupedDays.map((day) => ({
    ...day,
    nightStay: stayByDay.get(day.dayNumber) ?? null,
  }));

  return {
    dayGroups: updatedDayGroups,
    groupedDays: updatedGroupedDays,
  };
}
