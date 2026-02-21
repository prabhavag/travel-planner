import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, optionId } = await request.json();

    if (!sessionId || !optionId) {
      return NextResponse.json(
        { success: false, message: "Missing sessionId or optionId" },
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
        { success: false, message: "Deep research is only available during initial research." },
        { status: 400 }
      );
    }

    const existingBrief = session.tripResearchBrief;
    if (!existingBrief) {
      return NextResponse.json(
        { success: false, message: "Research brief not found. Generate it first." },
        { status: 400 }
      );
    }

    const targetOption = existingBrief.popularOptions.find((option) => option.id === optionId);
    if (!targetOption) {
      return NextResponse.json(
        { success: false, message: "Research option not found." },
        { status: 404 }
      );
    }

    const llmClient = getLLMClient();
    const result = await llmClient.deepResearchOption({
      tripInfo: session.tripInfo,
      option: targetOption,
    });

    if (!result.success || !result.option) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 500 }
      );
    }

    const nextBrief = {
      ...existingBrief,
      popularOptions: existingBrief.popularOptions.map((option) =>
        option.id === optionId ? result.option! : option
      ),
    };

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      tripResearchBrief: nextBrief,
    });
    sessionStore.addToConversation(sessionId, "assistant", result.message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      message: result.message,
      tripResearchBrief: nextBrief,
      researchOptionSelections: session.researchOptionSelections,
      deepResearchedOptionIds: [optionId],
    });
  } catch (error) {
    console.error("Error in deep-research-option:", error);
    return NextResponse.json(
      { success: false, message: "Failed to run deep research for option", error: String(error) },
      { status: 500 }
    );
  }
}
