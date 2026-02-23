import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

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

    return NextResponse.json({
      success: true,
      sessionId: session.sessionId,
      workflowState: session.workflowState,
      activeLoop: session.activeLoop,
      lastTurnId: session.lastTurnId,
      lastLoopResult: session.lastLoopResult,
      recoveryHints: session.recoveryHints,
      tripInfo: session.tripInfo,
      tripResearchBrief: session.tripResearchBrief,
      researchOptionSelections: session.researchOptionSelections,
      suggestedActivities: session.suggestedActivities,
      selectedActivityIds: session.selectedActivityIds,
      dayGroups: session.dayGroups,
      groupedDays: session.groupedDays,
      restaurantSuggestions: session.restaurantSuggestions,
      selectedRestaurantIds: session.selectedRestaurantIds,
      wantsRestaurants: session.wantsRestaurants,
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
      finalPlan: session.finalPlan,
      conversationHistory: session.conversationHistory,
    });
  } catch (error) {
    console.error("Error in getSession:", error);
    return NextResponse.json(
      { success: false, message: "Failed to get session", error: String(error) },
      { status: 500 }
    );
  }
}
