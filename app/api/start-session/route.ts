import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";
import { getSessionWelcomeMessage } from "@/lib/services/prompts";

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
