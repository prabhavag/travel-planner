import { NextRequest, NextResponse } from "next/server";
import { runAgentTurn } from "@/lib/services/agent-loop";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, message } = await request.json();
    if (!sessionId || !message) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId or message" },
        { status: 400 },
      );
    }

    const delegated = await runAgentTurn({
      sessionId,
      trigger: "user_message",
      message,
    });
    return NextResponse.json(delegated, { status: delegated.success ? 200 : 400 });
  } catch (error) {
    console.error("Error in chat:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process message", error: String(error) },
      { status: 500 },
    );
  }
}
