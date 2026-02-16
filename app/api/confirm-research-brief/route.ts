import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import type { ResearchOptionPreference } from "@/lib/models/travel-plan";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, researchOptionSelections } = await request.json();

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

    if (session.workflowState !== WORKFLOW_STATES.INITIAL_RESEARCH) {
      return NextResponse.json(
        {
          success: false,
          message: "Can only confirm research brief from INITIAL_RESEARCH state",
        },
        { status: 400 }
      );
    }

    const allowedPreferences: ResearchOptionPreference[] = ["keep", "maybe", "reject"];
    const parsedSelections: Record<string, ResearchOptionPreference> = {};
    if (researchOptionSelections && typeof researchOptionSelections === "object") {
      for (const [key, value] of Object.entries(researchOptionSelections as Record<string, unknown>)) {
        if (typeof key !== "string" || !key.trim()) continue;
        if (typeof value === "string" && allowedPreferences.includes(value as ResearchOptionPreference)) {
          parsedSelections[key] = value as ResearchOptionPreference;
        }
      }
    }

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.SUGGEST_ACTIVITIES,
      researchOptionSelections: parsedSelections,
    });
    const message = "Great. I will now generate top activities based on this research brief.";
    sessionStore.addToConversation(sessionId, "assistant", message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.SUGGEST_ACTIVITIES,
      message,
      tripResearchBrief: session.tripResearchBrief,
      researchOptionSelections: parsedSelections,
    });
  } catch (error) {
    console.error("Error in confirmResearchBrief:", error);
    return NextResponse.json(
      { success: false, message: "Failed to confirm research brief", error: String(error) },
      { status: 500 }
    );
  }
}
