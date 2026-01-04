import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";
import { getTravelPlanner } from "@/lib/travel-planner";

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
        { success: false, message: "Can only expand days from SKELETON or EXPAND_DAY state" },
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

    if (userMessage) {
      sessionStore.addToConversation(sessionId, "user", userMessage);
    }

    const llmClient = getLLMClient();
    const result = await llmClient.expandDay({
      tripInfo: session.tripInfo,
      skeletonDay,
      userMessage: userMessage || "",
      conversationHistory: session.conversationHistory,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    let expandedDay = result.expandedDay;
    try {
      const planner = getTravelPlanner();
      expandedDay = await planner.geocodeExpandedDay(expandedDay, session.tripInfo.destination!);
    } catch (geocodeError) {
      console.warn("Geocoding failed, continuing without coordinates:", (geocodeError as Error).message);
    }

    sessionStore.setExpandedDay(sessionId, targetDay, expandedDay);

    const totalDays = session.skeleton?.days?.length || 0;
    const expandedDayNumbers = Object.keys(session.expandedDays).map(Number);
    const nextDay = targetDay < totalDays ? targetDay + 1 : null;
    const allDaysExpanded = expandedDayNumbers.length >= totalDays;

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.EXPAND_DAY,
      currentExpandDay: nextDay || targetDay,
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
    console.error("Error in expandDay:", error);
    return NextResponse.json(
      { success: false, message: "Failed to expand day", error: String(error) },
      { status: 500 }
    );
  }
}
