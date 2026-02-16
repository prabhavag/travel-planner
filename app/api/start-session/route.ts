import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";

function getSessionWelcomeMessage(): string {
  return "Hello! I'm your AI travel assistant. Let's plan your perfect trip together.\n\nTo get started, could you tell me:\n1. Where would you like to go?\n2. When are you planning to travel? (dates)\n\nAfter that, I'll create an initial research brief with date-aware options and sources before generating activities.\n\nFeel free to share preferences like interests, activity level, dietary needs, or budget.";
}

export async function POST() {
  try {
    const session = sessionStore.create();
    const welcomeMessage = getSessionWelcomeMessage();

    sessionStore.addToConversation(session.sessionId, "assistant", welcomeMessage);

    return NextResponse.json({
      success: true,
      sessionId: session.sessionId,
      workflowState: session.workflowState,
      message: welcomeMessage,
    });
  } catch (error) {
    console.error("Error in startSession:", error);
    return NextResponse.json(
      { success: false, message: "Failed to start session", error: String(error) },
      { status: 500 }
    );
  }
}
