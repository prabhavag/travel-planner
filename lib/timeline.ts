export interface TimelineVisit {
  key: string;
  placeId: string | null;
  name: string | null;
  semanticType: string | null;
  lat: number;
  lng: number;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
}

export interface TimelineAnalysisRequest {
  visits: TimelineVisit[];
}

export interface TimelineMapPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  kind: "local" | "regional" | "travel";
  visitCount: number;
  totalDurationMinutes: number;
  identified: boolean;
}

export interface TimelineVisitedPlace {
  name: string;
  lat: number;
  lng: number;
  visitCount: number;
  totalDurationMinutes: number;
}

export interface TimelineAnalysisResponse {
  summary: string;
  preferences: string[];
  foodPreferences: string[];
  visitedDestinations: string[];
  visitedPlaces: TimelineVisitedPlace[];
  localSignals: string[];
  travelSignals: string[];
  mapPoints: TimelineMapPoint[];
  stats: {
    visitCount: number;
    recurringPlaceCount: number;
    localPlaceCount: number;
    travelPlaceCount: number;
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
  if (typeof value === "string") {
    const match = value.match(/geo:([-\d.]+),([-\d.]+)/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  if (!isRecord(value)) return null;

  const lat =
    toNumber(value.lat) ??
    toNumber(value.latitude) ??
    (toNumber(value.latitudeE7) != null ? Number(toNumber(value.latitudeE7)) / 1e7 : null);
  const lng =
    toNumber(value.lng) ??
    toNumber(value.longitude) ??
    (toNumber(value.longitudeE7) != null ? Number(toNumber(value.longitudeE7)) / 1e7 : null);

  if (lat != null && lng != null) {
    return { lat, lng };
  }

  if ("latLng" in value) {
    return parseCoordinatePair(value.latLng);
  }

  return null;
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

function buildTimelineVisit(
  placeId: string | null,
  coordinates: { lat: number; lng: number } | null,
  name: string | null,
  semanticType: string | null,
  startTime: string | null,
  endTime: string | null
): TimelineVisit | null {
  if (!coordinates) return null;

  const normalizedName = typeof name === "string" && name.trim() ? name.trim() : null;
  const normalizedSemanticType =
    typeof semanticType === "string" && semanticType.trim() ? semanticType.trim() : null;
  const key = placeId || `coord:${coordinates.lat.toFixed(5)},${coordinates.lng.toFixed(5)}`;

  return {
    key,
    placeId,
    name: normalizedName,
    semanticType: normalizedSemanticType,
    lat: coordinates.lat,
    lng: coordinates.lng,
    startTime,
    endTime,
    durationMinutes: parseDurationMinutes(startTime, endTime),
  };
}

function extractDirectVisit(entry: UnknownRecord): TimelineVisit | null {
  if (!isRecord(entry.visit)) return null;

  const visit = entry.visit;
  const candidate = isRecord(visit.topCandidate) ? visit.topCandidate : null;
  const coordinates =
    parseCoordinatePair(candidate?.placeLocation) ??
    parseCoordinatePair(visit.placeLocation) ??
    parseCoordinatePair(candidate?.location) ??
    parseCoordinatePair(visit.location);

  return buildTimelineVisit(
    (typeof candidate?.placeID === "string" && candidate.placeID) ||
      (typeof candidate?.placeId === "string" && candidate.placeId) ||
      (typeof visit.placeId === "string" && visit.placeId) ||
      null,
    coordinates,
    (typeof candidate?.name === "string" && candidate.name) ||
      (typeof visit.name === "string" && visit.name) ||
      null,
    (typeof candidate?.semanticType === "string" && candidate.semanticType) ||
      (typeof visit.semanticType === "string" && visit.semanticType) ||
      null,
    toIsoString(entry.startTime) ?? toIsoString(visit.startTime),
    toIsoString(entry.endTime) ?? toIsoString(visit.endTime)
  );
}

function extractPlaceVisit(entry: UnknownRecord): TimelineVisit | null {
  if (!isRecord(entry.placeVisit)) return null;

  const placeVisit = entry.placeVisit;
  const location = isRecord(placeVisit.location) ? placeVisit.location : null;
  const duration = isRecord(placeVisit.duration) ? placeVisit.duration : null;
  const candidateLocations = Array.isArray(placeVisit.otherCandidateLocations)
    ? placeVisit.otherCandidateLocations.filter(isRecord)
    : [];
  const fallbackCandidate = candidateLocations[0] ?? null;
  const coordinates =
    parseCoordinatePair(location) ??
    parseCoordinatePair(fallbackCandidate) ??
    parseCoordinatePair(location?.latLng) ??
    null;

  return buildTimelineVisit(
    (typeof location?.placeId === "string" && location.placeId) ||
      (typeof location?.placeID === "string" && location.placeID) ||
      (typeof fallbackCandidate?.placeId === "string" && fallbackCandidate.placeId) ||
      null,
    coordinates,
    (typeof location?.name === "string" && location.name) ||
      (typeof location?.address === "string" && location.address) ||
      null,
    (typeof location?.semanticType === "string" && location.semanticType) || null,
    toIsoString(duration?.startTimestamp) ??
      toIsoString(duration?.startTimestampMs) ??
      toIsoString(placeVisit.startTime),
    toIsoString(duration?.endTimestamp) ??
      toIsoString(duration?.endTimestampMs) ??
      toIsoString(placeVisit.endTime)
  );
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

  if (Array.isArray(payload.locations)) {
    return payload.locations.filter(isRecord);
  }

  return [];
}

export function extractTimelineVisits(payload: unknown): TimelineVisit[] {
  return getTimelineEntries(payload)
    .map((entry) => extractDirectVisit(entry) ?? extractPlaceVisit(entry))
    .filter((visit): visit is TimelineVisit => Boolean(visit));
}
