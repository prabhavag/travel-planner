"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import type { ResearchOption, ResearchOptionPreference } from "@/lib/api-client";

interface ResearchOptionCardProps {
  option: ResearchOption;
  selection: ResearchOptionPreference;
  onSelectionChange?: (optionId: string, preference: ResearchOptionPreference) => void;
  readOnly?: boolean;
  extraContent?: ReactNode;
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

export function ResearchOptionCard({
  option,
  selection,
  onSelectionChange,
  readOnly = false,
  extraContent,
}: ResearchOptionCardProps) {
  return (
    <Card className="border-gray-200">
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
            const isActive = selection === choice;
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
                disabled={readOnly}
                onClick={() => onSelectionChange?.(option.id, choice)}
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
        {extraContent}
      </CardContent>
    </Card>
  );
}
