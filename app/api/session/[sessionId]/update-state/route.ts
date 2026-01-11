import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const { workflowState } = await request.json();

        if (!sessionId || !workflowState) {
            return NextResponse.json(
                { success: false, message: "Missing sessionId or workflowState" },
                { status: 400 }
            );
        }

        const session = sessionStore.get(sessionId);
        if (!session) {
            return NextResponse.json(
                { success: false, message: "Session not found" },
                { status: 404 }
            );
        }

        sessionStore.update(sessionId, { workflowState });

        return NextResponse.json({
            success: true,
            workflowState: session.workflowState,
        });
    } catch (error) {
        console.error("Error in updateWorkflowState:", error);
        return NextResponse.json(
            { success: false, message: "Failed to update state", error: String(error) },
            { status: 500 }
        );
    }
}
