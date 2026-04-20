import {
  getTimelineCategoryColor,
  resolveTimelinePlaceInfoMap,
  type TimelinePlaceInfo,
} from "@/lib/services/timeline-place-info";
import type {
  TimelineAnalysisResponse,
  TimelineCitySummary,
  TimelineCountrySummary,
  TimelineMapPoint,
  TimelinePlaceCategory,
  TimelinePlaceSummary,
  TimelineTripSummary,
  TimelineVisit,
} from "@/lib/timeline";

const MAX_PLACE_MAP_POINTS = 400;
const TRIP_BREAK_GAP_HOURS = 72;
const TRIP_HOME_SETTLE_MINUTES = 240;
const LOCAL_TRAVEL_RADIUS_KM = 80;
const MIN_TRIP_DURATION_HOURS = 24;
const MAX_TRIP_DURATION_DAYS = 45;

type MutablePlaceAccumulator = TimelinePlaceSummary & {
  categoryCounts: Map<TimelinePlaceCategory, number>;
};

type MutableCityAccumulator = TimelineCitySummary & {
  categoryCounts: Map<TimelinePlaceCategory, number>;
  weight: number;
};

type MutableCountryAccumulator = TimelineCountrySummary & {
  weight: number;
};

interface ResolvedVisit {
  visit: TimelineVisit;
  place: TimelinePlaceSummary;
  cityId: string | null;
  countryId: string | null;
}

interface TripBuildContext {
  homeCityId: string | null;
  homeCountryCode: string | null;
  homeLat: number | null;
  homeLng: number | null;
}

function toTimestamp(value: string | null): number {
  if (!value) return Number.NaN;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
}

function compareTimelineTimes(left: string | null, right: string | null): number {
  const leftTime = toTimestamp(left);
  const rightTime = toTimestamp(right);

  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime;
}

