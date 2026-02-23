import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";
import { isWorkflowState, validateWorkflowTransition, type TransitionOwner } from "@/lib/services/workflow-transition";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const { workflowState, transitionOwner } = await request.json();

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

        if (!isWorkflowState(workflowState)) {
            return NextResponse.json(
                { success: false, message: `Invalid workflow state: ${workflowState}` },
                { status: 400 }
            );
        }

        const owner: TransitionOwner = transitionOwner === "SUPERVISOR" ? "SUPERVISOR" : "UI";
        const transitionCheck = validateWorkflowTransition({
            from: session.workflowState,
            to: workflowState,
            owner,
        });
        if (!transitionCheck.ok) {
            return NextResponse.json(
                { success: false, message: transitionCheck.reason },
                { status: 400 }
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
