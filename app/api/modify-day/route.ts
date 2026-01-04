import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, dayNumber, userMessage } = await request.json();

    if (!sessionId || !dayNumber || !userMessage) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId, dayNumber, or userMessage" },
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

    const currentDay = session.expandedDays[dayNumber];
    if (!currentDay) {
      return NextResponse.json(
        { success: false, message: `Day ${dayNumber} has not been expanded yet` },
        { status: 400 }
      );
    }

    sessionStore.addToConversation(sessionId, "user", userMessage);

    const llmClient = getLLMClient();
    const result = await llmClient.modifyDay({
      tripInfo: session.tripInfo,
      currentDay,
      userMessage,
      conversationHistory: session.conversationHistory,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    sessionStore.setExpandedDay(sessionId, dayNumber, result.expandedDay);
    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: session.workflowState,
      message: result.message,
      expandedDay: result.expandedDay,
      allExpandedDays: session.expandedDays,
      suggestModifications: result.suggestModifications,
    });
  } catch (error) {
    console.error("Error in modifyDay:", error);
    return NextResponse.json(
      { success: false, message: "Failed to modify day", error: String(error) },
      { status: 500 }
    );
  }
}
