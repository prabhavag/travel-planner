import { NextRequest, NextResponse } from "next/server";
import { runAgentTurn } from "@/lib/services/agent-loop";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await runAgentTurn(body);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error("Error in agentTurn:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process agent turn", error: String(error) },
      { status: 500 },
    );
  }
}
