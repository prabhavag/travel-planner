"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
  Polyline,
  OverlayView,
} from "@react-google-maps/api";
import { getConfig } from "@/lib/api-client";
import type {
  SuggestedActivity,
  GroupedDay,
  TripResearchBrief,
  ResearchOptionPreference,
} from "@/lib/api-client";
import { Loader2 } from "lucide-react";
import { getDayColor, SELECTED_COLOR, UNSELECTED_COLOR } from "@/lib/constants";

const containerStyle = {
  width: "100%",
  height: "100%",
};

// Container style deleted as we are using shared ones if needed, but actually keeping local is fine if not exported.
// Wait, I should remove the local definitions that are now in constants.ts

interface Coordinates {
  lat: number;
  lng: number;
}

interface Activity {
  name: string;
  coordinates?: Coordinates;
}

interface DayItinerary {
  day_number?: number;
  dayNumber?: number;
  morning?: Activity[];
  afternoon?: Activity[];
  evening?: Activity[];
}

interface Location {
  name: string;
  lat: number;
  lng: number;
  slot: string;
  slotIndex: number;
  actIndex: number;
  day: number;
  desc: string;
  isSelected?: boolean;
  preference?: ResearchOptionPreference;
  activityId?: string;
  photoUrl?: string | null;
  mode: "research" | "suggested" | "grouped" | "legacy";
}

interface MapComponentProps {
  itinerary?: DayItinerary[];
  destination?: string | null;
  // New activity-first flow props
  tripResearchBrief?: TripResearchBrief | null;
  researchOptionSelections?: Record<string, ResearchOptionPreference>;
  researchFocusPreference?: "all" | "keep" | "maybe" | "reject";
  suggestedActivities?: SuggestedActivity[];
  selectedActivityIds?: string[];
  groupedDays?: GroupedDay[];
  onActivityClick?: (activityId: string) => void;
  hoveredActivityId?: string | null;
  highlightedDay?: number | null;
}

const libraries: ("places")[] = ["places"];

