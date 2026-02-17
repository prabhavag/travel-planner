"use client";

import { useMemo, useState, useRef, useLayoutEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, ExternalLink, RefreshCw, Send } from "lucide-react";
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

  // Preserve scroll position when switching interest chips to prevent layout-shift scroll jumps
  const scrollYRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (scrollYRef.current !== null) {
      window.scrollTo(0, scrollYRef.current);
      scrollYRef.current = null;
    }
  });

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
  const nonDietaryInterests = allPreferences.filter((item) => !dietaryHints.includes(item));
  const [activeStatus, setActiveStatus] = useState<string>("Inbox");
  const [activeInterest, setActiveInterest] = useState<string>("All");
  const [hasInitializedTab, setHasInitializedTab] = useState(false);

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const matchesStatus = (option: ResearchOption, status: string) => {
    const selection = researchOptionSelections[option.id];
    if (status === "Inbox") return !selection;
    if (status === "Selected") return selection === "keep";
    if (status === "Postponed") return selection === "maybe";
    if (status === "Rejected") return selection === "reject";
    return true; // "All" or unknown
  };

  const matchesInterest = (option: ResearchOption, interest: string) => {
    if (interest === "All" || interest === "Other") return true; // Other is special
    const normalizedPref = normalize(interest);
    const category = normalize(option.category);
    const why = normalize(option.whyItMatches || "");
    return (
      category.includes(normalizedPref) ||
      normalizedPref.includes(category) ||
      why.includes(normalizedPref)
    );
  };



  const interestTabsList = useMemo(() => {
    // Show all interest tabs that exist in the entire research brief
    const tabs = new Set<string>(["All"]);
    researchBrief.popularOptions.forEach((option) => {
      allPreferences.forEach((pref) => {
        if (matchesInterest(option, pref)) {
          tabs.add(pref);
        }
      });
    });

    const hasOther = researchBrief.popularOptions.some((option) => {
      return !allPreferences.some((pref) => matchesInterest(option, pref));
    });

    if (hasOther) tabs.add("Other");
    return Array.from(tabs);
  }, [allPreferences, researchBrief.popularOptions]);

  const interestCounts = useMemo(() => {
    const counts: Record<string, number> = { All: researchBrief.popularOptions.length };
    interestTabsList.forEach((tab) => {
      if (tab === "All") return;
      counts[tab] = researchBrief.popularOptions.filter((opt) => {
        if (tab === "Other") {
          return !allPreferences.some((pref) => matchesInterest(opt, pref));
        }
        return matchesInterest(opt, tab);
      }).length;
    });
    return counts;
  }, [interestTabsList, researchBrief.popularOptions, allPreferences]);

  const statusCounts = useMemo(() => {
    // Counts reflect the currently selected interest
    const counts = { Inbox: 0, Selected: 0, Postponed: 0, Rejected: 0 };
    researchBrief.popularOptions.forEach((opt) => {
      // Filter by interest first
      if (activeInterest !== "All") {
        if (activeInterest === "Other") {
          if (allPreferences.some((pref) => matchesInterest(opt, pref))) return;
        } else if (!matchesInterest(opt, activeInterest)) {
          return;
        }
      }

      if (!researchOptionSelections[opt.id]) counts.Inbox++;
      else if (researchOptionSelections[opt.id] === "keep") counts.Selected++;
      else if (researchOptionSelections[opt.id] === "maybe") counts.Postponed++;
      else if (researchOptionSelections[opt.id] === "reject") counts.Rejected++;
    });
    return counts;
  }, [researchBrief.popularOptions, researchOptionSelections, activeInterest, allPreferences]);

  const visibleOptions = useMemo(() => {
    return researchBrief.popularOptions.filter((option) => {
      if (!matchesStatus(option, activeStatus)) return false;
      if (activeInterest === "All") return true;
      if (activeInterest === "Other") {
        return !allPreferences.some((pref) => matchesInterest(option, pref));
      }
      return matchesInterest(option, activeInterest);
    });
  }, [activeStatus, activeInterest, researchBrief.popularOptions, researchOptionSelections, allPreferences]);

  // Set initial active tab if not already set or if current tab is empty
  useMemo(() => {
    if (!hasInitializedTab && researchBrief.popularOptions.length > 0) {
      setHasInitializedTab(true);
    }
  }, [researchBrief.popularOptions, hasInitializedTab]);

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
            Review and refine your selections, then proceed to organize your trip by day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh Research
          </Button>
          <Button size="sm" onClick={onProceed} disabled={isLoading || hasUnresolvedAssumptionConflicts}>
            Proceed to organizing your trip
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      <Card className={hasUnresolvedAssumptionConflicts ? "border-amber-300 bg-amber-50/50" : ""}>
        <CardHeader>
          <CardTitle className="text-base">Trip Overview</CardTitle>
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

      {(researchBrief.summary || researchBrief.assumptions.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Research Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {researchBrief.summary && (
              <p className="text-sm text-gray-700 leading-relaxed">
                {researchBrief.summary}
              </p>
            )}
            {researchBrief.assumptions.length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-medium text-gray-500 mb-1.5">What we considered</p>
                <ul className="space-y-1">
                  {researchBrief.assumptions.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="text-sm text-gray-600 flex gap-1.5">
                      <span className="text-gray-400 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {researchBrief.openQuestions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Let's Clarify These</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[240px] overflow-y-auto space-y-4 pr-1">
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
                          setAnswers(prev => {
                            const newAns = { ...prev };
                            delete newAns[question];
                            return newAns;
                          });
                        }
                      }}
                      disabled={isLoading || !answers[question]?.trim()}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
        <div className="flex flex-wrap gap-4 pt-2">
          <button
            onClick={() => setActiveStatus("Selected")}
            disabled={statusCounts.Selected === 0}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${activeStatus === "Selected"
              ? "bg-emerald-50 border-emerald-500 text-emerald-800"
              : statusCounts.Selected > 0
                ? "bg-emerald-50/30 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                : "bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed"
              }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Selected {activeInterest !== "All" ? activeInterest : ""}: {statusCounts.Selected}
          </button>
          <button
            onClick={() => setActiveStatus("Postponed")}
            disabled={statusCounts.Postponed === 0}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${activeStatus === "Postponed"
              ? "bg-amber-50 border-amber-500 text-amber-800"
              : statusCounts.Postponed > 0
                ? "bg-amber-50/30 border-amber-200 text-amber-700 hover:bg-amber-100"
                : "bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed"
              }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Postponed {activeInterest !== "All" ? activeInterest : ""}: {statusCounts.Postponed}
          </button>
          <button
            onClick={() => setActiveStatus("Rejected")}
            disabled={statusCounts.Rejected === 0}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${activeStatus === "Rejected"
              ? "bg-rose-50 border-rose-500 text-rose-800"
              : statusCounts.Rejected > 0
                ? "bg-rose-50/30 border-rose-200 text-rose-700 hover:bg-rose-100"
                : "bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed"
              }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Rejected {activeInterest !== "All" ? activeInterest : ""}: {statusCounts.Rejected}
          </button>
          <button
            onClick={() => setActiveStatus("Inbox")}
            className={`ml-auto flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${activeStatus === "Inbox"
              ? "bg-blue-600 border-blue-700 text-white"
              : statusCounts.Inbox > 0
                ? "bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100 animate-pulse"
                : "bg-gray-50 border-gray-100 text-gray-400"
              }`}
          >
            {statusCounts.Inbox} {activeInterest !== "All" ? activeInterest : ""} inbox
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {interestTabsList.map((tab: string) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant={activeInterest === tab ? "default" : "outline"}
            onClick={() => {
              scrollYRef.current = window.scrollY;
              setActiveInterest(tab);
            }}
            className="whitespace-nowrap"
          >
            {tab} ({interestCounts[tab] || 0})
          </Button>
        ))}
        <span className="text-xs text-gray-500 ml-auto flex-shrink-0">
          Showing {visibleOptions.length} of {activeStatus} options
        </span>
      </div>

      <div className="min-h-[200px]">
        {visibleOptions.length > 0 ? (
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
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center bg-gray-50/50 rounded-lg border border-dashed border-gray-200 h-full">
            <p className="text-gray-500 mb-3">
              No <span className="font-medium text-gray-700">{activeStatus.toLowerCase()}</span> activities
              {activeInterest !== "All" && (
                <> for <span className="font-medium text-gray-900">{activeInterest}</span></>
              )}.
            </p>
            <div className="text-sm text-gray-400 space-y-2">
              <p>{activeInterest !== "All" ? `${activeInterest} breakdown:` : "Activity breakdown:"}</p>
              <div className="flex flex-wrap gap-3 justify-center">
                {statusCounts.Selected > 0 && (
                  <span className="text-emerald-600 font-medium">
                    {statusCounts.Selected} selected
                  </span>
                )}
                {statusCounts.Postponed > 0 && (
                  <span className="text-amber-600 font-medium">
                    {statusCounts.Postponed} postponed
                  </span>
                )}
                {statusCounts.Rejected > 0 && (
                  <span className="text-rose-600 font-medium">
                    {statusCounts.Rejected} rejected
                  </span>
                )}
                {statusCounts.Inbox > 0 && (
                  <span className="text-blue-600 font-medium">
                    {statusCounts.Inbox} in inbox
                  </span>
                )}
                {statusCounts.Selected === 0 && statusCounts.Postponed === 0 && statusCounts.Rejected === 0 && statusCounts.Inbox === 0 && (
                  <span className="text-gray-400">No activities in this category</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
