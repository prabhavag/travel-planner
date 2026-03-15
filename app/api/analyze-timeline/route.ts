import { NextResponse } from "next/server";
import { analyzeTimelineVisits } from "@/lib/services/timeline-analysis";
import type { TimelineVisit } from "@/lib/timeline";

function isTimelineVisit(value: unknown): value is TimelineVisit {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.lat === "number" &&
    typeof candidate.lng === "number"
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const visits = Array.isArray(body?.visits) ? body.visits.filter(isTimelineVisit) : [];

    if (visits.length === 0) {
      return NextResponse.json(
        { error: "A non-empty visits array is required." },
        { status: 400 }
      );
    }

    const result = await analyzeTimelineVisits(visits);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Timeline analysis error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
