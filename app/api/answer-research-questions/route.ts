import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";

export async function POST(request: NextRequest) {
    try {
        const { sessionId, answers } = await request.json();

        if (!sessionId || !answers) {
            return NextResponse.json(
                { success: false, message: "Missing sessionId or answers" },
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

        const llmClient = getLLMClient();
        const result = await llmClient.compressPreferences({
            currentPreferences: session.tripInfo.preferences,
            newAnswers: answers,
        });

        if (!result.success) {
            return NextResponse.json(
                { success: false, message: "Failed to process answers" },
                { status: 500 }
            );
        }

        // Update session preferences
        sessionStore.update(sessionId, {
            tripInfo: {
                ...session.tripInfo,
                preferences: result.preferences,
            },
        });

        const updatedSession = sessionStore.get(sessionId);

        return NextResponse.json({
            success: true,
            sessionId,
            tripInfo: updatedSession?.tripInfo,
            message: "Preferences updated based on your answers.",
        });
    } catch (error) {
        console.error("Error in answerResearchQuestions:", error);
        return NextResponse.json(
            { success: false, message: "Failed to submit answers", error: String(error) },
            { status: 500 }
        );
    }
}
