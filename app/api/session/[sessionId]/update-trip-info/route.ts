import { NextRequest, NextResponse } from "next/server";
import { sessionStore } from "@/lib/services/session-store";

export async function POST(
    request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        const { sessionId } = params;
        const { tripInfo } = await request.json();

        if (!sessionId || !tripInfo) {
            return NextResponse.json(
                { success: false, message: "Missing sessionId or tripInfo" },
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

        // Update the session's trip info
        sessionStore.update(sessionId, { tripInfo });

        return NextResponse.json({
            success: true,
            sessionId,
            tripInfo: sessionStore.get(sessionId)?.tripInfo,
        });
    } catch (error) {
        console.error("Error in updateTripInfo:", error);
        return NextResponse.json(
            { success: false, message: "Failed to update trip info", error: String(error) },
            { status: 500 }
        );
    }
}
