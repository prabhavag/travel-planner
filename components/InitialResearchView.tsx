"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Send } from "lucide-react";
import type { ResearchOption, ResearchOptionPreference, TripInfo, TripResearchBrief } from "@/lib/api-client";

interface InitialResearchViewProps {
  tripInfo: TripInfo | null;
  researchBrief: TripResearchBrief | null;
  researchOptionSelections: Record<string, ResearchOptionPreference>;
  onSelectionChange: (optionId: string, preference: ResearchOptionPreference) => void;
  onResolveDurationConflict: (mode: "use_date_range" | "keep_requested_duration") => void;
  hasUnresolvedAssumptionConflicts: boolean;
  onRegenerate: () => void;
  onProceed: () => void;
  onAnswerQuestions: (answers: Record<string, string>) => void;
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
  onAnswerQuestions,
  isLoading = false,
}: InitialResearchViewProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

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
    Math.abs(derivedDuration - currentDuration) > 1;
  const allPreferences = tripInfo?.preferences || [];
  const dietaryHints = allPreferences.filter((item) =>
    /vegetarian|vegan|no meat|no seafood|halal|kosher|gluten/i.test(item)
  );
  const [activeOptionTab, setActiveOptionTab] = useState<string>("All");
  const [hasInitializedTab, setHasInitializedTab] = useState(false);

  const groupedOptions = useMemo(() => {
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const preferenceGroups: Record<string, ResearchOption[]> = {
      All: researchBrief.popularOptions,
    };

    // Initialize groups for each preference
    allPreferences.forEach((pref) => {
      const normalizedPref = normalize(pref);
      if (normalizedPref) {
        preferenceGroups[pref] = [];
      }
    });

    const otherOptions: ResearchOption[] = [];

    researchBrief.popularOptions.forEach((option) => {
      const category = normalize(option.category);
      const why = normalize(option.whyItMatches || "");
      let matchedAny = false;

      allPreferences.forEach((pref) => {
        const normalizedPref = normalize(pref);
        if (
          normalizedPref &&
          (category.includes(normalizedPref) ||
            normalizedPref.includes(category) ||
            why.includes(normalizedPref))
        ) {
          preferenceGroups[pref].push(option);
          matchedAny = true;
        }
      });

      if (!matchedAny) {
        otherOptions.push(option);
      }
    });

    if (otherOptions.length > 0) {
      preferenceGroups["Other"] = otherOptions;
    }

    return preferenceGroups;
  }, [allPreferences, researchBrief.popularOptions]);

  const tabs = useMemo(() => {
    return Object.keys(groupedOptions).filter((tab) => groupedOptions[tab].length > 0);
  }, [groupedOptions]);

  // Set initial active tab if not already set or if current tab is empty
  useMemo(() => {
    if ((!hasInitializedTab || !groupedOptions[activeOptionTab] || groupedOptions[activeOptionTab].length === 0) && tabs.length > 0) {
      const initialTab = tabs.includes("All") ? "All" : tabs[0];
      setActiveOptionTab(initialTab);
      setHasInitializedTab(true);
    }
  }, [tabs, activeOptionTab, groupedOptions, hasInitializedTab]);

  const visibleOptions = groupedOptions[activeOptionTab] || [];

  const handleAnswerChange = (question: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [question]: value }));
  };

  const handleSubmitAnswers = () => {
    onAnswerQuestions(answers);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between bg-white py-2 px-4">
        <div>
          <h2 className="text-lg font-semibold">Let's plan your places together</h2>
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
                <CardTitle className="text-base">Let’s Clarify These</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {researchBrief.openQuestions.map((question, idx) => (
                  <div key={`${question}-${idx}`} className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">{question}</p>
                    <div className="flex gap-2">
                      <textarea
                        className="flex-1 rounded-md border border-gray-200 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        rows={2}
                        placeholder="Type your answer here..."
                        value={answers[question] || ""}
                        onChange={(e) => handleAnswerChange(question, e.target.value)}
                        disabled={isLoading}
                      />
                      <Button
                        size="icon"
                        className="h-[52px] w-[52px] shrink-0"
                        onClick={() => {
                          const answer = answers[question];
                          if (answer?.trim()) {
                            onAnswerQuestions({ [question]: answer.trim() });
                            // Optionally clear local answer, though the parent should ideally filter the question out
                            setAnswers(prev => {
                              const newAns = { ...prev };
                              delete newAns[question];
                              return newAns;
                            });
                          }
                        }}
                        disabled={isLoading || !answers[question]?.trim()}
                      >
                        <Send className="h-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-gray-900">Suggestions for you</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Select <strong>Keep</strong> for places you love, <strong>Maybe</strong> for those you're considering,
            or <strong>Reject</strong> for ones that don't fit. Your choices help refine our AI's understanding
            to create a better personalized itinerary.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {tabs.map((tab) => (
              <Button
                key={tab}
                type="button"
                size="sm"
                variant={activeOptionTab === tab ? "default" : "outline"}
                onClick={() => setActiveOptionTab(tab)}
                className="whitespace-nowrap"
              >
                {tab === "All" ? "All Recommendations" : tab}
              </Button>
            ))}
            <span className="text-xs text-gray-500 ml-auto flex-shrink-0">
              Showing {visibleOptions.length} option{visibleOptions.length === 1 ? "" : "s"}
            </span>
          </div>
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
                  {option.sourceLinks.map((source: any, idx: number) => (
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
                    {option.photoUrls.slice(0, 3).map((url: string, idx: number) => (
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

    </div>
  );
}
