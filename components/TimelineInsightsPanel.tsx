"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  TimelineAnalysisResponse,
  TimelineMapView,
  TimelineTripSummary,
} from "@/lib/timeline";
import { Loader2 } from "lucide-react";

interface TimelineInsightsPanelProps {
  timelineLoading: boolean;
  timelineFileName: string | null;
  timelineAnalysis: TimelineAnalysisResponse | null;
  activeView: TimelineMapView;
  onViewChange: (view: TimelineMapView) => void;
  onUpload: React.ChangeEventHandler<HTMLInputElement>;
}

const VIEW_LABELS: Record<TimelineMapView, string> = {
  cities: "Cities",
  trips: "Trips",
  countries: "Countries",
};

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${Math.max(1, Math.round(totalMinutes))} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatTimelineDate(value: string | null): string | null {
  if (!value) return null;

  const directMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (directMatch) {
    const year = Number(directMatch[1]);
    const month = Number(directMatch[2]) - 1;
    const day = Number(directMatch[3]);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month, day)));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateRange(startTime: string | null, endTime: string | null): string | null {
  const startLabel = formatTimelineDate(startTime);
  const endLabel = formatTimelineDate(endTime);
  if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel} to ${endLabel}`;
  return startLabel || endLabel || null;
}

function renderTrip(trip: TimelineTripSummary) {
  const route = trip.cities.length > 0 ? trip.cities.join(" / ") : trip.country || "Unknown route";
  const dateRange = formatDateRange(trip.startTime, trip.endTime);

  return (
    <div key={trip.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">{trip.label}</p>
      <p className="mt-1 text-xs text-slate-500">{route}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
        {dateRange ? <span>{dateRange}</span> : null}
        <span>{trip.placeCount} places</span>
        <span>{formatDuration(trip.totalDurationMinutes)}</span>
      </div>
      {trip.categories.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {trip.categories.map((category) => (
            <Badge
              key={`${trip.id}-${category}`}
              variant="secondary"
              className="border border-orange-200 bg-orange-50 text-orange-800"
            >
              {category}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TimelineInsightsPanel({
  timelineLoading,
  timelineFileName,
  timelineAnalysis,
  activeView,
  onViewChange,
  onUpload,
}: TimelineInsightsPanelProps) {
  const items = timelineAnalysis
    ? activeView === "cities"
      ? timelineAnalysis.cities
      : activeView === "trips"
          ? timelineAnalysis.trips
          : timelineAnalysis.countries
    : [];

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-900">
            Personalize with Maps Timeline (Optional)
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Upload a Google Maps Timeline export. The analysis uses `visit.topCandidate.placeID`,
            filters low-confidence visits, resolves cached place info, and builds city, trip,
            and country views.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Input
          type="file"
          accept=".json"
          onChange={onUpload}
          disabled={timelineLoading}
          className="max-w-xs bg-white text-xs"
        />
        {timelineLoading ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : null}
      </div>

      {timelineFileName ? (
        <p className="mt-1 text-xs text-slate-500">Uploaded: {timelineFileName}</p>
      ) : null}

      {timelineAnalysis ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="border border-slate-200 bg-slate-50 text-slate-700">
                {timelineAnalysis.stats.visitCount} visits
              </Badge>
              <Badge variant="secondary" className="border border-slate-200 bg-slate-50 text-slate-700">
                {timelineAnalysis.stats.placeCount} places
              </Badge>
              <Badge variant="secondary" className="border border-slate-200 bg-slate-50 text-slate-700">
                {timelineAnalysis.stats.cityCount} cities
              </Badge>
              <Badge variant="secondary" className="border border-slate-200 bg-slate-50 text-slate-700">
                {timelineAnalysis.stats.countryCount} countries
              </Badge>
              <Badge variant="secondary" className="border border-slate-200 bg-slate-50 text-slate-700">
                {timelineAnalysis.stats.tripCount} trips
              </Badge>
            </div>

            <p className="mt-3 text-sm text-slate-700">{timelineAnalysis.summary}</p>

            {timelineAnalysis.preferences.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signals</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {timelineAnalysis.preferences.map((preference) => (
                    <Badge
                      key={preference}
                      variant="secondary"
                      className="border border-slate-200 bg-slate-50 text-slate-700"
                    >
                      {preference}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {timelineAnalysis.foodPreferences.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Food Context</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {timelineAnalysis.foodPreferences.map((preference) => (
                    <Badge
                      key={preference}
                      variant="secondary"
                      className="border border-amber-200 bg-amber-50 text-amber-800"
                    >
                      {preference}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Timeline Views</p>
                <p className="mt-1 text-xs text-slate-500">
                  The map on the right updates to match the selected tab.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(VIEW_LABELS) as TimelineMapView[]).map((view) => (
                  <Button
                    key={view}
                    type="button"
                    size="sm"
                    variant={activeView === view ? "default" : "outline"}
                    onClick={() => onViewChange(view)}
                  >
                    {VIEW_LABELS[view]}
                  </Button>
                ))}
              </div>
            </div>

            <ScrollArea className="mt-4 h-80 pr-3">
              <div className="space-y-3">
                {activeView === "trips"
                  ? (items as TimelineTripSummary[]).map((trip) => renderTrip(trip))
                  : activeView === "cities"
                    ? timelineAnalysis.cities.map((city) => (
                        <div key={city.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                          <p className="text-sm font-semibold text-slate-900">
                            {city.region ? `${city.city}, ${city.region}` : city.city}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{city.country || "Unknown country"}</p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                            <span>{city.placeCount} places</span>
                            <span>{city.visitCount} visits</span>
                            <span>{city.tripCount} trips</span>
                          </div>
                          {city.categories.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {city.categories.map((category) => (
                                <Badge
                                  key={`${city.id}-${category}`}
                                  variant="secondary"
                                  className="border border-teal-200 bg-teal-50 text-teal-800"
                                >
                                  {category}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))
                      : timelineAnalysis.countries.map((country) => (
                        <div key={country.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                          <p className="text-sm font-semibold text-slate-900">{country.country}</p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                            <span>{country.cityCount} cities</span>
                            <span>{country.placeCount} places</span>
                            <span>{country.tripCount} trips</span>
                          </div>
                        </div>
                      ))}

                {items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No items available for this view yet.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </div>
      ) : null}
    </div>
  );
}
