export const TIMELINE_VISIT_PROBABILITY_THRESHOLD = 0.6;
export const TIMELINE_TOP_CANDIDATE_PROBABILITY_THRESHOLD = 0.75;

export type TimelinePlaceCategory =
  | "Food & Drink"
  | "Shopping"
  | "Hotels"
  | "Attractions"
  | "Sports"
  | "Airports"
  | "Culture"
  | "Other";

export type TimelineMapView = "cities" | "trips" | "countries";

export type TimelineMapPoints = Record<TimelineMapView, TimelineMapPoint[]> & {
  places: TimelineMapPoint[];
};

export interface TimelineVisit {
  id: string;
  key: string;
  placeId: string;
  semanticType: string | null;
  lat: number;
  lng: number;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  visitProbability: number;
  candidateProbability: number;
}

export interface TimelineAnalysisRequest {
  visits: TimelineVisit[];
}

export interface TimelineMapPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  kind: "place" | "city" | "trip" | "country";
  description: string;
  color: string;
  visitCount: number;
  totalDurationMinutes: number;
  identified: boolean;
}

export interface TimelinePlaceSummary {
  placeId: string;
  name: string;
  category: TimelinePlaceCategory;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  formattedAddress: string | null;
  lat: number;
  lng: number;
  visitCount: number;
  totalDurationMinutes: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
  types: string[];
}

export interface TimelineCitySummary {
  id: string;
  city: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  visitCount: number;
  totalDurationMinutes: number;
  placeCount: number;
  tripCount: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
  categories: TimelinePlaceCategory[];
}

export interface TimelineCountrySummary {
  id: string;
  country: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  visitCount: number;
  totalDurationMinutes: number;
  cityCount: number;
  placeCount: number;
  tripCount: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
}

export interface TimelineTripSummary {
  id: string;
  label: string;
  startTime: string | null;
  endTime: string | null;
  monthLabel: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  visitCount: number;
  placeCount: number;
  totalDurationMinutes: number;
  durationHours: number;
  cities: string[];
  categories: TimelinePlaceCategory[];
  topPlaces: string[];
}

export interface TimelineVerificationCheck {
  id: string;
  label: string;
  passed: boolean;
  actual: string;
  expected: string;
}

export interface TimelineAnalysisResponse {
  summary: string;
  preferences: string[];
  foodPreferences: string[];
  visitedDestinations: string[];
  places: TimelinePlaceSummary[];
  cities: TimelineCitySummary[];
  countries: TimelineCountrySummary[];
  trips: TimelineTripSummary[];
  mapPoints: TimelineMapPoints;
  verification: {
    checks: TimelineVerificationCheck[];
  };
  stats: {
    visitCount: number;
    placeCount: number;
    cityCount: number;
    countryCount: number;
    tripCount: number;
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIsoString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      const date = new Date(parsed);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function parseCoordinatePair(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== "string") return null;

  const match = value.match(/^geo:([-\d.]+),([-\d.]+)$/i);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

function parseDurationMinutes(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60));
}

function buildTimelineVisit(entry: UnknownRecord): TimelineVisit | null {
  const visit = isRecord(entry.visit) ? entry.visit : null;
  const candidate = visit && isRecord(visit.topCandidate) ? visit.topCandidate : null;
  if (!visit || !candidate) return null;

  const visitProbability = toNumber(visit.probability);
  const candidateProbability = toNumber(candidate.probability);
  const placeId = toNonEmptyString(candidate.placeID) ?? toNonEmptyString(candidate.placeId);
  const coordinates = parseCoordinatePair(candidate.placeLocation);

  if (
    visitProbability == null ||
    visitProbability <= TIMELINE_VISIT_PROBABILITY_THRESHOLD ||
    candidateProbability == null ||
    candidateProbability <= TIMELINE_TOP_CANDIDATE_PROBABILITY_THRESHOLD ||
    !placeId ||
    !coordinates
  ) {
    return null;
  }

  const startTime = toIsoString(entry.startTime) ?? toIsoString(visit.startTime);
  const endTime = toIsoString(entry.endTime) ?? toIsoString(visit.endTime);
  const id = `${placeId}:${startTime ?? endTime ?? "unknown"}`;

  return {
    id,
    key: placeId,
    placeId,
    semanticType: toNonEmptyString(candidate.semanticType),
    lat: coordinates.lat,
    lng: coordinates.lng,
    startTime,
    endTime,
    durationMinutes: parseDurationMinutes(startTime, endTime),
    visitProbability,
    candidateProbability,
  };
}

function getTimelineEntries(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) return [];

  if (Array.isArray(payload.timelineObjects)) {
    return payload.timelineObjects.filter(isRecord);
  }

  if (Array.isArray(payload.semanticSegments)) {
    return payload.semanticSegments.filter(isRecord);
  }

  return [];
}

export function extractTimelineVisits(payload: unknown): TimelineVisit[] {
  return getTimelineEntries(payload)
    .map((entry) => buildTimelineVisit(entry))
    .filter((visit): visit is TimelineVisit => Boolean(visit));
}
