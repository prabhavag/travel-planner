import type {
  ResearchOption,
  ResearchOptionPreference,
  SuggestedActivity,
  TripResearchBrief,
} from "@/lib/models/travel-plan";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function researchKey(option: Pick<ResearchOption, "title" | "category">): string {
  return `${normalize(option.title)}|${normalize(option.category)}`;
}

function activityKey(activity: Pick<SuggestedActivity, "name" | "type">): string {
  return `${normalize(activity.name)}|${normalize(activity.type)}`;
}

function mergeResearchOption(existing: ResearchOption, incoming: ResearchOption): ResearchOption {
  const sourceLinksByUrl = new Map(
    (existing.sourceLinks || []).map((source) => [source.url.toLowerCase(), source])
  );
  for (const source of incoming.sourceLinks || []) {
    const key = source.url.toLowerCase();
    if (!sourceLinksByUrl.has(key)) {
      sourceLinksByUrl.set(key, source);
    }
  }

  const photoUrls = Array.from(
    new Set([...(existing.photoUrls || []), ...(incoming.photoUrls || [])].filter(Boolean))
  ).slice(0, 3);

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    sourceLinks: Array.from(sourceLinksByUrl.values()).slice(0, 3),
    photoUrls,
  };
}

export function mergeResearchBriefAndSelections({
  currentBrief,
  currentSelections,
  incomingBrief,
}: {
  currentBrief: TripResearchBrief | null;
  currentSelections: Record<string, ResearchOptionPreference>;
  incomingBrief: TripResearchBrief;
}): {
  tripResearchBrief: TripResearchBrief;
  researchOptionSelections: Record<string, ResearchOptionPreference>;
} {
  const existingOptions = currentBrief?.popularOptions || [];
  const mergedOptions = [...existingOptions];
  const idToIndex = new Map(mergedOptions.map((option, index) => [option.id, index]));
  const keyToIndex = new Map(mergedOptions.map((option, index) => [researchKey(option), index]));
  const keyToPreference = new Map<string, ResearchOptionPreference>();

  for (const option of existingOptions) {
    const selection = currentSelections[option.id];
    if (selection) {
      keyToPreference.set(researchKey(option), selection);
    }
  }

  for (const incoming of incomingBrief.popularOptions || []) {
    const sameId = idToIndex.get(incoming.id);
    const key = researchKey(incoming);
    const sameKey = keyToIndex.get(key);

    if (sameId !== undefined) {
      mergedOptions[sameId] = mergeResearchOption(mergedOptions[sameId], incoming);
      continue;
    }

    if (sameKey !== undefined) {
      mergedOptions[sameKey] = mergeResearchOption(mergedOptions[sameKey], incoming);
      idToIndex.set(incoming.id, sameKey);
      continue;
    }

    mergedOptions.push(incoming);
    const newIndex = mergedOptions.length - 1;
    idToIndex.set(incoming.id, newIndex);
    keyToIndex.set(key, newIndex);
  }

  const mergedSelections: Record<string, ResearchOptionPreference> = {};
  for (const option of mergedOptions) {
    const byId = currentSelections[option.id];
    const byKey = keyToPreference.get(researchKey(option));
    mergedSelections[option.id] = byId || byKey || "maybe";
  }

  return {
    tripResearchBrief: {
      ...incomingBrief,
      popularOptions: mergedOptions,
    },
    researchOptionSelections: mergedSelections,
  };
}

function mergeActivity(existing: SuggestedActivity, incoming: SuggestedActivity): SuggestedActivity {
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    interestTags: incoming.interestTags?.length ? incoming.interestTags : existing.interestTags,
    photo_urls:
      incoming.photo_urls && incoming.photo_urls.length > 0
        ? incoming.photo_urls
        : existing.photo_urls,
    photo_url: incoming.photo_url || existing.photo_url,
  };
}

export function mergeSuggestedActivities({
  existingActivities,
  incomingActivities,
}: {
  existingActivities: SuggestedActivity[];
  incomingActivities: SuggestedActivity[];
}): SuggestedActivity[] {
  const merged = [...existingActivities];
  const idToIndex = new Map(merged.map((activity, index) => [activity.id, index]));
  const keyToIndex = new Map(merged.map((activity, index) => [activityKey(activity), index]));

  for (const incoming of incomingActivities) {
    const sameId = idToIndex.get(incoming.id);
    const key = activityKey(incoming);
    const sameKey = keyToIndex.get(key);

    if (sameId !== undefined) {
      merged[sameId] = mergeActivity(merged[sameId], incoming);
      continue;
    }

    if (sameKey !== undefined) {
      merged[sameKey] = mergeActivity(merged[sameKey], incoming);
      idToIndex.set(incoming.id, sameKey);
      continue;
    }

    merged.push(incoming);
    const newIndex = merged.length - 1;
    idToIndex.set(incoming.id, newIndex);
    keyToIndex.set(key, newIndex);
  }

  return merged;
}
