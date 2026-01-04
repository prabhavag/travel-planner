import { NextRequest, NextResponse } from "next/server";
import { TravelRequestSchema } from "@/lib/models/travel-plan";
import { getTravelPlanner } from "@/lib/travel-planner";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const validationResult = TravelRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, message: "Invalid input", errors: validationResult.error.errors },
        { status: 400 }
      );
    }

    const validatedRequest = validationResult.data;
    const planner = getTravelPlanner();
    const plan = await planner.generateTravelPlan(validatedRequest);

    return NextResponse.json({ success: true, plan });
  } catch (error) {
    console.error("Error in generatePlan:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate plan", error: String(error) },
      { status: 500 }
    );
  }
}
