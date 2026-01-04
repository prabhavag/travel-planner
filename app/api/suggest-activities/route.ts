import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import { getGeocodingService } from "@/lib/services/geocoding-service";

interface ActivityOption {
  id: string;
  name: string;
  description?: string;
  coordinates?: { lat: number; lng: number };
}

interface ActivitySuggestions {
  morningActivities?: ActivityOption[];
  afternoonActivities?: ActivityOption[];
  eveningActivities?: ActivityOption[];
}

async function geocodeActivitySuggestions(
  suggestions: ActivitySuggestions,
  destination: string
): Promise<ActivitySuggestions> {
  const geocodingService = getGeocodingService();
  if (!geocodingService) return suggestions;

  const geocodeOption = async (option: ActivityOption): Promise<ActivityOption> => {
    if (option.coordinates) return option;
    try {
      const query = `${option.name}, ${destination}`;
      const coords = await geocodingService.geocode(query);
      if (coords) {
        return { ...option, coordinates: coords };
      }
    } catch (error) {
      console.warn(`Failed to geocode ${option.name}:`, (error as Error).message);
    }
    return option;
  };

  const [morning, afternoon, evening] = await Promise.all([
    Promise.all((suggestions.morningActivities || []).map(geocodeOption)),
    Promise.all((suggestions.afternoonActivities || []).map(geocodeOption)),
    Promise.all((suggestions.eveningActivities || []).map(geocodeOption)),
  ]);

  return {
    ...suggestions,
    morningActivities: morning,
    afternoonActivities: afternoon,
    eveningActivities: evening,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, dayNumber, userMessage } = await request.json();

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

    if (
      session.workflowState !== WORKFLOW_STATES.SKELETON &&
      session.workflowState !== WORKFLOW_STATES.EXPAND_DAY
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Can only suggest activities from SKELETON or EXPAND_DAY state",
        },
        { status: 400 }
      );
    }

    const targetDay = dayNumber || session.currentExpandDay || 1;
    const skeletonDay = session.skeleton?.days?.find((d) => d.dayNumber === targetDay);

    if (!skeletonDay) {
      return NextResponse.json(
        { success: false, message: `Day ${targetDay} not found in skeleton` },
        { status: 400 }
      );
    }

    const llmClient = getLLMClient();
    const result = await llmClient.suggestActivities({
      tripInfo: session.tripInfo,
      skeletonDay,
      userMessage: userMessage || "",
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    // Geocode activity suggestions
    let suggestions = result.suggestions;
    try {
      if (session.tripInfo.destination) {
        suggestions = await geocodeActivitySuggestions(suggestions, session.tripInfo.destination);
      }
    } catch (geocodeError) {
      console.warn("Geocoding activity suggestions failed:", (geocodeError as Error).message);
    }

    // Store activity suggestions in session
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.EXPAND_DAY,
      currentExpandDay: targetDay,
      currentActivitySuggestions: {
        dayNumber: targetDay,
        suggestions: suggestions,
      },
    });

    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.EXPAND_DAY,
      message: result.message,
      suggestions: suggestions,
      dayNumber: targetDay,
    });
  } catch (error) {
    console.error("Error in suggestActivities:", error);
    return NextResponse.json(
      { success: false, message: "Failed to suggest activities", error: String(error) },
      { status: 500 }
    );
  }
}
