import { describe, expect, it } from "vitest";
import type { SuggestedActivity } from "@/lib/api-client";
import { hasHardFixedStart } from "@/lib/utils/timeline-utils";

const activity = (overrides: Partial<SuggestedActivity>): SuggestedActivity =>
  ({
    id: "a1",
    name: "Test activity",
    type: "nature",
    interestTags: [],
    description: "",
    estimatedDuration: "1 hour",
    isDurationFlexible: true,
    estimatedCost: null,
    currency: "USD",
    difficultyLevel: "easy",
    bestTimeOfDay: "any",
    daylightPreference: "flexible",
    isFixedStartTime: false,
    fixedStartTime: null,
    recommendedStartWindow: null,
    timeReason: null,
    timeSourceLinks: [],
    neighborhood: null,
    locationMode: "point",
    routeWaypoints: [],
    routePoints: [],
    startCoordinates: null,
    endCoordinates: null,
    coordinates: null,
    photo_url: null,
    photo_urls: [],
    ...overrides,
  }) as SuggestedActivity;

describe("hasHardFixedStart", () => {
  it("treats sunrise as a hard fixed start when flagged fixed", () => {
    expect(
      hasHardFixedStart(
        activity({
          isFixedStartTime: true,
          fixedStartTime: "sunrise",
        })
      )
    ).toBe(true);
  });

  it("treats sunset as a hard fixed start when flagged fixed", () => {
    expect(
      hasHardFixedStart(
        activity({
          isFixedStartTime: true,
          fixedStartTime: "sunset",
        })
      )
    ).toBe(true);
  });

  it("returns false when fixed-start flag is off", () => {
    expect(
      hasHardFixedStart(
        activity({
          isFixedStartTime: false,
          fixedStartTime: "6:00 AM",
        })
      )
    ).toBe(false);
  });
});
