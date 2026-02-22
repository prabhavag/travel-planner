import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";
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

    const brief = session.tripResearchBrief;
    if (!brief) {
      return NextResponse.json(
        { success: false, message: "Research brief not found." },
        { status: 400 }
      );
    }

    const needsEnrichment = brief.popularOptions.some(
      (option) =>
        !option.photoUrls ||
        option.photoUrls.length === 0 ||
        !option.coordinates ||
        typeof option.coordinates.lat !== "number" ||
        typeof option.coordinates.lng !== "number"
    );
    if (!needsEnrichment) {
      return NextResponse.json({
        success: true,
        sessionId,
        workflowState: session.workflowState,
        message: "Research locations already enriched.",
        tripResearchBrief: brief,
      });
    }

    const llmClient = getLLMClient();
    const result = await llmClient.enrichResearchBriefPhotos({
      tripInfo: session.tripInfo,
      brief,
    });

    if (!result.success || !result.tripResearchBrief) {
      return NextResponse.json(
        { success: false, message: "Failed to enrich research photos." },
        { status: 500 }
      );
    }

    sessionStore.update(sessionId, {
      tripResearchBrief: result.tripResearchBrief,
    });

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: session.workflowState,
      message: "Research photos and locations updated.",
      tripResearchBrief: result.tripResearchBrief,
      researchOptionSelections: session.researchOptionSelections,
    });
  } catch (error) {
    console.error("Error in enrich-research-photos:", error);
    return NextResponse.json(
      { success: false, message: "Failed to enrich research photos", error: String(error) },
      { status: 500 }
    );
  }
}
