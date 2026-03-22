import { NextRequest, NextResponse } from "next/server";

type Coordinates = { lat: number; lng: number };

type RouteLegRequest = {
  id: string;
  origin: Coordinates;
  destination: Coordinates;
  intermediates?: Coordinates[];
  travelMode?: "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT" | "TWO_WHEELER" | "TRAVEL_MODE_UNSPECIFIED";
  includePolyline?: boolean;
};

type RouteLegResult = {
  id: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  polyline?: string | null;
  error?: string;
};

const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const MAX_LEGS = 25;

function isValidCoordinate(value: Coordinates | null | undefined): value is Coordinates {
  if (!value) return false;
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180
  );
}

function parseDurationSeconds(duration?: string): number | null {
  if (!duration) return null;
  const match = duration.match(/^\s*([\d.]+)s\s*$/);
  if (!match) return null;
  const seconds = Number.parseFloat(match[1]);
  if (!Number.isFinite(seconds)) return null;
  return Math.round(seconds);
}

function getRoutesApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || null;
}

async function computeRoute(apiKey: string, leg: RouteLegRequest): Promise<RouteLegResult> {
  const includePolyline = Boolean(leg.includePolyline);
  const fieldMask = ["routes.distanceMeters", "routes.duration"];
  if (includePolyline) {
    fieldMask.push("routes.polyline.encodedPolyline");
  }

  const travelMode = leg.travelMode || "DRIVE";
  const body: Record<string, unknown> = {
    origin: {
      location: {
        latLng: {
          latitude: leg.origin.lat,
          longitude: leg.origin.lng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: leg.destination.lat,
          longitude: leg.destination.lng,
        },
      },
    },
    intermediates: (leg.intermediates || []).map((coord) => ({
      location: {
        latLng: {
          latitude: coord.lat,
          longitude: coord.lng,
        },
      },
    })),
    travelMode,
    languageCode: "en-US",
  };
  if (travelMode === "DRIVE" || travelMode === "TWO_WHEELER") {
    body.routingPreference = "TRAFFIC_UNAWARE";
  }

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask.join(","),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    return {
      id: leg.id,
      distanceMeters: null,
      durationSeconds: null,
      polyline: null,
      error: `Routes API error: ${response.status} ${errorText}`,
    };
  }

  const data = await response.json();
  const route = data?.routes?.[0];

  return {
    id: leg.id,
    distanceMeters: Number.isFinite(route?.distanceMeters) ? route.distanceMeters : null,
    durationSeconds: parseDurationSeconds(route?.duration),
    polyline: includePolyline ? (route?.polyline?.encodedPolyline ?? null) : null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { legs } = await request.json();

    if (!Array.isArray(legs) || legs.length === 0) {
      return NextResponse.json({ success: false, message: "Missing legs" }, { status: 400 });
    }

    if (legs.length > MAX_LEGS) {
      return NextResponse.json(
        { success: false, message: `Too many legs (max ${MAX_LEGS})` },
        { status: 400 }
      );
    }

    const apiKey = getRoutesApiKey();
    if (!apiKey) {
      return NextResponse.json({ success: false, message: "Routes API not configured" }, { status: 500 });
    }

    const sanitizedLegs: RouteLegRequest[] = legs
      .map((leg: RouteLegRequest) => leg)
      .filter((leg) =>
        leg?.id &&
        isValidCoordinate(leg.origin) &&
        isValidCoordinate(leg.destination)
      );

    if (sanitizedLegs.length === 0) {
      return NextResponse.json({ success: false, message: "Invalid leg coordinates" }, { status: 400 });
    }

    const results = await Promise.all(sanitizedLegs.map((leg) => computeRoute(apiKey, leg)));

    return NextResponse.json({ success: true, legs: results });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Failed to compute routes", error: String(error) },
      { status: 500 }
    );
  }
}