export default function MapComponent({
  itinerary,
  destination,
  tripResearchBrief,
  researchOptionSelections,
  researchFocusPreference = "all",
  suggestedActivities,
  selectedActivityIds,
  groupedDays,
  onActivityClick,
  hoveredActivityId,
  highlightedDay,
}: MapComponentProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch API key from backend
  useEffect(() => {
    const fetchConfig = async () => {
      const config = await getConfig();
      setApiKey(config.googleMapsApiKey || "");
      setLoading(false);
    };
    fetchConfig();
  }, []);

  // Extract locations from various data sources - memoized to prevent re-renders on hover
  const locations = useMemo(() => {
    const locs: Location[] = [];
    const selectedSet = new Set(selectedActivityIds || []);

    // Mode 1: Grouped days (day grouping and itinerary phases)
    if (groupedDays && groupedDays.length > 0) {
      groupedDays.forEach((day) => {
        day.activities.forEach((activity, actIndex) => {
          if (activity.coordinates && activity.coordinates.lat && activity.coordinates.lng) {
            locs.push({
              name: activity.name,
              lat: activity.coordinates.lat,
              lng: activity.coordinates.lng,
              slot: activity.bestTimeOfDay || "any",
              slotIndex: actIndex,
              actIndex: actIndex,
              day: day.dayNumber,
              desc: `Day ${day.dayNumber} - ${activity.type}`,
              activityId: activity.id,
              photoUrl: activity.photo_url || null,
              mode: "grouped",
            });
          }
        });
        // Also add restaurants if present
        day.restaurants.forEach((restaurant, restIndex) => {
          if (restaurant.coordinates && restaurant.coordinates.lat && restaurant.coordinates.lng) {
            locs.push({
              name: restaurant.name,
              lat: restaurant.coordinates.lat,
              lng: restaurant.coordinates.lng,
              slot: "restaurant",
              slotIndex: 100 + restIndex, // Put restaurants after activities
              actIndex: restIndex,
              day: day.dayNumber,
              desc: `Day ${day.dayNumber} - Restaurant`,
              photoUrl: restaurant.photo_url || null,
              mode: "grouped",
            });
          }
        });
      });
    }
    // Mode 2: Initial research recommendations
    else if (tripResearchBrief && tripResearchBrief.popularOptions.length > 0) {
      tripResearchBrief.popularOptions.forEach((option, optionIndex) => {
        if (!option.coordinates?.lat || !option.coordinates?.lng) return;
        const preference = researchOptionSelections?.[option.id] || "maybe";
        locs.push({
          name: option.title,
          lat: option.coordinates.lat,
          lng: option.coordinates.lng,
          slot: option.category,
          slotIndex: 0,
          actIndex: optionIndex,
          day: 0,
          desc: `${option.category}`,
          activityId: option.id,
          photoUrl: option.photoUrls?.[0] || null,
          preference,
          mode: "research",
        });
      });
    }
    // Mode 3: Suggested activities (before day grouping)
    else if (suggestedActivities && suggestedActivities.length > 0) {
      suggestedActivities.forEach((activity, actIndex) => {
        if (!selectedSet.has(activity.id)) return;
        if (activity.coordinates && activity.coordinates.lat && activity.coordinates.lng) {
          locs.push({
            name: activity.name,
            lat: activity.coordinates.lat,
            lng: activity.coordinates.lng,
            slot: activity.bestTimeOfDay || "any",
            slotIndex: 0,
            actIndex: actIndex,
            day: 0, // No day assigned yet
            desc: activity.type,
            isSelected: true,
            activityId: activity.id,
            photoUrl: activity.photo_url || null,
            mode: "suggested",
          });
        }
      });
    }
    // Mode 4: Legacy itinerary format
    else if (itinerary) {
      itinerary.forEach((day, dayIndex) => {
        const dayNumber = day.day_number || day.dayNumber || dayIndex + 1;
        (["morning", "afternoon", "evening"] as const).forEach((slot, slotIndex) => {
          const activities = day[slot];
          if (activities) {
            activities.forEach((act, actIndex) => {
              if (act.coordinates && act.coordinates.lat && act.coordinates.lng) {
                locs.push({
                  name: act.name,
                  lat: act.coordinates.lat,
                  lng: act.coordinates.lng,
                  slot: slot,
                  slotIndex: slotIndex,
                  actIndex: actIndex,
                  day: dayNumber,
                  desc: `Day ${dayNumber} - ${slot}`,
                  mode: "legacy",
                });
              }
            });
          }
        });
      });
    }

    return locs;
  }, [tripResearchBrief, researchOptionSelections, suggestedActivities, selectedActivityIds, groupedDays, itinerary]);

  if (loading) {
    return (
      <div className="h-full w-full min-h-[500px] rounded-xl border border-gray-200 bg-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <span className="text-gray-600">Loading map...</span>
        </div>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="h-full w-full min-h-[500px] rounded-xl border border-gray-200 bg-gray-100 flex items-center justify-center">
        <span className="text-gray-600">Google Maps API key not configured.</span>
      </div>
    );
  }

  const hasContent = locations.length > 0 || destination || (itinerary && itinerary.length > 0);

  if (!hasContent) {
    return (
      <div className="h-full w-full min-h-[500px] rounded-xl border border-gray-200 bg-gray-100 flex items-center justify-center">
        <span className="text-gray-500">Map will appear when you start planning</span>
      </div>
    );
  }

  const isGroupedMode = Boolean(groupedDays && groupedDays.length > 0);
  const isResearchSelectionMode = Boolean(
    !isGroupedMode && tripResearchBrief && tripResearchBrief.popularOptions.length > 0
  );
  const isActivitySelectionMode = Boolean(
    !isGroupedMode && !isResearchSelectionMode && suggestedActivities && suggestedActivities.length > 0
  );

  return (
    <div className="h-full w-full min-h-[500px] rounded-xl border border-gray-200 overflow-hidden">
      <GoogleMapContent
        apiKey={apiKey}
        locations={locations}
        itinerary={itinerary}
        destination={destination}
        isGroupedMode={isGroupedMode}
        isResearchSelectionMode={isResearchSelectionMode}
        researchFocusPreference={researchFocusPreference}
        isActivitySelectionMode={isActivitySelectionMode}
        onActivityClick={onActivityClick}
        hoveredActivityId={hoveredActivityId}
        highlightedDay={highlightedDay}
      />
    </div>
  );
}

interface GoogleMapContentProps {
  apiKey: string;
  locations: Location[];
  itinerary?: DayItinerary[];
  destination?: string | null;
  isGroupedMode?: boolean;
  isResearchSelectionMode?: boolean;
  researchFocusPreference?: "all" | "keep" | "maybe" | "reject";
  isActivitySelectionMode?: boolean;
  onActivityClick?: (activityId: string) => void;
  hoveredActivityId?: string | null;
  highlightedDay?: number | null;
}

