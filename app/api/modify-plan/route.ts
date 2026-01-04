import { NextRequest, NextResponse } from "next/server";
import { getTravelPlanner } from "@/lib/travel-planner";

export async function POST(request: NextRequest) {
  try {
    const { current_plan, user_message, conversation_history, finalize } = await request.json();

    // Allow empty user_message when finalizing
    if (!current_plan || (!user_message && !finalize)) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    const planner = getTravelPlanner();
    const result = await planner.modifyTravelPlan({
      current_plan,
      user_message: user_message || "",
      conversation_history: conversation_history || [],
      finalize: finalize || false,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in modifyPlan:", error);
    return NextResponse.json(
      { success: false, message: "Failed to modify plan", error: String(error) },
      { status: 500 }
    );
  }
}
