import { NextRequest, NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

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
        { success: false, message: "Deep research is only available during initial research." },
        { status: 400 }
      );
    }

    const brief = session.tripResearchBrief;
    if (!brief) {
      return NextResponse.json(
        { success: false, message: "Research brief not found. Generate it first." },
        { status: 400 }
      );
    }

    const selectedOptionIds = brief.popularOptions
      .filter((option) => {
        const pref = session.researchOptionSelections?.[option.id] ?? "maybe";
        return pref === "keep" || pref === "maybe";
      })
      .map((option) => option.id);

    if (selectedOptionIds.length === 0) {
      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
        message: "No selected or postponed cards to deep-research.",
        tripResearchBrief: brief,
        researchOptionSelections: session.researchOptionSelections,
        deepResearchedOptionIds: [],
      });
    }

    const byId = new Map(brief.popularOptions.map((option) => [option.id, option]));
    const llmClient = getLLMClient();
    const deepResearchedOptionIds: string[] = [];

    for (const optionId of selectedOptionIds) {
      const option = byId.get(optionId);
      if (!option) continue;
      const result = await llmClient.deepResearchOption({
        tripInfo: session.tripInfo,
        option,
      });
      if (!result.success || !result.option) continue;
      byId.set(optionId, result.option);
      deepResearchedOptionIds.push(optionId);
    }

    const nextBrief = {
      ...brief,
      popularOptions: brief.popularOptions.map((option) => byId.get(option.id) || option),
    };

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      tripResearchBrief: nextBrief,
    });

    const message = `Deep research updated ${deepResearchedOptionIds.length} card(s). Rejected cards were skipped.`;
    sessionStore.addToConversation(sessionId, "assistant", message);

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.INITIAL_RESEARCH,
      message,
      tripResearchBrief: nextBrief,
      researchOptionSelections: session.researchOptionSelections,
      deepResearchedOptionIds,
    });
  } catch (error) {
    console.error("Error in deep-research-selected:", error);
    return NextResponse.json(
      { success: false, message: "Failed to run deep research for selected cards", error: String(error) },
      { status: 500 }
    );
  }
}
