import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";

type CardType = "research_option" | "restaurant" | "accommodation" | "flight";

function isCardType(value: unknown): value is CardType {
  return (
    value === "research_option" ||
    value === "restaurant" ||
    value === "accommodation" ||
    value === "flight"
  );
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, cardType, cardId } = await request.json();

    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return NextResponse.json({ success: false, message: "Missing or invalid sessionId" }, { status: 400 });
    }
    if (!isCardType(cardType)) {
      return NextResponse.json({ success: false, message: "Missing or invalid cardType" }, { status: 400 });
    }
    if (typeof cardId !== "string" || !cardId.trim()) {
      return NextResponse.json({ success: false, message: "Missing or invalid cardId" }, { status: 400 });
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return NextResponse.json({ success: false, message: "Session not found or expired" }, { status: 404 });
    }

    if (cardType === "research_option") {
      const currentBrief = session.tripResearchBrief;
      if (!currentBrief) {
        return NextResponse.json({ success: false, message: "Research brief not found" }, { status: 400 });
      }

      const exists = currentBrief.popularOptions.some((option) => option.id === cardId);
      if (!exists) {
        return NextResponse.json({ success: false, message: `Research option not found: ${cardId}` }, { status: 404 });
      }

      const nextSelections = { ...(session.researchOptionSelections || {}) };
      delete nextSelections[cardId];

      sessionStore.update(sessionId, {
        tripResearchBrief: {
          ...currentBrief,
          popularOptions: currentBrief.popularOptions.filter((option) => option.id !== cardId),
        },
        researchOptionSelections: nextSelections,
      });
    } else if (cardType === "restaurant") {
      const exists = session.restaurantSuggestions.some((restaurant) => restaurant.id === cardId);
      if (!exists) {
        return NextResponse.json({ success: false, message: `Restaurant not found: ${cardId}` }, { status: 404 });
      }

      sessionStore.update(sessionId, {
        restaurantSuggestions: session.restaurantSuggestions.filter((restaurant) => restaurant.id !== cardId),
        selectedRestaurantIds: session.selectedRestaurantIds.filter((id) => id !== cardId),
        groupedDays: session.groupedDays.map((day) => ({
          ...day,
          restaurants: day.restaurants.filter((restaurant) => restaurant.id !== cardId),
        })),
      });
    } else if (cardType === "accommodation") {
      const exists = session.accommodationOptions.some((option) => option.id === cardId);
      if (!exists) {
        return NextResponse.json(
          { success: false, message: `Accommodation option not found: ${cardId}` },
          { status: 404 },
        );
      }

      const removedSelected = session.selectedAccommodationOptionId === cardId;
      sessionStore.update(sessionId, {
        accommodationOptions: session.accommodationOptions.filter((option) => option.id !== cardId),
        selectedAccommodationOptionId: removedSelected ? null : session.selectedAccommodationOptionId,
        wantsAccommodation:
          removedSelected && session.wantsAccommodation === true ? null : session.wantsAccommodation,
      });
    } else {
      const exists = session.flightOptions.some((option) => option.id === cardId);
      if (!exists) {
        return NextResponse.json({ success: false, message: `Flight option not found: ${cardId}` }, { status: 404 });
      }

      const removedSelected = session.selectedFlightOptionId === cardId;
      sessionStore.update(sessionId, {
        flightOptions: session.flightOptions.filter((option) => option.id !== cardId),
        selectedFlightOptionId: removedSelected ? null : session.selectedFlightOptionId,
        wantsFlight: removedSelected && session.wantsFlight === true ? null : session.wantsFlight,
      });
    }

    const updatedSession = sessionStore.get(sessionId);
    if (!updatedSession) {
      return NextResponse.json({ success: false, message: "Session not found after update" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      sessionId: updatedSession.sessionId,
      workflowState: updatedSession.workflowState,
      message: "Card removed.",
      tripInfo: updatedSession.tripInfo,
      tripResearchBrief: updatedSession.tripResearchBrief,
      researchOptionSelections: updatedSession.researchOptionSelections,
      suggestedActivities: updatedSession.suggestedActivities,
      selectedActivityIds: updatedSession.selectedActivityIds,
      dayGroups: updatedSession.dayGroups,
      groupedDays: updatedSession.groupedDays,
      restaurantSuggestions: updatedSession.restaurantSuggestions,
      selectedRestaurantIds: updatedSession.selectedRestaurantIds,
      wantsRestaurants: updatedSession.wantsRestaurants,
      accommodationStatus: updatedSession.accommodationStatus,
      flightStatus: updatedSession.flightStatus,
      accommodationError: updatedSession.accommodationError,
      flightError: updatedSession.flightError,
      accommodationOptions: updatedSession.accommodationOptions,
      flightOptions: updatedSession.flightOptions,
      selectedAccommodationOptionId: updatedSession.selectedAccommodationOptionId,
      selectedFlightOptionId: updatedSession.selectedFlightOptionId,
      wantsAccommodation: updatedSession.wantsAccommodation,
      wantsFlight: updatedSession.wantsFlight,
      accommodationLastSearchedAt: updatedSession.accommodationLastSearchedAt,
      flightLastSearchedAt: updatedSession.flightLastSearchedAt,
    });
  } catch (error) {
    console.error("Error in remove-card:", error);
    return NextResponse.json(
      { success: false, message: "Failed to remove card", error: String(error) },
      { status: 500 },
    );
  }
}
