"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, ExternalLink, Loader2, Search, ChevronDown, ChevronUp } from "lucide-react";
import type { ResearchOption } from "@/lib/api-client";

interface ResearchOptionCardProps {
  option: ResearchOption;
  isSelected: boolean;
  onToggleSelect?: (optionId: string) => void;
  onDeepResearch?: (optionId: string) => void;
  deepResearchLoading?: boolean;
  deepResearchDisabled?: boolean;
  lastDeepResearchAt?: string;
  readOnly?: boolean;
  extraContent?: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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
  isSelected,
  onToggleSelect,
  onDeepResearch,
  deepResearchLoading = false,
  deepResearchDisabled = false,
  lastDeepResearchAt,
  readOnly = false,
  extraContent,
  collapsed = false,
  onToggleCollapse,
}: ResearchOptionCardProps) {
  const formattedLastDeepResearchAt = lastDeepResearchAt
    ? new Date(lastDeepResearchAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary bg-primary/5" : "border-gray-200"}`}
      onClick={() => {
        if (!readOnly) onToggleSelect?.(option.id);
      }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex-1">{option.title}</CardTitle>
          <div className="flex items-center gap-1">
            <Badge className={`capitalize border ${categoryClassMap[option.category] || categoryClassMap.other}`}>
              {option.category}
            </Badge>
            {isSelected ? (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
                <Check className="h-4 w-4" />
              </div>
            ) : null}
            {onToggleCollapse ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse();
                }}
                className="h-6 w-6 p-0 text-gray-400 hover:text-primary"
                title={collapsed ? "Expand card" : "Collapse card"}
              >
                {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {!collapsed ? (
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
          {onDeepResearch ? (
            <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readOnly || deepResearchDisabled || deepResearchLoading}
                onClick={() => onDeepResearch(option.id)}
                className="w-fit border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                {deepResearchLoading ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5 mr-1.5" />
                )}
                Research
              </Button>
              {formattedLastDeepResearchAt ? (
                <span className="text-[11px] text-gray-500">Last researched {formattedLastDeepResearchAt}</span>
              ) : null}
            </div>
          ) : null}
          {option.sourceLinks.length > 0 ? (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
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
                  {source.snippet ? <p className="text-xs text-blue-700 mt-1 line-clamp-2">{source.snippet}</p> : null}
                </a>
              ))}
            </div>
          ) : null}
          {Array.isArray(option.photoUrls) && option.photoUrls.length > 0 ? (
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
          ) : null}
          {extraContent}
        </CardContent>
      ) : null}
    </Card>
  );
}
