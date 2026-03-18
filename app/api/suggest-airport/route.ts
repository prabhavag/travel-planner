import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";
import { getPlacesClient } from "@/lib/services/places-client";

function dedupeByPlaceId<T extends { place_id: string }>(places: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const place of places) {
    if (!place.place_id || seen.has(place.place_id)) continue;
    seen.add(place.place_id);
    unique.push(place);
  }
  return unique;
}

function airportScore(place: { types?: string[]; rating?: number; user_ratings_total?: number }): number {
  const types = place.types || [];
  let score = 0;
  if (types.includes("international_airport")) score += 3;
  if (types.includes("airport")) score += 2;
  score += (place.rating || 0) * 0.2;
  score += Math.min((place.user_ratings_total || 0) / 1000, 2);
  return score;
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ success: false, message: "Missing sessionId" }, { status: 400 });
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return NextResponse.json({ success: false, message: "Session not found or expired" }, { status: 404 });
    }

    const destination = session.tripInfo.destination?.trim();
    if (!destination) {
      return NextResponse.json({ success: false, message: "Destination is required" }, { status: 400 });
    }

    try {
      const placesClient = getPlacesClient();
      const queries = [
        `main international airport in ${destination}`,
        `major airport in ${destination}`,
        `${destination} airport`,
      ];

      const batches = await Promise.all(
        queries.map((query) => placesClient.searchPlaces(query, null, 12000, "airport", { preferTextSearch: true })),
      );

      const top = dedupeByPlaceId(batches.flat())
        .sort((a, b) => airportScore(b) - airportScore(a))[0];

      return NextResponse.json({
        success: true,
        airportName: top?.name || null,
      });
    } catch (error) {
      console.warn("Airport suggestion lookup unavailable:", error);
      return NextResponse.json({
        success: true,
        airportName: null,
        message: "Airport lookup is unavailable.",
      });
    }
  } catch (error) {
    console.error("Error in suggest-airport:", error);
    return NextResponse.json(
      { success: false, message: "Failed to suggest airport", error: String(error) },
      { status: 500 },
    );
  }
}

