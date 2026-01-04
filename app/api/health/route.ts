import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", message: "Travel Planner API is running" });
}
