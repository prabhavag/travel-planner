"use client";

import { useEffect, useState, useCallback } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
  Polyline,
} from "@react-google-maps/api";
import { getConfig } from "@/lib/api-client";
import type { SuggestedActivity, GroupedDay } from "@/lib/api-client";
import { Loader2 } from "lucide-react";

const containerStyle = {
  width: "100%",
  height: "100%",
};

// Color palette for different days
const DAY_COLORS = [
  "#E53935", // Red
  "#1E88E5", // Blue
  "#43A047", // Green
  "#FB8C00", // Orange
  "#8E24AA", // Purple
  "#00ACC1", // Cyan
  "#FFB300", // Amber
  "#5E35B1", // Deep Purple
  "#D81B60", // Pink
  "#00897B", // Teal
];

// Unselected activity color
const UNSELECTED_COLOR = "#9CA3AF";
const SELECTED_COLOR = "#3B82F6";

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
  activityId?: string;
}

interface MapComponentProps {
  itinerary?: DayItinerary[];
  destination?: string | null;
  // New activity-first flow props
  suggestedActivities?: SuggestedActivity[];
  selectedActivityIds?: string[];
  groupedDays?: GroupedDay[];
  onActivityClick?: (activityId: string) => void;
  hoveredActivityId?: string | null;
}

const libraries: ("places")[] = ["places"];

