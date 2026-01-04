import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    googleMapsApiKey: process.env.GOOGLE_PLACES_API_KEY || "",
  });
}
