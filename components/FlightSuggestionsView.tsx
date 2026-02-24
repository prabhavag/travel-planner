"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FlightOption, SubAgentStatus } from "@/lib/api-client";
import { Check, ChevronDown, ChevronUp, Clock, ExternalLink, Loader2, Plane, Timer, X } from "lucide-react";

interface FlightSuggestionsViewProps {
  status: SubAgentStatus;
  error: string | null;
  options: FlightOption[];
  selectedOptionId: string | null;
  wantsFlight: boolean | null;
  lastSearchedAt: string | null;
  onRefresh: () => void;
  onConfirmSelection: (optionId: string) => void;
  onRemoveOption?: (optionId: string) => void;
  onSkip: () => void;
  isLoading: boolean;
}

export function FlightSuggestionsView({
  status,
  error,
  options,
  selectedOptionId,
  wantsFlight,
  lastSearchedAt,
  onRefresh,
  onConfirmSelection,
  onRemoveOption,
  onSkip,
  isLoading,
}: FlightSuggestionsViewProps) {
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [localSelectedOptionId, setLocalSelectedOptionId] = useState<string | null>(selectedOptionId);

  useEffect(() => {
    setLocalSelectedOptionId(selectedOptionId);
  }, [selectedOptionId]);

  const toggleCard = (optionId: string) => {
    setCollapsedCards((prev) => ({ ...prev, [optionId]: !prev[optionId] }));
  };

  const formatPrice = (option: FlightOption) => {
    if (option.totalPriceEstimate == null) return "Price unavailable";
    return `${option.currency} ${option.totalPriceEstimate.toLocaleString()}`;
  };

  const stopsLabel = (stops: number | null) => {
    if (stops == null) return "Stops N/A";
    if (stops === 0) return "Nonstop";
    return `${stops} stop${stops === 1 ? "" : "s"}`;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="sticky top-0 z-10 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Flight Suggestions</h2>
            <p className="mt-1 text-sm text-gray-600">Top route options for your travel dates.</p>
            {lastSearchedAt ? (
              <p className="mt-1 text-xs text-gray-500">Last updated: {new Date(lastSearchedAt).toLocaleString()}</p>
            ) : null}
            {wantsFlight === false ? <p className="mt-1 text-xs font-medium text-amber-700">Flights skipped</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
              Refresh
            </Button>
            <Button variant="outline" onClick={onSkip} disabled={isLoading}>
              Skip Flights
            </Button>
            <Button
              onClick={() => localSelectedOptionId && onConfirmSelection(localSelectedOptionId)}
              disabled={!localSelectedOptionId || isLoading}
            >
              Use Selected Flight
            </Button>
          </div>
        </div>
      </div>

      {status === "running" ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-700 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching flight options...
        </div>
      ) : null}

      {status === "error" ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error || "Flight search failed. Refresh to retry."}
        </div>
      ) : null}

      {status === "complete" && options.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-gray-600">
          No flight options found yet. Try refreshing with updated trip details.
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
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{option.airline}</h3>
                  <p className="text-xs text-gray-600 truncate">{option.routeSummary || "Route details unavailable"}</p>
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
                <Badge variant="secondary" className="border border-violet-200 bg-violet-50 text-violet-800">
                  <Timer className="mr-1 h-3.5 w-3.5" />
                  {option.duration || "Duration N/A"}
                </Badge>
                <Badge variant="secondary" className="border border-cyan-200 bg-cyan-50 text-cyan-800">
                  <Plane className="mr-1 h-3.5 w-3.5" />
                  {stopsLabel(option.stops)}
                </Badge>
                <Badge variant="secondary" className="border border-sky-200 bg-sky-50 text-sky-800">
                  <Clock className="mr-1 h-3.5 w-3.5" />
                  Departs: {option.departureWindow || "N/A"}
                </Badge>
                <Badge variant="secondary" className="border border-indigo-200 bg-indigo-50 text-indigo-800">
                  <Clock className="mr-1 h-3.5 w-3.5" />
                  Arrives: {option.arrivalWindow || "N/A"}
                </Badge>
              </div>

              {!collapsed ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Summary</p>
                    <p className="text-sm text-gray-700">{option.summary || "No summary provided."}</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Timing</p>
                    <p className="text-sm text-gray-700">Departure window: {option.departureWindow || "Not specified"}</p>
                    <p className="text-sm text-gray-700">Arrival window: {option.arrivalWindow || "Not specified"}</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Baggage Notes</p>
                    <p className="text-sm text-gray-700">{option.baggageNotes || "Not specified."}</p>
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
