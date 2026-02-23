import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

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
    // For the new activity-first flow, the data is already enriched
    // Just transition to FINALIZE state
    const message = `Your itinerary for ${session.tripInfo.destination} is finalized! You have ${session.groupedDays.length} days planned with ${session.groupedDays.reduce((sum, d) => sum + d.activities.length, 0)} activities${session.groupedDays.reduce((sum, d) => sum + d.restaurants.length, 0) > 0 ? ` and ${session.groupedDays.reduce((sum, d) => sum + d.restaurants.length, 0)} restaurants` : ""}. Have a great trip!`;

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.FINALIZE,
    });
    sessionStore.addToConversation(sessionId, "assistant", message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.FINALIZE,
      message,
      groupedDays: session.groupedDays,
      tripInfo: session.tripInfo,
      accommodationStatus: session.accommodationStatus,
      flightStatus: session.flightStatus,
      accommodationError: session.accommodationError,
      flightError: session.flightError,
      accommodationOptions: session.accommodationOptions,
      flightOptions: session.flightOptions,
      selectedAccommodationOptionId: session.selectedAccommodationOptionId,
      selectedFlightOptionId: session.selectedFlightOptionId,
      wantsAccommodation: session.wantsAccommodation,
      wantsFlight: session.wantsFlight,
      accommodationLastSearchedAt: session.accommodationLastSearchedAt,
      flightLastSearchedAt: session.flightLastSearchedAt,
    });
  } catch (error) {
    console.error("Error in finalize:", error);
    return NextResponse.json(
      { success: false, message: "Failed to finalize itinerary", error: String(error) },
      { status: 500 }
    );
  }
}
