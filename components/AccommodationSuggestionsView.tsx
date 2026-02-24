"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AccommodationOption, SubAgentStatus } from "@/lib/api-client";
import { Check, ChevronDown, ChevronUp, ExternalLink, Loader2, MapPin, Star, X } from "lucide-react";

interface AccommodationSuggestionsViewProps {
  status: SubAgentStatus;
  error: string | null;
  options: AccommodationOption[];
  selectedOptionId: string | null;
  wantsAccommodation: boolean | null;
  lastSearchedAt: string | null;
  onRefresh: () => void;
  onConfirmSelection: (optionId: string) => void;
  onRemoveOption?: (optionId: string) => void;
  onSkip: () => void;
  isLoading: boolean;
}

export function AccommodationSuggestionsView({
  status,
  error,
  options,
  selectedOptionId,
  wantsAccommodation,
  lastSearchedAt,
  onRefresh,
  onConfirmSelection,
  onRemoveOption,
  onSkip,
  isLoading,
}: AccommodationSuggestionsViewProps) {
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [localSelectedOptionId, setLocalSelectedOptionId] = useState<string | null>(selectedOptionId);

  useEffect(() => {
    setLocalSelectedOptionId(selectedOptionId);
  }, [selectedOptionId]);

  const toggleCard = (optionId: string) => {
    setCollapsedCards((prev) => ({ ...prev, [optionId]: !prev[optionId] }));
  };

  const formatPrice = (option: AccommodationOption) => {
    if (option.nightlyPriceEstimate == null) return "Price unavailable";
    return `${option.currency} ${option.nightlyPriceEstimate.toLocaleString()}/night`;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="sticky top-0 z-10 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Accommodation Suggestions</h2>
            <p className="mt-1 text-sm text-gray-600">Curated based on your selected activities and trip dates.</p>
            {lastSearchedAt ? (
              <p className="mt-1 text-xs text-gray-500">Last updated: {new Date(lastSearchedAt).toLocaleString()}</p>
            ) : null}
            {wantsAccommodation === false ? (
              <p className="mt-1 text-xs font-medium text-amber-700">Hotels skipped</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
              Refresh
            </Button>
            <Button variant="outline" onClick={onSkip} disabled={isLoading}>
              Skip Hotels
            </Button>
            <Button
              onClick={() => localSelectedOptionId && onConfirmSelection(localSelectedOptionId)}
              disabled={!localSelectedOptionId || isLoading}
            >
              Use Selected Hotel
            </Button>
          </div>
        </div>
      </div>

      {status === "running" ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-700 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching accommodation options...
        </div>
      ) : null}

      {status === "error" ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error || "Accommodation search failed. Refresh to retry."}
        </div>
      ) : null}

      {status === "complete" && options.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-gray-600">
          No accommodation options found yet. Try refreshing with updated trip details.
        </div>
      ) : null}

      <div className="space-y-3">
        {options.map((option) => {
          const collapsed = Boolean(collapsedCards[option.id]);
          const isSelected = localSelectedOptionId === option.id;

          return (
            <div
              key={option.id}
              className={`cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition-all ${
                isSelected ? "border-blue-300 ring-1 ring-blue-200" : "border-gray-200"
              }`}
              onClick={() =>
                setLocalSelectedOptionId((prev) => (prev === option.id ? null : option.id))
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{option.name}</h3>
                  <p className="text-xs text-gray-600 truncate">{option.neighborhood || "Area not specified"}</p>
                </div>
                <div className="flex items-start gap-2">
                  {isSelected ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
                      <Check className="h-4 w-4" />
                    </div>
                  ) : null}
                  <p className="text-right text-sm font-medium text-gray-700">{formatPrice(option)}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-gray-400 hover:text-primary"
                    title={collapsed ? "Expand card" : "Collapse card"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCard(option.id);
                    }}
                  >
                    {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </Button>
                  {onRemoveOption ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-gray-400 hover:text-red-600"
                      title="Remove card"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveOption(option.id);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="border border-amber-200 bg-amber-50 text-amber-800">
                  <Star className="mr-1 h-3.5 w-3.5" />
                  {option.rating != null ? option.rating.toFixed(1) : "Rating N/A"}
                </Badge>
                <Badge variant="secondary" className="border border-sky-200 bg-sky-50 text-sky-800">
                  <MapPin className="mr-1 h-3.5 w-3.5" />
                  {option.neighborhood || "Location N/A"}
                </Badge>
              </div>

              {!collapsed ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Summary</p>
                    <p className="text-sm text-gray-700">{option.summary || "No summary provided."}</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Pros</p>
                    {option.pros.length > 0 ? (
                      <ul className="space-y-1">
                        {option.pros.map((pro, idx) => (
                          <li key={`${option.id}-pro-${idx}`} className="text-sm text-emerald-700">
                            • {pro}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-600">Not specified.</p>
                    )}
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Cons</p>
                    {option.cons.length > 0 ? (
                      <ul className="space-y-1">
                        {option.cons.map((con, idx) => (
                          <li key={`${option.id}-con-${idx}`} className="text-sm text-rose-700">
                            • {con}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-600">Not specified.</p>
                    )}
                  </div>

                  {option.sourceUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                      href={option.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View source
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