export default function MapComponent({
  itinerary,
  destination,
  suggestedActivities,
  selectedActivityIds,
  groupedDays,
  onActivityClick,
  hoveredActivityId,
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

  // Extract locations from various data sources
  const locations: Location[] = [];
  const selectedSet = new Set(selectedActivityIds || []);

  // Mode 1: Suggested activities (activity selection phase)
  if (suggestedActivities && suggestedActivities.length > 0) {
    suggestedActivities.forEach((activity, actIndex) => {
      if (activity.coordinates && activity.coordinates.lat && activity.coordinates.lng) {
        const isSelected = selectedSet.has(activity.id);
        locations.push({
          name: activity.name,
          lat: activity.coordinates.lat,
          lng: activity.coordinates.lng,
          slot: activity.bestTimeOfDay || "any",
          slotIndex: 0,
          actIndex: actIndex,
          day: 0, // No day assigned yet
          desc: activity.type,
          isSelected: isSelected,
          activityId: activity.id,
        });
      }
    });
  }
  // Mode 2: Grouped days (day grouping and itinerary phases)
  else if (groupedDays && groupedDays.length > 0) {
    groupedDays.forEach((day) => {
      day.activities.forEach((activity, actIndex) => {
        if (activity.coordinates && activity.coordinates.lat && activity.coordinates.lng) {
          locations.push({
            name: activity.name,
            lat: activity.coordinates.lat,
            lng: activity.coordinates.lng,
            slot: activity.bestTimeOfDay || "any",
            slotIndex: actIndex,
            actIndex: actIndex,
            day: day.dayNumber,
            desc: `Day ${day.dayNumber} - ${activity.type}`,
            activityId: activity.id,
          });
        }
      });
      // Also add restaurants if present
      day.restaurants.forEach((restaurant, restIndex) => {
        if (restaurant.coordinates && restaurant.coordinates.lat && restaurant.coordinates.lng) {
          locations.push({
            name: restaurant.name,
            lat: restaurant.coordinates.lat,
            lng: restaurant.coordinates.lng,
            slot: "restaurant",
            slotIndex: 100 + restIndex, // Put restaurants after activities
            actIndex: restIndex,
            day: day.dayNumber,
            desc: `Day ${day.dayNumber} - Restaurant`,
          });
        }
      });
    });
  }
  // Mode 3: Legacy itinerary format
  else if (itinerary) {
    itinerary.forEach((day, dayIndex) => {
      const dayNumber = day.day_number || day.dayNumber || dayIndex + 1;
      (["morning", "afternoon", "evening"] as const).forEach((slot, slotIndex) => {
        const activities = day[slot];
        if (activities) {
          activities.forEach((act, actIndex) => {
            if (act.coordinates && act.coordinates.lat && act.coordinates.lng) {
              locations.push({
                name: act.name,
                lat: act.coordinates.lat,
                lng: act.coordinates.lng,
                slot: slot,
                slotIndex: slotIndex,
                actIndex: actIndex,
                day: dayNumber,
                desc: `Day ${dayNumber} - ${slot}`,
              });
            }
          });
        }
      });
    });
  }

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

  // Determine if we're in activity selection mode
  const isActivitySelectionMode = suggestedActivities && suggestedActivities.length > 0;

  return (
    <div className="h-full w-full min-h-[500px] rounded-xl border border-gray-200 overflow-hidden">
      <GoogleMapContent
        apiKey={apiKey}
        locations={locations}
        itinerary={itinerary}
        destination={destination}
        isActivitySelectionMode={isActivitySelectionMode}
        onActivityClick={onActivityClick}
        hoveredActivityId={hoveredActivityId}
      />
    </div>
  );
}

interface GoogleMapContentProps {
  apiKey: string;
  locations: Location[];
  itinerary?: DayItinerary[];
  destination?: string | null;
  isActivitySelectionMode?: boolean;
  onActivityClick?: (activityId: string) => void;
  hoveredActivityId?: string | null;
}

function GoogleMapContent({
  apiKey,
  locations,
  itinerary,
  destination,
  isActivitySelectionMode,
  onActivityClick,
  hoveredActivityId,
}: GoogleMapContentProps) {
  const [selectedMarker, setSelectedMarker] = useState<Location | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [destinationCenter, setDestinationCenter] = useState<Coordinates | null>(null);

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

  // Get color for a specific day
  const getDayColor = (dayNumber: number) => {
    const num = Number(dayNumber);
    if (isNaN(num) || num < 1) return DAY_COLORS[0];
    return DAY_COLORS[(num - 1) % DAY_COLORS.length];
  };

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

  // Update bounds when itinerary changes
  useEffect(() => {
    if (map && locations.length > 0 && window.google) {
      const bounds = new window.google.maps.LatLngBounds();
      locations.forEach((loc) => bounds.extend({ lat: loc.lat, lng: loc.lng }));
      map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
    }
  }, [map, itinerary, locations]);

  // Get marker icon based on day or selection state
  const getMarkerIcon = (loc: Location): google.maps.Symbol => {
    // In activity selection mode, use pin shapes
    if (isActivitySelectionMode) {
      const isHovered = loc.activityId === hoveredActivityId;
      return {
        path: "M12 0C7.58 0 4 3.58 4 8c0 5.25 8 13 8 13s8-7.75 8-13c0-4.42-3.58-8-8-8z",
        fillColor: loc.isSelected ? SELECTED_COLOR : UNSELECTED_COLOR,
        fillOpacity: loc.isSelected || isHovered ? 1 : 0.6,
        strokeColor: isHovered ? "#3B82F6" : "#ffffff",
        strokeWeight: isHovered ? 2 : 1,
        scale: isHovered ? 2 : (loc.isSelected ? 1.5 : 1.2),
        anchor: new window.google.maps.Point(12, 21),
        labelOrigin: new window.google.maps.Point(12, 8),
      };
    }
    // Otherwise use day-based circles
    return {
      path: window.google.maps.SymbolPath.CIRCLE,
      fillColor: getDayColor(loc.day),
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
      scale: 10,
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
      {!isActivitySelectionMode && Object.entries(locationsByDay)
        .filter(([, dayLocations]) => dayLocations.length >= 2)
        .map(([day, dayLocations]) => (
          <Polyline
            key={`polyline-day-${day}`}
            path={dayLocations.map((loc) => ({ lat: loc.lat, lng: loc.lng }))}
            options={{
              strokeColor: getDayColor(parseInt(day)) || "#666666",
              strokeOpacity: 0.8,
              strokeWeight: 4,
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
            isActivitySelectionMode
              ? {
                text: (loc.actIndex + 1).toString(),
                color: "white",
                fontWeight: "bold",
                fontSize: loc.activityId === hoveredActivityId ? "14px" : "11px",
              }
              : undefined
          }
          onClick={() => {
            if (isActivitySelectionMode && onActivityClick && loc.activityId) {
              onActivityClick(loc.activityId);
            } else {
              setSelectedMarker(loc);
            }
          }}
        />
      ))}

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