// Hover tooltip component for showing activity/restaurant info
function HoverTooltip({ location }: { location: Location }) {
  return (
    <OverlayView
      position={{ lat: location.lat, lng: location.lng }}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={(width, height) => ({
        x: -(width / 2),
        y: -height - 45, // Position above the marker
      })}
    >
      <div className="bg-white rounded-lg shadow-lg p-2 pointer-events-none min-w-[160px] max-w-[200px] border border-gray-200">
        {/* Photo thumbnail */}
        {location.photoUrl ? (
          <div className="w-full h-24 mb-2 rounded overflow-hidden bg-gray-100">
            <img
              src={location.photoUrl}
              alt={location.name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        ) : (
          <div className="w-full h-24 mb-2 rounded bg-gray-100 flex items-center justify-center">
            <span className="text-gray-400 text-xs">No photo</span>
          </div>
        )}

        {/* Activity/Restaurant name */}
        <p className="font-medium text-sm text-gray-900 line-clamp-2">{location.name}</p>

        {/* Type/Description */}
        <p className="text-xs text-gray-500 mt-0.5">{location.desc}</p>
      </div>
    </OverlayView>
  );
}

function GoogleMapContent({
  apiKey,
  locations,
  itinerary,
  destination,
  isGroupedMode,
  isResearchSelectionMode,
  researchFocusPreference = "all",
  isActivitySelectionMode,
  onActivityClick,
  hoveredActivityId,
  highlightedDay,
}: GoogleMapContentProps) {
  const [selectedMarker, setSelectedMarker] = useState<Location | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<Location | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [destinationCenter, setDestinationCenter] = useState<Coordinates | null>(null);

  // Refs to prevent map from resetting position on every re-render
  const boundsSetRef = useRef(false);
  const prevLocationsCountRef = useRef(locations.length);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries,
  });

  // Geocode destination if no locations available
  useEffect(() => {
    if (isLoaded && locations.length === 0 && destination && window.google) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address: destination }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location;
          setDestinationCenter({ lat: loc.lat(), lng: loc.lng() });
        }
      });
    }
  }, [isLoaded, locations.length, destination]);

  // Group locations by day for polylines
  const locationsByDay: Record<number, Location[]> = {};
  locations.forEach((loc) => {
    if (loc.day == null) return;
    if (!locationsByDay[loc.day]) {
      locationsByDay[loc.day] = [];
    }
    locationsByDay[loc.day].push(loc);
  });

  // Sort locations within each day by time slot order, then by activity index
  Object.keys(locationsByDay).forEach((day) => {
    locationsByDay[Number(day)].sort((a, b) => {
      if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
      return a.actIndex - b.actIndex;
    });
  });

  // getDayColor removed as it is now imported

  // Fit bounds when map loads
  const onLoad = useCallback(
    (mapInstance: google.maps.Map) => {
      setMap(mapInstance);
      if (locations.length > 0) {
        const bounds = new window.google.maps.LatLngBounds();
        locations.forEach((loc) => bounds.extend({ lat: loc.lat, lng: loc.lng }));
        mapInstance.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
      }
    },
    [locations]
  );

  // Reset bounds tracking when locations count changes (new data loaded)
  useEffect(() => {
    if (locations.length !== prevLocationsCountRef.current) {
      boundsSetRef.current = false;
      prevLocationsCountRef.current = locations.length;
    }
  }, [locations.length]);

  // Update bounds only on initial load or when locations change significantly
  useEffect(() => {
    if (map && locations.length > 0 && window.google && !boundsSetRef.current) {
      const bounds = new window.google.maps.LatLngBounds();
      locations.forEach((loc) => bounds.extend({ lat: loc.lat, lng: loc.lng }));
      map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
      boundsSetRef.current = true;
    }
  }, [map, locations]);

  // Get marker icon based on day or selection state
  const getMarkerIcon = (loc: Location): google.maps.Symbol => {
    const isHovered = loc.activityId === hoveredActivityId;

    if (isResearchSelectionMode) {
      const preference = loc.preference || "maybe";
      const isFocusedCategory = researchFocusPreference === "all" || preference === researchFocusPreference;
      const fillColor =
        preference === "keep" ? "#22C55E" : preference === "reject" ? "#EF4444" : "#FACC15";
      const baseOpacity = isFocusedCategory ? 0.96 : 0.34;
      return {
        path: "M12 0C7.58 0 4 3.58 4 8c0 5.25 8 13 8 13s8-7.75 8-13c0-4.42-3.58-8-8-8z",
        fillColor,
        fillOpacity: isHovered ? Math.min(baseOpacity + 0.18, 1) : baseOpacity,
        strokeColor: isHovered ? "#1F2937" : "#ffffff",
        strokeWeight: isHovered ? 2 : 1,
        scale: isHovered ? (isFocusedCategory ? 2.1 : 1.6) : (isFocusedCategory ? 1.75 : 1.25),
        anchor: new window.google.maps.Point(12, 21),
        labelOrigin: new window.google.maps.Point(12, 8),
      };
    }

    // In suggested-activity selection mode, use selected/unselected colors
    if (isActivitySelectionMode) {
      return {
        path: "M12 0C7.58 0 4 3.58 4 8c0 5.25 8 13 8 13s8-7.75 8-13c0-4.42-3.58-8-8-8z",
        fillColor: loc.isSelected ? SELECTED_COLOR : UNSELECTED_COLOR,
        fillOpacity: loc.isSelected || isHovered ? 1 : 0.6,
        strokeColor: isHovered ? "#3B82F6" : "#ffffff",
        strokeWeight: isHovered ? 2 : 1,
        scale: isHovered ? 2.1 : (loc.isSelected ? 1.7 : 1.35),
        anchor: new window.google.maps.Point(12, 21),
        labelOrigin: new window.google.maps.Point(12, 8),
      };
    }

    // Otherwise use day-based pins (not just circles anymore, for consistency with numbers)
    const isHighlighted = loc.day === highlightedDay;
    return {
      path: "M12 0C7.58 0 4 3.58 4 8c0 5.25 8 13 8 13s8-7.75 8-13c0-4.42-3.58-8-8-8z",
      fillColor: getDayColor(loc.day),
      fillOpacity: isHighlighted || highlightedDay == null ? 1 : 0.4,
      strokeColor: isHovered ? "#3B82F6" : (isHighlighted ? "#000000" : "#ffffff"),
      strokeWeight: isHovered || isHighlighted ? 2 : 1,
      scale: isHovered ? 2.0 : (isHighlighted ? 1.85 : 1.45),
      anchor: new window.google.maps.Point(12, 21),
      labelOrigin: new window.google.maps.Point(12, 8),
    };
  };

  if (loadError) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-gray-600">Error loading Google Maps</span>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Determine map center
  const mapCenter =
    locations.length > 0
      ? { lat: locations[0].lat, lng: locations[0].lng }
      : destinationCenter || { lat: 37.7749, lng: -122.4194 }; // Default to SF

  // Show loading if we're waiting for destination geocoding
  if (locations.length === 0 && destination && !destinationCenter) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="text-gray-600">Loading {destination}...</span>
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={mapCenter}
      zoom={locations.length > 0 ? 12 : 11}
      onLoad={onLoad}
      options={{
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: true,
      }}
    >
      {/* Draw polylines connecting locations for each day - only if not in activity selection mode */}
      {isGroupedMode && Object.entries(locationsByDay)
        .filter(([, dayLocations]) => dayLocations.length >= 2)
        .map(([day, dayLocations]) => (
          <Polyline
            key={`polyline-day-${day}`}
            path={dayLocations.map((loc) => ({ lat: loc.lat, lng: loc.lng }))}
            options={{
              strokeColor: getDayColor(parseInt(day)) || "#666666",
              strokeOpacity: highlightedDay === parseInt(day) || highlightedDay === null ? 0.9 : 0.2,
              strokeWeight: highlightedDay === parseInt(day) ? 6 : 3,
            }}
          />
        ))}

      {/* Draw markers for each location */}
      {locations.map((loc, idx) => (
        <Marker
          key={idx}
          position={{ lat: loc.lat, lng: loc.lng }}
          icon={getMarkerIcon(loc)}
          label={
            {
              text: isGroupedMode ? loc.day.toString() : (loc.actIndex + 1).toString(),
              color: "white",
              fontWeight: "bold",
              fontSize: (loc.activityId === hoveredActivityId || isGroupedMode) ? "11px" : "10px",
            }
          }
          onClick={() => {
            if (isActivitySelectionMode && onActivityClick && loc.activityId) {
              onActivityClick(loc.activityId);
            } else {
              setSelectedMarker(loc);
            }
          }}
          onMouseOver={() => setHoveredMarker(loc)}
          onMouseOut={() => setHoveredMarker(null)}
          zIndex={
            isResearchSelectionMode
              ? (researchFocusPreference === "all" || (loc.preference || "maybe") === researchFocusPreference ? 2000 : 1000)
              : 1500
          }
        />
      ))}

      {/* Hover tooltip */}
      {hoveredMarker && <HoverTooltip location={hoveredMarker} />}

      {selectedMarker && (
        <InfoWindow
          position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
          onCloseClick={() => setSelectedMarker(null)}
        >
          <div className="text-center p-1">
            <strong>{selectedMarker.name}</strong>
            <br />
            <span className="text-sm text-gray-500">{selectedMarker.desc}</span>
          </div>
        </InfoWindow>
      )}
    </GoogleMap>
  );
}
