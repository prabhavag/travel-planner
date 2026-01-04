import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import { getTravelPlanner } from "@/lib/travel-planner";

interface Coordinates {
  lat: number;
  lng: number;
}

interface Option {
  id: string;
  name: string;
  coordinates?: Coordinates | null;
}

interface Activity {
  name: string;
  coordinates?: Coordinates;
}

interface Meal {
  name?: string;
  coordinates?: Coordinates;
}

interface ExpandedDay {
  dayNumber: number;
  date?: string;
  theme: string;
  breakfast?: Meal | null;
  lunch?: Meal | null;
  dinner?: Meal | null;
  morning?: Activity[];
  afternoon?: Activity[];
  evening?: Activity[];
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, dayNumber, selections } = await request.json();

    if (!sessionId || !selections) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId or selections" },
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

    const targetDay = dayNumber || session.currentExpandDay || 1;
    const skeletonDay = session.skeleton?.days?.find((d) => d.dayNumber === targetDay);

    if (!skeletonDay) {
      return NextResponse.json(
        { success: false, message: `Day ${targetDay} not found in skeleton` },
        { status: 400 }
      );
    }

    // Get stored suggestions (supports both old and new two-step flow)
    const storedSuggestions = session.currentSuggestions;
    const storedActivitySuggestions = session.currentActivitySuggestions;
    const storedMealSuggestions = session.currentMealSuggestions;

    // Check if we have suggestions from either flow
    const hasSuggestions = storedSuggestions?.dayNumber === targetDay ||
                           storedActivitySuggestions?.dayNumber === targetDay;

    if (!hasSuggestions) {
      return NextResponse.json(
        {
          success: false,
          message: "No suggestions found for this day. Call suggest-activities first.",
        },
        { status: 400 }
      );
    }

    // Build combined suggestions from two-step flow or use old format
    const combinedSuggestions = storedSuggestions?.suggestions || {
      dayNumber: targetDay,
      date: skeletonDay.date,
      theme: skeletonDay.theme,
      morningActivities: storedActivitySuggestions?.suggestions?.morningActivities || [],
      afternoonActivities: storedActivitySuggestions?.suggestions?.afternoonActivities || [],
      eveningActivities: storedActivitySuggestions?.suggestions?.eveningActivities || [],
      breakfast: storedMealSuggestions?.suggestions?.breakfast || [],
      lunch: storedMealSuggestions?.suggestions?.lunch || [],
      dinner: storedMealSuggestions?.suggestions?.dinner || [],
    };

    const llmClient = getLLMClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await llmClient.expandDayFromSelections({
      tripInfo: session.tripInfo,
      skeletonDay,
      selections,
      suggestions: combinedSuggestions as any, // Type differs between flows
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    // Copy coordinates from selected suggestions to expanded day
    let expandedDay: ExpandedDay = result.expandedDay;
    const suggestions = combinedSuggestions;

    // Helper to find selected option and copy coordinates
    const copyCoordinates = (
      targetItem: Meal | null | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      optionsList: any[] | undefined,
      selectedId: string | null | undefined
    ) => {
      if (!targetItem || !optionsList || !selectedId) return;
      const selected = optionsList.find((opt: Option) => opt.id === selectedId);
      if (selected?.coordinates) {
        targetItem.coordinates = selected.coordinates;
      }
    };

    // Copy meal coordinates
    copyCoordinates(expandedDay.breakfast, suggestions.breakfast, selections.breakfast);
    copyCoordinates(expandedDay.lunch, suggestions.lunch, selections.lunch);
    copyCoordinates(expandedDay.dinner, suggestions.dinner, selections.dinner);

    // Copy activity coordinates (match by name)
    const copyActivityCoordinates = (
      activities: Activity[] | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      optionsList: any[] | undefined
    ) => {
      if (!activities || !optionsList) return;
      for (const activity of activities) {
        const match = optionsList.find(
          (opt: Option) =>
            opt.name === activity.name ||
            opt.name?.toLowerCase() === activity.name?.toLowerCase()
        );
        if (match?.coordinates) {
          activity.coordinates = match.coordinates;
        }
      }
    };

    copyActivityCoordinates(expandedDay.morning, suggestions.morningActivities);
    copyActivityCoordinates(expandedDay.afternoon, suggestions.afternoonActivities);
    copyActivityCoordinates(expandedDay.evening, suggestions.eveningActivities);

    // Fallback: try geocoding any items still missing coordinates
    try {
      const planner = getTravelPlanner();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expandedDay = await planner.geocodeExpandedDay(expandedDay as any, session.tripInfo.destination!) as any;
    } catch (geocodeError) {
      console.warn(
        "Geocoding failed, continuing with existing coordinates:",
        (geocodeError as Error).message
      );
    }

    // Store expanded day
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionStore.setExpandedDay(sessionId, targetDay, expandedDay as any);

    // Calculate next day to expand
    const totalDays = session.skeleton?.days?.length || 0;
    const expandedDayNumbers = Object.keys(session.expandedDays).map(Number);
    const nextDay = targetDay < totalDays ? targetDay + 1 : null;
    const allDaysExpanded = expandedDayNumbers.length >= totalDays;

    // Update workflow state and clear suggestions
    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.EXPAND_DAY,
      currentExpandDay: nextDay || targetDay,
      currentSuggestions: null,
    });
    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.EXPAND_DAY,
      message: result.message,
      expandedDay: expandedDay,
      allExpandedDays: session.expandedDays,
      currentDay: targetDay,
      nextDayToExpand: nextDay,
      canReview: allDaysExpanded,
      suggestModifications: result.suggestModifications,
    });
  } catch (error) {
    console.error("Error in confirmDaySelections:", error);
    return NextResponse.json(
      { success: false, message: "Failed to confirm selections", error: String(error) },
      { status: 500 }
    );
  }
}
