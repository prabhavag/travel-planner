"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ResearchOptionPreference, TripInfo, TripResearchBrief } from "@/lib/api-client";

interface InitialResearchViewProps {
  tripInfo: TripInfo | null;
  researchBrief: TripResearchBrief | null;
  researchOptionSelections: Record<string, ResearchOptionPreference>;
  onSelectionChange: (optionId: string, preference: ResearchOptionPreference) => void;
  onResolveDurationConflict: (mode: "use_date_range" | "keep_requested_duration") => void;
  hasUnresolvedAssumptionConflicts: boolean;
  onRegenerate: () => void;
  onProceed: () => void;
  isLoading?: boolean;
}

export function InitialResearchView({
  tripInfo,
  researchBrief,
  researchOptionSelections,
  onSelectionChange,
  onResolveDurationConflict,
  hasUnresolvedAssumptionConflicts,
  onRegenerate,
  onProceed,
  isLoading = false,
}: InitialResearchViewProps) {
  if (!researchBrief) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 text-center text-gray-600">
            Generate an initial research brief to review options before creating activities.
          </CardContent>
        </Card>
      </div>
    );
  }

  const categoryClassMap: Record<string, string> = {
    snorkeling: "bg-cyan-50 text-cyan-800 border-cyan-200",
    hiking: "bg-emerald-50 text-emerald-800 border-emerald-200",
    food: "bg-orange-50 text-orange-800 border-orange-200",
    culture: "bg-indigo-50 text-indigo-800 border-indigo-200",
    relaxation: "bg-rose-50 text-rose-800 border-rose-200",
    adventure: "bg-amber-50 text-amber-800 border-amber-200",
    other: "bg-slate-50 text-slate-800 border-slate-200",
  };

  const getDerivedDurationFromDates = (): number | null => {
    if (!tripInfo?.startDate || !tripInfo?.endDate) return null;
    const start = new Date(tripInfo.startDate);
    const end = new Date(tripInfo.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  const derivedDuration = getDerivedDurationFromDates();
  const currentDuration = tripInfo?.durationDays ?? null;
  const hasDurationConflict =
    derivedDuration != null &&
    currentDuration != null &&
    derivedDuration > 0 &&
    currentDuration > 0 &&
    derivedDuration !== currentDuration;
  const allPreferences = tripInfo?.preferences || [];
  const dietaryHints = allPreferences.filter((item) =>
    /vegetarian|vegan|no meat|no seafood|halal|kosher|gluten/i.test(item)
  );
  const [activeOptionTab, setActiveOptionTab] = useState<"best-match" | "other-popular">("best-match");

  const { bestMatchOptions, otherPopularOptions } = useMemo(() => {
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const preferenceTerms = allPreferences.map(normalize).filter(Boolean);

    const scored = researchBrief.popularOptions
      .map((option) => {
        const selection = researchOptionSelections[option.id] || "maybe";
        let score = 0;

        if (selection === "keep") score += 4;
        if (selection === "maybe") score += 1;
        if (selection === "reject") score -= 5;

        const category = normalize(option.category);
        const why = normalize(option.whyItMatches || "");

        for (const pref of preferenceTerms) {
          if (category.includes(pref) || pref.includes(category)) score += 2;
          if (why.includes(pref)) score += 1;
        }

        return { option, score };
      })
      .sort((a, b) => b.score - a.score);

    const filteredBestMatch = scored
      .filter((item) => item.score > 0)
      .map((item) => item.option);

    const fallbackBestMatch = scored
      .map((item) => item.option)
      .filter((option) => (researchOptionSelections[option.id] || "maybe") !== "reject");

    const totalOptions = researchBrief.popularOptions.length;
    const targetOtherCount =
      totalOptions >= 8 ? 4 : totalOptions >= 6 ? 3 : totalOptions >= 4 ? 2 : totalOptions > 0 ? 1 : 0;
    const maxBestMatchCount = Math.max(1, totalOptions - targetOtherCount);

    const bestMatchCandidates = (filteredBestMatch.length > 0 ? filteredBestMatch : fallbackBestMatch).filter(
      (option, idx, arr) => arr.findIndex((x) => x.id === option.id) === idx
    );

    const bestMatch = bestMatchCandidates.slice(0, maxBestMatchCount);

    const bestMatchIds = new Set(bestMatch.map((option) => option.id));

    const otherPopular = researchBrief.popularOptions.filter((option) => !bestMatchIds.has(option.id));

    return {
      bestMatchOptions: bestMatch,
      otherPopularOptions: otherPopular,
    };
  }, [allPreferences, researchBrief.popularOptions, researchOptionSelections]);

  const visibleOptions = activeOptionTab === "best-match" ? bestMatchOptions : otherPopularOptions;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between bg-white py-2 px-4">
        <div>
          <h2 className="text-lg font-semibold">Initial Research Brief</h2>
          <p className="text-sm text-gray-500">
            Refine in chat, then generate your activity list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh Research
          </Button>
          <Button onClick={onProceed} disabled={isLoading || hasUnresolvedAssumptionConflicts}>
            Generate Activities
          </Button>
        </div>
      </div>

      <Card className={hasUnresolvedAssumptionConflicts ? "border-amber-300 bg-amber-50/50" : ""}>
        <CardHeader>
          <CardTitle className="text-base">Trip Assumptions Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-700">
          <p>
            <span className="text-gray-500">Dates:</span>{" "}
            {tripInfo?.startDate && tripInfo?.endDate ? `${tripInfo.startDate} to ${tripInfo.endDate}` : "Not set"}
          </p>
          <p>
            <span className="text-gray-500">Trip length:</span>{" "}
            {currentDuration != null ? `${currentDuration} day(s)` : "Not set"}
            {derivedDuration != null ? ` (date range implies ${derivedDuration} day(s))` : ""}
          </p>
          <p>
            <span className="text-gray-500">Pace:</span> {tripInfo?.activityLevel || "Not set"}
          </p>
          <p>
            <span className="text-gray-500">Dietary constraints:</span>{" "}
            {dietaryHints.length > 0 ? dietaryHints.join(", ") : allPreferences.join(", ") || "None specified"}
          </p>

          {hasDurationConflict && (
            <div className="pt-2">
              <p className="text-amber-800 font-medium">
                Resolve duration conflict before generating activities.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onResolveDurationConflict("use_date_range")}
                  disabled={isLoading || !derivedDuration}
                >
                  Use date range ({derivedDuration} days)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onResolveDurationConflict("keep_requested_duration")}
                  disabled={isLoading || !currentDuration}
                >
                  Keep requested duration ({currentDuration} days)
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-700 whitespace-pre-wrap">
          {researchBrief.summary || "No summary generated yet."}
        </CardContent>
      </Card>

      {researchBrief.dateNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Date Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {researchBrief.dateNotes.map((note, idx) => (
              <p key={`${note}-${idx}`} className="text-sm text-gray-700">
                • {note}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={activeOptionTab === "best-match" ? "default" : "outline"}
            onClick={() => setActiveOptionTab("best-match")}
          >
            Best Match for You
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeOptionTab === "other-popular" ? "default" : "outline"}
            onClick={() => setActiveOptionTab("other-popular")}
          >
            Other Popular Options
          </Button>
          <span className="text-xs text-gray-500 ml-auto">
            Showing {visibleOptions.length} option{visibleOptions.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleOptions.map((option) => (
          <Card key={option.id} className="border-gray-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{option.title}</CardTitle>
                <Badge className={`capitalize border ${categoryClassMap[option.category] || categoryClassMap.other}`}>
                  {option.category}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Why it matches</p>
                <p className="text-sm text-gray-700">{option.whyItMatches}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Date fit</p>
                <p className="text-sm text-gray-700">{option.bestForDates}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Review summary</p>
                <p className="text-sm text-gray-700">{option.reviewSummary}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["keep", "maybe", "reject"] as const).map((choice) => {
                  const activeChoice = researchOptionSelections[option.id] || "maybe";
                  const isActive = activeChoice === choice;
                  const baseClass =
                    choice === "keep"
                      ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      : choice === "reject"
                        ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50";
                  return (
                    <Button
                      key={`${option.id}-${choice}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onSelectionChange(option.id, choice)}
                      className={`${baseClass} ${isActive ? "ring-1 ring-current" : ""}`}
                    >
                      {choice === "keep" ? "Keep" : choice === "reject" ? "Reject" : "Maybe"}
                    </Button>
                  );
                })}
              </div>
              {option.sourceLinks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Sources</p>
                  {option.sourceLinks.map((source, idx) => (
                    <a
                      key={`${option.id}-${source.url}-${idx}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1.5 hover:bg-blue-100 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-blue-800 line-clamp-1">{source.title}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                      </div>
                      {source.snippet && (
                        <p className="text-xs text-blue-700 mt-1 line-clamp-2">{source.snippet}</p>
                      )}
                    </a>
                  ))}
                </div>
              )}
              {Array.isArray(option.photoUrls) && option.photoUrls.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Thumbnails</p>
                  <div className="grid grid-cols-3 gap-2">
                    {option.photoUrls.slice(0, 3).map((url, idx) => (
                      <img
                        key={`${option.id}-photo-${idx}`}
                        src={url}
                        alt={`${option.title} thumbnail ${idx + 1}`}
                        className="h-24 w-full rounded-md border border-gray-200 object-cover"
                        loading="lazy"
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {(researchBrief.assumptions.length > 0 || researchBrief.openQuestions.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {researchBrief.assumptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assumptions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {researchBrief.assumptions.map((item, idx) => (
                  <p key={`${item}-${idx}`} className="text-sm text-gray-700">
                    • {item}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
          {researchBrief.openQuestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open Questions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {researchBrief.openQuestions.map((item, idx) => (
                  <p key={`${item}-${idx}`} className="text-sm text-gray-700">
                    • {item}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
