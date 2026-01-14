import { NextRequest, NextResponse } from "next/server";
import { sessionStore, Session, WorkflowState } from "@/lib/services/session-store";

export type RouteHandlerContext = {
    sessionId: string;
    session: Session;
    body: any;
};

export type RouteHandler = (
    request: NextRequest,
    context: RouteHandlerContext
) => Promise<Response>;

interface WithSessionOptions {
    allowedStates?: string[];
    validateBody?: (body: any) => string | null; // Returns error message if invalid
}

/**
 * Higher-order function to handle shared API route logic:
 * - Session validation
 * - Workflow state validation
 * - Standardized error handling
 * - Request body parsing
 */
export function withSession(
    handler: RouteHandler,
    options: WithSessionOptions = {}
) {
    return async (request: NextRequest) => {
        try {
            // 1. Parse Request Body
            let body: any = {};
            if (request.method !== "GET" && request.method !== "HEAD") {
                try {
                    body = await request.json();
                } catch {
                    return NextResponse.json(
                        { success: false, message: "Invalid request body" },
                        { status: 400 }
                    );
                }
            }

            const sessionId = body.sessionId || request.nextUrl.searchParams.get("sessionId");

            // 2. Validate sessionId
            if (!sessionId) {
                return NextResponse.json(
                    { success: false, message: "Missing sessionId" },
                    { status: 400 }
                );
            }

            // 3. Retrieve Session
            const session = sessionStore.get(sessionId);
            if (!session) {
                return NextResponse.json(
                    { success: false, message: "Session not found or expired" },
                    { status: 404 }
                );
            }

            // 4. Validate Workflow State (Optional)
            if (options.allowedStates && !options.allowedStates.includes(session.workflowState as string)) {
                return NextResponse.json(
                    {
                        success: false,
                        message: `Invalid workflow state: ${session.workflowState}. Allowed: ${options.allowedStates.join(", ")}`,
                    },
                    { status: 400 }
                );
            }

            // 5. Custom Body Validation (Optional)
            if (options.validateBody) {
                const error = options.validateBody(body);
                if (error) {
                    return NextResponse.json(
                        { success: false, message: error },
                        { status: 400 }
                    );
                }
            }

            // 6. Execute Handler
            return await handler(request, { sessionId, session, body });
        } catch (error) {
            console.error("API Route Error:", error);
            return NextResponse.json(
                {
                    success: false,
                    message: error instanceof Error ? error.message : "Internal server error",
                    error: String(error),
                },
                { status: 500 }
            );
        }
    };
}
