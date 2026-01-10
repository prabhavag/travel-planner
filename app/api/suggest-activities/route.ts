import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import { getGeocodingService } from "@/lib/services/geocoding-service";
import { getPlacesClient, PlacesClient } from "@/lib/services/places-client";
import type { SuggestedActivity, Coordinates } from "@/lib/models/travel-plan";

/**
 * Enrich a single activity with Places API data (coordinates, ratings, place_id)
 */
async function enrichSingleActivity(
  activity: SuggestedActivity,
  destination: string,
  destinationCoords: Coordinates | null
): Promise<SuggestedActivity> {
  const geocodingService = getGeocodingService();
  let placesClient: PlacesClient | null = null;
  try {
    placesClient = getPlacesClient();
  } catch {
    console.warn("Places client not available, using geocoding only");
  }

  try {
    // First try to get place data from Places API
    if (placesClient) {
      const searchQuery = `${activity.name}, ${destination}`;
      // Use nearby search with destination coords to avoid wrong locations (e.g., Lake Geneva, USA vs Switzerland)
      const places = await placesClient.searchPlaces(searchQuery, destinationCoords, 50000);

      if (places && places.length > 0) {
        const place = places[0];
        // Fetch photo URL if place_id is available
        let photoUrl: string | null = null;
        if (place.place_id) {
          photoUrl = await placesClient.getPlacePhotoUrlFromId(place.place_id, 200);
        }
        return {
          ...activity,
          coordinates: place.location,
          rating: place.rating || null,
          place_id: place.place_id,
          photo_url: photoUrl,
        };
      }
    }

    // Fallback to geocoding
    if (geocodingService) {
      const query = `${activity.name}, ${destination}`;
      const coords = await geocodingService.geocode(query);
      if (coords) {
        return { ...activity, coordinates: coords };
      }
    }
  } catch (error) {
    console.warn(`Failed to enrich ${activity.name}:`, (error as Error).message);
  }
  return activity;
}

export async function POST(request: NextRequest) {
  // Parse request and validate
  let sessionId: string;
  try {
    const body = await request.json();
    sessionId = body.sessionId;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!sessionId) {
    return NextResponse.json(
      { success: false, message: "Missing sessionId" },
      { status: 400 }
    );
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Session not found or expired" },
      { status: 404 }
    );
  }

  // Validate state - should be called after INFO_GATHERING is complete
  if (session.workflowState !== WORKFLOW_STATES.INFO_GATHERING) {
    return NextResponse.json(
      {
        success: false,
        message: "Can only suggest activities from INFO_GATHERING state",
      },
      { status: 400 }
    );
  }

  // Validate required trip info
  if (!session.tripInfo.destination || !session.tripInfo.startDate || !session.tripInfo.endDate) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing required trip info: destination, startDate, or endDate",
      },
      { status: 400 }
    );
  }

  const destination = session.tripInfo.destination;
  const tripInfo = session.tripInfo;

  // Create SSE streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Start async processing
  (async () => {
    try {
      // Send start event
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "start" })}\n\n`));

      // Generate activities using LLM (streaming JSONL)
      const llmClient = getLLMClient();
      const activities: SuggestedActivity[] = [];
      let message = "";

      // Stream activities as they're parsed from LLM
      for await (const chunk of llmClient.suggestTopActivities({ tripInfo })) {
        if (chunk.type === "message") {
          message = chunk.message;
        } else if (chunk.type === "activity") {
          // Stream activity immediately as it's generated
          activities.push(chunk.activity);
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "activity", activity: chunk.activity })}\n\n`));
        } else if (chunk.type === "error") {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message: chunk.message })}\n\n`));
          await writer.close();
          return;
        }
        // "complete" type means LLM is done, we continue to enrichment
      }

      // Geocode destination first to bias Places API searches toward correct location
      const geocodingService = getGeocodingService();
      let destinationCoords: Coordinates | null = null;
      if (geocodingService) {
        try {
          destinationCoords = await geocodingService.geocode(destination);
        } catch (error) {
          console.warn("Failed to geocode destination:", (error as Error).message);
        }
      }

      // Now enrich activities in parallel and send updates
      const enrichedActivities = await Promise.all(
        activities.map(async (activity) => {
          const enriched = await enrichSingleActivity(activity, destination, destinationCoords);
          // Send enrichment update if coordinates were added
          if (enriched.coordinates && !activity.coordinates) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "enrichment", activity: enriched })}\n\n`));
          }
          return enriched;
        })
      );

      // Update session state
      sessionStore.update(sessionId, {
        workflowState: WORKFLOW_STATES.SUGGEST_ACTIVITIES,
        suggestedActivities: enrichedActivities,
        selectedActivityIds: [],
      });

      sessionStore.addToConversation(sessionId, "assistant", message);

      // Send complete event
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "complete", message })}\n\n`));
    } catch (error) {
      console.error("Error in suggestActivities streaming:", error);
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`));
      } catch {
        // Client may have disconnected, ignore write error
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // Stream may already be closed, ignore
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