function durationHours(startTime: string | null, endTime: string | null): number {
  const start = toTimestamp(startTime);
  const end = toTimestamp(endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round(((end - start) / (1000 * 60 * 60)) * 10) / 10;
}

function isDisplayableTrip(trip: TimelineTripSummary | null): trip is TimelineTripSummary {
  if (!trip?.startTime || !trip.endTime) return false;

  const start = toTimestamp(trip.startTime);
  const end = toTimestamp(trip.endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false;

  const durationMs = end - start;
  const minDurationMs = MIN_TRIP_DURATION_HOURS * 60 * 60 * 1000;
  const maxDurationMs = MAX_TRIP_DURATION_DAYS * 24 * 60 * 60 * 1000;
  return durationMs >= minDurationMs && durationMs < maxDurationMs;
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${Math.max(1, Math.round(totalMinutes))} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalized = normalizeLabel(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(trimmed);
  }

  return deduped;
}

function safeText(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildCityId(city: string | null, region: string | null, countryCode: string | null, country: string | null): string | null {
  if (!city) return null;
  return [
    normalizeLabel(city),
    normalizeLabel(region || ""),
    normalizeLabel(countryCode || country || ""),
  ].join("|");
}

function buildCountryId(countryCode: string | null, country: string | null): string | null {
  if (!country && !countryCode) return null;
  return normalizeLabel(countryCode || country || "");
}

function cityDisplayLabel(place: Pick<TimelinePlaceSummary, "city" | "region" | "country">): string | null {
  if (!place.city) return null;
  if (place.region) return `${place.city}, ${place.region}`;
  if (place.country) return `${place.city}, ${place.country}`;
  return place.city;
}

function placeScore(place: Pick<TimelinePlaceSummary, "visitCount" | "totalDurationMinutes">): number {
  return place.visitCount * 3 + Math.min(place.totalDurationMinutes / 60, 24);
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function monthLabel(value: string | null): string | null {
  if (!value) return null;

  const directMatch = value.match(/^(\d{4})-(\d{2})/);
  if (directMatch) {
    const year = Number(directMatch[1]);
    const monthIndex = Number(directMatch[2]) - 1;
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return formatter.format(new Date(Date.UTC(year, monthIndex, 1)));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function mergeCategoryCounts(target: Map<TimelinePlaceCategory, number>, category: TimelinePlaceCategory, weight: number): void {
  target.set(category, (target.get(category) || 0) + weight);
}

function pickTopCategories(categoryCounts: Map<TimelinePlaceCategory, number>, limit: number): TimelinePlaceCategory[] {
  return [...categoryCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([category]) => category);
}

function buildFallbackPlaceSummary(visit: TimelineVisit): TimelinePlaceSummary {
  return {
    placeId: visit.placeId,
    name: visit.semanticType || visit.placeId,
    category: "Other",
    city: null,
    region: null,
    country: null,
    countryCode: null,
    formattedAddress: null,
    lat: visit.lat,
    lng: visit.lng,
    visitCount: 0,
    totalDurationMinutes: 0,
    firstVisitedAt: null,
    lastVisitedAt: null,
    types: [],
  };
}

function buildPlaceSummaries(
  visits: TimelineVisit[],
  placeInfoById: Map<string, TimelinePlaceInfo | null>
): TimelinePlaceSummary[] {
  const places = new Map<string, MutablePlaceAccumulator>();

  for (const visit of visits) {
    const placeInfo = placeInfoById.get(visit.placeId) || null;
    const base = placeInfo
      ? {
        placeId: placeInfo.placeId,
        name: placeInfo.name,
        category: placeInfo.category,
        city: placeInfo.city,
        region: placeInfo.region,
        country: placeInfo.country,
        countryCode: placeInfo.countryCode,
        formattedAddress: placeInfo.formattedAddress,
        lat: placeInfo.lat,
        lng: placeInfo.lng,
        types: placeInfo.types,
      }
      : buildFallbackPlaceSummary(visit);

    const existing = places.get(visit.placeId);
    if (existing) {
      existing.visitCount += 1;
      existing.totalDurationMinutes += visit.durationMinutes;
      if (visit.startTime && (!existing.firstVisitedAt || compareTimelineTimes(visit.startTime, existing.firstVisitedAt) < 0)) {
        existing.firstVisitedAt = visit.startTime;
      }
      if (visit.endTime && (!existing.lastVisitedAt || compareTimelineTimes(visit.endTime, existing.lastVisitedAt) > 0)) {
        existing.lastVisitedAt = visit.endTime;
      }
      mergeCategoryCounts(existing.categoryCounts, base.category, Math.max(visit.durationMinutes, 30));
      continue;
    }

    const categoryCounts = new Map<TimelinePlaceCategory, number>();
    mergeCategoryCounts(categoryCounts, base.category, Math.max(visit.durationMinutes, 30));

    places.set(visit.placeId, {
      ...base,
      visitCount: 1,
      totalDurationMinutes: visit.durationMinutes,
      firstVisitedAt: visit.startTime,
      lastVisitedAt: visit.endTime,
      categoryCounts,
    });
  }

  return [...places.values()]
    .map(({ categoryCounts, ...place }) => ({
      ...place,
      category: pickTopCategories(categoryCounts, 1)[0] || place.category,
    }))
    .sort((left, right) => {
      if (right.totalDurationMinutes !== left.totalDurationMinutes) {
        return right.totalDurationMinutes - left.totalDurationMinutes;
      }
      return right.visitCount - left.visitCount;
    });
}

function buildCitySummaries(places: TimelinePlaceSummary[]): TimelineCitySummary[] {
  const cities = new Map<string, MutableCityAccumulator>();

  for (const place of places) {
    const cityId = buildCityId(place.city, place.region, place.countryCode, place.country);
    if (!cityId || !place.city) continue;

    const weight = Math.max(place.totalDurationMinutes, 30);
    const existing = cities.get(cityId);
    if (existing) {
      const combinedWeight = existing.weight + weight;
      existing.lat = (existing.lat * existing.weight + place.lat * weight) / combinedWeight;
      existing.lng = (existing.lng * existing.weight + place.lng * weight) / combinedWeight;
      existing.weight = combinedWeight;
      existing.visitCount += place.visitCount;
      existing.totalDurationMinutes += place.totalDurationMinutes;
      existing.placeCount += 1;
      if (place.firstVisitedAt && (!existing.firstVisitedAt || compareTimelineTimes(place.firstVisitedAt, existing.firstVisitedAt) < 0)) {
        existing.firstVisitedAt = place.firstVisitedAt;
      }
      if (place.lastVisitedAt && (!existing.lastVisitedAt || compareTimelineTimes(place.lastVisitedAt, existing.lastVisitedAt) > 0)) {
        existing.lastVisitedAt = place.lastVisitedAt;
      }
      mergeCategoryCounts(existing.categoryCounts, place.category, weight);
      continue;
    }

    const categoryCounts = new Map<TimelinePlaceCategory, number>();
    mergeCategoryCounts(categoryCounts, place.category, weight);

    cities.set(cityId, {
      id: cityId,
      city: place.city,
      region: place.region,
      country: place.country,
      countryCode: place.countryCode,
      lat: place.lat,
      lng: place.lng,
      visitCount: place.visitCount,
      totalDurationMinutes: place.totalDurationMinutes,
      placeCount: 1,
      tripCount: 0,
      firstVisitedAt: place.firstVisitedAt,
      lastVisitedAt: place.lastVisitedAt,
      categories: [],
      categoryCounts,
      weight,
    });
  }

  return [...cities.values()]
    .map(({ categoryCounts, weight: _weight, ...city }) => ({
      ...city,
      categories: pickTopCategories(categoryCounts, 3),
    }))
    .sort((left, right) => {
      if (right.totalDurationMinutes !== left.totalDurationMinutes) {
        return right.totalDurationMinutes - left.totalDurationMinutes;
      }
      return right.visitCount - left.visitCount;
    });
}

function buildCountrySummaries(places: TimelinePlaceSummary[]): TimelineCountrySummary[] {
  const countries = new Map<string, MutableCountryAccumulator>();

  for (const place of places) {
    const countryId = buildCountryId(place.countryCode, place.country);
    if (!countryId || !place.country) continue;

    const weight = Math.max(place.totalDurationMinutes, 30);
    const existing = countries.get(countryId);
    if (existing) {
      const combinedWeight = existing.weight + weight;
      existing.lat = (existing.lat * existing.weight + place.lat * weight) / combinedWeight;
      existing.lng = (existing.lng * existing.weight + place.lng * weight) / combinedWeight;
      existing.weight = combinedWeight;
      existing.visitCount += place.visitCount;
      existing.totalDurationMinutes += place.totalDurationMinutes;
      existing.placeCount += 1;
      if (place.firstVisitedAt && (!existing.firstVisitedAt || compareTimelineTimes(place.firstVisitedAt, existing.firstVisitedAt) < 0)) {
        existing.firstVisitedAt = place.firstVisitedAt;
      }
      if (place.lastVisitedAt && (!existing.lastVisitedAt || compareTimelineTimes(place.lastVisitedAt, existing.lastVisitedAt) > 0)) {
        existing.lastVisitedAt = place.lastVisitedAt;
      }
      continue;
    }

    countries.set(countryId, {
      id: countryId,
      country: place.country,
      countryCode: place.countryCode,
      lat: place.lat,
      lng: place.lng,
      visitCount: place.visitCount,
      totalDurationMinutes: place.totalDurationMinutes,
      cityCount: 0,
      placeCount: 1,
      tripCount: 0,
      firstVisitedAt: place.firstVisitedAt,
      lastVisitedAt: place.lastVisitedAt,
      weight,
    });
  }

  return [...countries.values()].sort((left, right) => {
    if (right.totalDurationMinutes !== left.totalDurationMinutes) {
      return right.totalDurationMinutes - left.totalDurationMinutes;
    }
    return right.visitCount - left.visitCount;
  });
}

function buildResolvedVisits(visits: TimelineVisit[], places: TimelinePlaceSummary[]): ResolvedVisit[] {
  const placeById = new Map(places.map((place) => [place.placeId, place] as const));
  return [...visits]
    .sort((left, right) => compareTimelineTimes(left.startTime || left.endTime, right.startTime || right.endTime))
    .map((visit) => {
      const place = placeById.get(visit.placeId) || buildFallbackPlaceSummary(visit);
      return {
        visit,
        place,
        cityId: buildCityId(place.city, place.region, place.countryCode, place.country),
        countryId: buildCountryId(place.countryCode, place.country),
      };
    });
}

function detectHomeContext(cities: TimelineCitySummary[], countries: TimelineCountrySummary[]): TripBuildContext {
  const homeCity = [...cities].sort((left, right) => {
    const leftScore = left.visitCount * 4 + left.totalDurationMinutes / 60;
    const rightScore = right.visitCount * 4 + right.totalDurationMinutes / 60;
    return rightScore - leftScore;
  })[0] || null;

  const homeCountry =
    homeCity?.countryCode ||
    [...countries].sort((left, right) => {
      const leftScore = left.visitCount * 4 + left.totalDurationMinutes / 60;
      const rightScore = right.visitCount * 4 + right.totalDurationMinutes / 60;
      return rightScore - leftScore;
    })[0]?.countryCode ||
    null;

  return {
    homeCityId: homeCity?.id || null,
    homeCountryCode: homeCountry,
    homeLat: homeCity?.lat ?? null,
    homeLng: homeCity?.lng ?? null,
  };
}

function isAwayVisit(event: ResolvedVisit, context: TripBuildContext): boolean {
  if (context.homeCityId && event.cityId === context.homeCityId) return false;

  if (
    context.homeLat != null &&
    context.homeLng != null &&
    distanceKm(context.homeLat, context.homeLng, event.place.lat, event.place.lng) <= LOCAL_TRAVEL_RADIUS_KM
  ) {
    return false;
  }

  if (
    event.place.category === "Airports" &&
    context.homeCountryCode &&
    event.place.countryCode === context.homeCountryCode &&
    context.homeLat != null &&
    context.homeLng != null &&
    distanceKm(context.homeLat, context.homeLng, event.place.lat, event.place.lng) < LOCAL_TRAVEL_RADIUS_KM
  ) {
    return false;
  }

  if (context.homeCountryCode && event.place.countryCode && event.place.countryCode !== context.homeCountryCode) {
    return true;
  }

  if (context.homeCityId && event.cityId && event.cityId !== context.homeCityId) return true;
  if (!context.homeCityId && event.cityId) return true;
  return false;
}

function shouldSplitTrip(previous: ResolvedVisit, next: ResolvedVisit): boolean {
  const previousTime = toTimestamp(previous.visit.endTime || previous.visit.startTime);
  const nextTime = toTimestamp(next.visit.startTime || next.visit.endTime);
  if (Number.isNaN(previousTime) || Number.isNaN(nextTime)) return false;

  const gapHours = (nextTime - previousTime) / (1000 * 60 * 60);
  if (gapHours > TRIP_BREAK_GAP_HOURS) return true;
  if (gapHours > 36 && previous.cityId && next.cityId && previous.cityId !== next.cityId) return true;
  return false;
}

function summarizeTrip(events: ResolvedVisit[], tripIndex: number): TimelineTripSummary | null {
  if (events.length === 0) return null;

  const nonAirportEvents = events.filter((event) => event.place.category !== "Airports");
  const anchorEvents = nonAirportEvents.length > 0 ? nonAirportEvents : events;
  const cityScores = new Map<string, number>();
  const countryScores = new Map<string, number>();
  const categoryScores = new Map<TimelinePlaceCategory, number>();
  const placeScores = new Map<string, number>();
  const cityLabels = new Map<string, string>();
  const countryLabels = new Map<string, string>();

  let totalLat = 0;
  let totalLng = 0;
  let totalWeight = 0;

  for (const event of anchorEvents) {
    const weight = Math.max(event.visit.durationMinutes, 45);
    totalLat += event.place.lat * weight;
    totalLng += event.place.lng * weight;
    totalWeight += weight;
    mergeCategoryCounts(categoryScores, event.place.category, weight);

    if (event.cityId) {
      cityScores.set(event.cityId, (cityScores.get(event.cityId) || 0) + weight);
      const label = cityDisplayLabel(event.place);
      if (label) cityLabels.set(event.cityId, label);
    }

    if (event.countryId && event.place.country) {
      countryScores.set(event.countryId, (countryScores.get(event.countryId) || 0) + weight);
      countryLabels.set(event.countryId, event.place.country);
    }

    placeScores.set(event.place.name, (placeScores.get(event.place.name) || 0) + weight);
  }

  const dominantCityId = [...cityScores.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  const dominantCountryId =
    [...countryScores.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;

  const dominantCityEvent =
    (dominantCityId ? anchorEvents.find((event) => event.cityId === dominantCityId) : null) ||
    anchorEvents[0] ||
    null;
  const dominantCountryEvent =
    (dominantCountryId ? anchorEvents.find((event) => event.countryId === dominantCountryId) : null) ||
    dominantCityEvent;

  const startTime = events[0].visit.startTime || events[0].visit.endTime;
  const endTime =
    events[events.length - 1].visit.endTime ||
    events[events.length - 1].visit.startTime;
  const totalDurationMinutes = events.reduce((sum, event) => sum + event.visit.durationMinutes, 0);
  const uniquePlaces = dedupe(anchorEvents.map((event) => event.place.name));
  const cities = dedupe(
    anchorEvents
      .map((event) => cityDisplayLabel(event.place))
      .filter((label): label is string => Boolean(label))
  );
  const categories = pickTopCategories(categoryScores, 4);
  const topPlaces = [...placeScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([name]) => name);

  const baseLabel =
    cityLabels.get(dominantCityId || "") ||
    countryLabels.get(dominantCountryId || "") ||
    topPlaces[0] ||
    `Trip ${tripIndex + 1}`;
  const tripMonthLabel = monthLabel(startTime || endTime);

  return {
    id: `trip-${tripIndex + 1}`,
    label: tripMonthLabel ? `${baseLabel} · ${tripMonthLabel}` : baseLabel,
    startTime,
    endTime,
    monthLabel: tripMonthLabel,
    city: dominantCityEvent?.place.city || null,
    region: dominantCityEvent?.place.region || null,
    country: dominantCountryEvent?.place.country || dominantCityEvent?.place.country || null,
    countryCode: dominantCountryEvent?.place.countryCode || dominantCityEvent?.place.countryCode || null,
    lat: totalWeight > 0 ? totalLat / totalWeight : anchorEvents[0].place.lat,
    lng: totalWeight > 0 ? totalLng / totalWeight : anchorEvents[0].place.lng,
    visitCount: events.length,
    placeCount: uniquePlaces.length,
    totalDurationMinutes,
    durationHours: durationHours(startTime, endTime),
    cities,
    categories,
    topPlaces,
  };
}

function buildTrips(
  resolvedVisits: ResolvedVisit[],
  context: TripBuildContext
): TimelineTripSummary[] {
  const trips: TimelineTripSummary[] = [];
  let current: ResolvedVisit[] = [];

  const flushTrip = () => {
    if (current.length === 0) return;
    const summarized = summarizeTrip(current, trips.length);
    const uniqueCityCount = new Set(current.map((event) => event.cityId).filter(Boolean)).size;
    const totalDurationMinutes = current.reduce((sum, event) => sum + event.visit.durationMinutes, 0);
    const tripDistanceKm =
      summarized && context.homeLat != null && context.homeLng != null
        ? distanceKm(context.homeLat, context.homeLng, summarized.lat, summarized.lng)
        : null;

    if (
      isDisplayableTrip(summarized) &&
      (
        summarized.countryCode !== context.homeCountryCode ||
        uniqueCityCount >= 2 ||
        totalDurationMinutes >= 6 * 60 ||
        summarized.placeCount >= 2 ||
        (tripDistanceKm != null && tripDistanceKm > LOCAL_TRAVEL_RADIUS_KM)
      )
    ) {
      trips.push(summarized);
    }
    current = [];
  };

  for (const event of resolvedVisits) {
    const away = isAwayVisit(event, context);

    if (!away) {
      if (current.length > 0) {
        const homeDuration = event.visit.durationMinutes;
        if (homeDuration >= TRIP_HOME_SETTLE_MINUTES || event.place.category !== "Airports") {
          flushTrip();
        }
      }
      continue;
    }

    if (current.length === 0) {
      current.push(event);
      continue;
    }

    const previous = current[current.length - 1];
    if (shouldSplitTrip(previous, event)) {
      flushTrip();
    }

    current.push(event);
  }

  flushTrip();

  return trips.sort((left, right) => compareTimelineTimes(left.startTime || left.endTime, right.startTime || right.endTime));
}

function applyTripCounts(
  cities: TimelineCitySummary[],
  countries: TimelineCountrySummary[],
  trips: TimelineTripSummary[]
): {
  cities: TimelineCitySummary[];
  countries: TimelineCountrySummary[];
} {
  const cityTripCounts = new Map<string, number>();
  const countryTripCounts = new Map<string, number>();

  for (const trip of trips) {
    const cityId = buildCityId(trip.city, trip.region, trip.countryCode, trip.country);
    const countryId = buildCountryId(trip.countryCode, trip.country);
    if (cityId) cityTripCounts.set(cityId, (cityTripCounts.get(cityId) || 0) + 1);
    if (countryId) countryTripCounts.set(countryId, (countryTripCounts.get(countryId) || 0) + 1);
  }

  const citiesWithCounts = cities.map((city) => ({
    ...city,
    tripCount: cityTripCounts.get(city.id) || 0,
  }));

  const countryCityCounts = new Map<string, Set<string>>();
  for (const city of citiesWithCounts) {
    const countryId = buildCountryId(city.countryCode, city.country);
    if (!countryId) continue;
    const set = countryCityCounts.get(countryId) || new Set<string>();
    set.add(city.id);
    countryCityCounts.set(countryId, set);
  }

  const countriesWithCounts = countries.map((country) => ({
    ...country,
    cityCount: countryCityCounts.get(country.id)?.size || 0,
    tripCount: countryTripCounts.get(country.id) || 0,
  }));

  return {
    cities: citiesWithCounts,
    countries: countriesWithCounts,
  };
}

function buildCategoryPreferences(places: TimelinePlaceSummary[], trips: TimelineTripSummary[], countries: TimelineCountrySummary[]): string[] {
  const categoryScores = new Map<TimelinePlaceCategory, number>();
  for (const place of places) {
    mergeCategoryCounts(categoryScores, place.category, Math.max(place.totalDurationMinutes, 30));
  }

  const preferences: string[] = [];
  const categories = pickTopCategories(categoryScores, 3);

  for (const category of categories) {
    if (category === "Food & Drink") {
      preferences.push("Returns to food-forward neighborhoods and repeat dining anchors");
    } else if (category === "Culture") {
      preferences.push("Makes room for museums, galleries, temples, and cultural anchors");
    } else if (category === "Attractions") {
      preferences.push("Leans toward destination highlights and anchor attractions");
    } else if (category === "Shopping") {
      preferences.push("Often includes markets, malls, and browseable shopping districts");
    } else if (category === "Sports") {
      preferences.push("Mixes sports and active venues into travel patterns");
    }
  }

  if (trips.length >= 75) {
    preferences.push("Comfortable with frequent trips rather than only occasional long vacations");
  }

  if (countries.length >= 10) {
    preferences.push("Navigates international travel comfortably across many countries");
  }

  return dedupe(preferences).slice(0, 5);
}

function buildFoodPreferences(places: TimelinePlaceSummary[]): string[] {
  const foodPlaces = places.filter((place) => place.category === "Food & Drink");
  if (foodPlaces.length === 0) return [];

  const typeScores = new Map<string, number>();
  for (const place of foodPlaces) {
    const weight = Math.max(place.totalDurationMinutes, 30);
    for (const type of place.types) {
      typeScores.set(type, (typeScores.get(type) || 0) + weight);
    }
  }

  const preferences: string[] = [];
  const hasType = (value: string) => (typeScores.get(value) || 0) >= 180;
  const hasRestaurantFamily = [...typeScores.keys()].some((type) => type.endsWith("_restaurant"));

  if (hasType("cafe") || hasType("coffee_shop")) {
    preferences.push("Returns to cafes and coffee stops often enough to matter");
  }
  if (hasType("bakery") || hasType("ice_cream_shop")) {
    preferences.push("Makes room for bakeries, dessert stops, and snack breaks");
  }
  if (hasType("bar")) {
    preferences.push("Includes bars and evening food districts in repeat travel behavior");
  }
  if (hasRestaurantFamily || hasType("restaurant")) {
    preferences.push("Trips regularly orbit strong restaurant neighborhoods, not just landmarks");
  }

  return dedupe(preferences).slice(0, 4);
}

function buildVisitedDestinations(cities: TimelineCitySummary[], countries: TimelineCountrySummary[], trips: TimelineTripSummary[]): string[] {
  return dedupe([
    ...cities.map((city) => (city.region ? `${city.city}, ${city.region}` : city.city)),
    ...countries.map((country) => country.country),
    ...trips.map((trip) => trip.label),
  ]);
}

function buildMapPoints(
  places: TimelinePlaceSummary[],
  cities: TimelineCitySummary[],
  countries: TimelineCountrySummary[],
  trips: TimelineTripSummary[]
): TimelineAnalysisResponse["mapPoints"] {
  const placePoints: TimelineMapPoint[] = places.slice(0, MAX_PLACE_MAP_POINTS).map((place) => ({
    id: place.placeId,
    lat: place.lat,
    lng: place.lng,
    name: place.name,
    kind: "place",
    description: [
      place.category,
      cityDisplayLabel(place) || place.country || "Unknown city",
      `${place.visitCount} ${place.visitCount === 1 ? "visit" : "visits"}`,
      formatDuration(place.totalDurationMinutes),
    ].join(" · "),
    color: getTimelineCategoryColor(place.category),
    visitCount: place.visitCount,
    totalDurationMinutes: place.totalDurationMinutes,
    identified: Boolean(place.city || place.country || place.formattedAddress),
  }));

  const cityPoints: TimelineMapPoint[] = cities.map((city) => ({
    id: city.id,
    lat: city.lat,
    lng: city.lng,
    name: city.region ? `${city.city}, ${city.region}` : city.city,
    kind: "city",
    description: [
      city.country || "Unknown country",
      `${city.placeCount} ${city.placeCount === 1 ? "place" : "places"}`,
      `${city.visitCount} ${city.visitCount === 1 ? "visit" : "visits"}`,
      city.tripCount > 0 ? `${city.tripCount} ${city.tripCount === 1 ? "trip" : "trips"}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    color: "#0f766e",
    visitCount: city.visitCount,
    totalDurationMinutes: city.totalDurationMinutes,
    identified: true,
  }));

  const countryPoints: TimelineMapPoint[] = countries.map((country) => ({
    id: country.id,
    lat: country.lat,
    lng: country.lng,
    name: country.country,
    kind: "country",
    description: [
      `${country.cityCount} ${country.cityCount === 1 ? "city" : "cities"}`,
      `${country.tripCount} ${country.tripCount === 1 ? "trip" : "trips"}`,
      `${country.placeCount} ${country.placeCount === 1 ? "place" : "places"}`,
    ].join(" · "),
    color: "#1d4ed8",
    visitCount: country.visitCount,
    totalDurationMinutes: country.totalDurationMinutes,
    identified: true,
  }));

  const tripPoints: TimelineMapPoint[] = trips.map((trip) => ({
    id: trip.id,
    lat: trip.lat,
    lng: trip.lng,
    name: trip.label,
    kind: "trip",
    description: [
      trip.country || "Unknown country",
      trip.cities.length > 0 ? trip.cities.join(" / ") : null,
      formatDuration(trip.totalDurationMinutes),
      `${trip.placeCount} ${trip.placeCount === 1 ? "place" : "places"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    color: "#c2410c",
    visitCount: trip.visitCount,
    totalDurationMinutes: trip.totalDurationMinutes,
    identified: true,
  }));

  return {
    places: placePoints,
    cities: cityPoints,
    countries: countryPoints,
    trips: tripPoints,
  };
}

function findTripMatch(trips: TimelineTripSummary[], placeName: string, year: number, monthIndex: number): boolean {
  const target = normalizeLabel(placeName);

  return trips.some((trip) => {
    const labels = [trip.label, trip.city || "", ...trip.topPlaces].map(normalizeLabel).join(" ");
    if (!labels.includes(target)) return false;

    const startValue = trip.startTime || trip.endTime;
    const endValue = trip.endTime || trip.startTime;
    if (!startValue || !endValue) return false;

    const start = new Date(startValue);
    const end = new Date(endValue);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;

    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
    return start.getTime() < monthEnd.getTime() && end.getTime() >= monthStart.getTime();
  });
}

function buildVerification(cities: TimelineCitySummary[], countries: TimelineCountrySummary[], trips: TimelineTripSummary[]) {
  const usCityCount = cities.filter((city) => city.countryCode === "US" || normalizeLabel(city.country || "") === "united states").length;
  const indiaCityCount = cities.filter((city) => city.countryCode === "IN" || normalizeLabel(city.country || "") === "india").length;

  return {
    checks: [
      {
        id: "us-cities",
        label: "200+ cities in the United States",
        passed: usCityCount >= 200,
        actual: `${usCityCount} cities`,
        expected: "200+ cities",
      },
      {
        id: "india-cities",
        label: "20+ cities in India",
        passed: indiaCityCount >= 20,
        actual: `${indiaCityCount} cities`,
        expected: "20+ cities",
      },
      {
        id: "countries",
        label: "15 countries visited",
        passed: countries.length >= 15,
        actual: `${countries.length} countries`,
        expected: "15+ countries",
      },
      {
        id: "trip-count",
        label: "100+ trips detected",
        passed: trips.length >= 100,
        actual: `${trips.length} trips`,
        expected: "100+ trips",
      },
      {
        id: "atlantic-city",
        label: "Atlantic City in November 2024",
        passed: findTripMatch(trips, "Atlantic City", 2024, 10),
        actual: findTripMatch(trips, "Atlantic City", 2024, 10) ? "Found" : "Missing",
        expected: "Trip present",
      },
      {
        id: "philadelphia",
        label: "Philadelphia in August 2024",
        passed: findTripMatch(trips, "Philadelphia", 2024, 7),
        actual: findTripMatch(trips, "Philadelphia", 2024, 7) ? "Found" : "Missing",
        expected: "Trip present",
      },
      {
        id: "seoul",
        label: "Seoul in April 2024",
        passed: findTripMatch(trips, "Seoul", 2024, 3),
        actual: findTripMatch(trips, "Seoul", 2024, 3) ? "Found" : "Missing",
        expected: "Trip present",
      },
    ],
  };
}

function buildSummary(
  places: TimelinePlaceSummary[],
  cities: TimelineCitySummary[],
  countries: TimelineCountrySummary[],
  trips: TimelineTripSummary[]
): string {
  const topCategories = dedupe(places.slice(0, 20).map((place) => place.category)).slice(0, 3);
  const categoryClause = topCategories.length > 0 ? ` Strongest categories: ${topCategories.join(", ")}.` : "";
  return `Processed ${places.reduce((sum, place) => sum + place.visitCount, 0)} qualifying visits into ${places.length} places, ${cities.length} cities, ${countries.length} countries, and ${trips.length} trips.${categoryClause}`;
}

export async function analyzeTimelineVisits(visits: TimelineVisit[]): Promise<TimelineAnalysisResponse> {
  const normalizedVisits = visits
    .filter((visit) =>
      Number.isFinite(visit.lat) &&
      Number.isFinite(visit.lng) &&
      typeof visit.placeId === "string" &&
      visit.placeId.trim()
    )
    .sort((left, right) => compareTimelineTimes(left.startTime || left.endTime, right.startTime || right.endTime));

  if (normalizedVisits.length === 0) {
    return {
      summary: "No qualifying timeline visits were found in the uploaded export.",
      preferences: [],
      foodPreferences: [],
      visitedDestinations: [],
      places: [],
      cities: [],
      countries: [],
      trips: [],
      mapPoints: {
        places: [],
        cities: [],
        countries: [],
        trips: [],
      },
      verification: {
        checks: [],
      },
      stats: {
        visitCount: 0,
        placeCount: 0,
        cityCount: 0,
        countryCount: 0,
        tripCount: 0,
      },
    };
  }

  const placeInfoById = await resolveTimelinePlaceInfoMap(
    normalizedVisits.map((visit) => ({
      placeId: visit.placeId,
      lat: visit.lat,
      lng: visit.lng,
    }))
  );
  const places = buildPlaceSummaries(normalizedVisits, placeInfoById);
  const citySummaries = buildCitySummaries(places);
  const countrySummaries = buildCountrySummaries(places);
  const resolvedVisits = buildResolvedVisits(normalizedVisits, places);
  const tripContext = detectHomeContext(citySummaries, countrySummaries);
  const trips = buildTrips(resolvedVisits, tripContext);
  const { cities, countries } = applyTripCounts(citySummaries, countrySummaries, trips);

  return {
    summary: buildSummary(places, cities, countries, trips),
    preferences: buildCategoryPreferences(places, trips, countries),
    foodPreferences: buildFoodPreferences(places),
    visitedDestinations: buildVisitedDestinations(cities, countries, trips),
    places,
    cities,
    countries,
    trips,
    mapPoints: buildMapPoints(places, cities, countries, trips),
    verification: buildVerification(cities, countries, trips),
    stats: {
      visitCount: normalizedVisits.length,
      placeCount: places.length,
      cityCount: cities.length,
      countryCount: countries.length,
      tripCount: trips.length,
    },
  };
}
