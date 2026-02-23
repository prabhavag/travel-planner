import type { Session } from "@/lib/services/session-store";
import { getLLMClient } from "@/lib/services/llm-client";

export async function runAccommodationSearch({
  session,
}: {
  session: Pick<Session, "tripInfo" | "suggestedActivities" | "selectedActivityIds">;
}) {
  const llmClient = getLLMClient();
  const selectedActivities = (session.suggestedActivities || []).filter((activity) =>
    (session.selectedActivityIds || []).includes(activity.id),
  );
  return llmClient.searchAccommodationOffers({
    tripInfo: session.tripInfo,
    selectedActivities,
  });
}

export async function runFlightSearch({
  session,
}: {
  session: Pick<Session, "tripInfo" | "suggestedActivities" | "selectedActivityIds">;
}) {
  const llmClient = getLLMClient();
  const selectedActivities = (session.suggestedActivities || []).filter((activity) =>
    (session.selectedActivityIds || []).includes(activity.id),
  );
  return llmClient.searchFlightOffers({
    tripInfo: session.tripInfo,
    selectedActivities,
  });
}

