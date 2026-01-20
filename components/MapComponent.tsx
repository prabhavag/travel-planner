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
import type { SuggestedActivity, GroupedDay } from "@/lib/api-client";
import { Loader2 } from "lucide-react";
import { getDayColor, SELECTED_COLOR, UNSELECTED_COLOR } from "@/lib/constants";

const containerStyle = {
  width: "100%",
  height: "100%",
};

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
  photoUrl?: string | null;
}

interface MapComponentProps {
  itinerary?: DayItinerary[];
  destination?: string | null;
  suggestedActivities?: SuggestedActivity[];
  selectedActivityIds?: string[];
  groupedDays?: GroupedDay[];
  onActivityClick?: (activityId: string) => void;
  hoveredActivityId?: string | null;
  selectedDayNumber?: number;
  highlightedLocationId?: string | null;
}

const libraries: "places"[] = ["places"];

export default function MapComponent({
  itinerary,
  destination,
  suggestedActivities,
  selectedActivityIds,
  groupedDays,
  onActivityClick,
  hoveredActivityId,
  selectedDayNumber,
  highlightedLocationId,
}: MapComponentProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      const config = await getConfig();
      setApiKey(config.googleMapsApiKey || "");
      setLoading(false);
    };
    fetchConfig();
  }, []);

  const locations = useMemo(() => {
    const locs: Location[] = [];
    const selectedSet = new Set(selectedActivityIds || []);

    if (suggestedActivities && suggestedActivities.length > 0) {
      suggestedActivities.forEach((activity, actIndex) => {
        if (activity.coordinates && activity.coordinates.lat && activity.coordinates.lng) {
          const isSelected = selectedSet.has(activity.id);
          locs.push({
            name: activity.name,
            lat: activity.coordinates.lat,
            lng: activity.coordinates.lng,
            slot: activity.bestTimeOfDay || "any",
            slotIndex: 0,
            actIndex: actIndex,
            day: 0,
            desc: activity.type,
            isSelected: isSelected,
            activityId: activity.id,
            photoUrl: activity.photo_url || null,
          });
        }
      });
    } else if (groupedDays && groupedDays.length > 0) {
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
            });
          }
        });
        day.restaurants.forEach((restaurant, restIndex) => {
          if (restaurant.coordinates && restaurant.coordinates.lat && restaurant.coordinates.lng) {
            locs.push({
              name: restaurant.name,
              lat: restaurant.coordinates.lat,
              lng: restaurant.coordinates.lng,
              slot: "restaurant",
              slotIndex: 100 + restIndex,
              actIndex: restIndex,
              day: day.dayNumber,
              desc: `Day ${day.dayNumber} - Restaurant`,
              photoUrl: restaurant.photo_url || null,
            });
          }
        });
      });
    } else if (itinerary) {
      itinerary.forEach((day, dayIndex) => {
        const dayNum = day.day_number || day.dayNumber || dayIndex + 1;
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
                  day: dayNum,
                  desc: `Day ${dayNum} - ${slot}`,
                });
              }
            });
          }
        });
      });
    }

    return locs;
  }, [suggestedActivities, selectedActivityIds, groupedDays, itinerary]);

  const filteredLocations = useMemo(() => {
    if (!selectedDayNumber) return locations;
    return locations.filter((loc) => loc.day === 0 || loc.day === selectedDayNumber);
  }, [locations, selectedDayNumber]);

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

  const isActivitySelectionMode = suggestedActivities && suggestedActivities.length > 0;

  return (
    <div className="h-full w-full min-h-[500px] rounded-xl border border-gray-200 overflow-hidden">
      <GoogleMapContent
        apiKey={apiKey}
        locations={filteredLocations}
        itinerary={itinerary}
        destination={destination}
        isActivitySelectionMode={isActivitySelectionMode}
        onActivityClick={onActivityClick}
        hoveredActivityId={hoveredActivityId}
        selectedDayNumber={selectedDayNumber}
        highlightedLocationId={highlightedLocationId}
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
  selectedDayNumber?: number;
  highlightedLocationId?: string | null;
}

function HoverTooltip({ location }: { location: Location }) {
  return (
    <OverlayView
      position={{ lat: location.lat, lng: location.lng }}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={(width, height) => ({
        x: -(width / 2),
        y: -height - 45,
      })}
    >
      <div className="bg-white rounded-lg shadow-lg p-2 pointer-events-none min-w-[160px] max-w-[200px] border border-gray-200">
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
        <p className="font-medium text-sm text-gray-900 line-clamp-2">{location.name}</p>
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
  isActivitySelectionMode,
  onActivityClick,
  hoveredActivityId,
  selectedDayNumber,
  highlightedLocationId,
}: GoogleMapContentProps) {
  const [selectedMarker, setSelectedMarker] = useState<Location | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<Location | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [destinationCenter, setDestinationCenter] = useState<Coordinates | null>(null);

  const boundsSetRef = useRef(false);
  const prevLocationsCountRef = useRef(locations.length);
  const prevSelectedDayRef = useRef(selectedDayNumber);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries,
  });

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

  const locationsByDay = useMemo(() => {
    const locsByDay: Record<number, Location[]> = {};
    locations.forEach((loc) => {
      if (loc.day == null) return;
      if (!locsByDay[loc.day]) {
        locsByDay[loc.day] = [];
      }
      locsByDay[loc.day].push(loc);
    });

    Object.keys(locsByDay).forEach((dayNum) => {
      locsByDay[Number(dayNum)].sort((a, b) => {
        if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
        return a.actIndex - b.actIndex;
      });
    });
    return locsByDay;
  }, [locations]);

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

  useEffect(() => {
    if (locations.length !== prevLocationsCountRef.current || selectedDayNumber !== prevSelectedDayRef.current) {
      boundsSetRef.current = false;
      prevLocationsCountRef.current = locations.length;
      prevSelectedDayRef.current = selectedDayNumber;
    }
  }, [locations.length, selectedDayNumber]);

  useEffect(() => {
    if (map && locations.length > 0 && window.google && !boundsSetRef.current) {
      const bounds = new window.google.maps.LatLngBounds();
      locations.forEach((loc) => bounds.extend({ lat: loc.lat, lng: loc.lng }));
      map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
      boundsSetRef.current = true;
    }
  }, [map, locations]);

  // Pan to highlighted location
  useEffect(() => {
    if (map && highlightedLocationId && locations.length > 0) {
      const highlightedLoc = locations.find(l => l.activityId === highlightedLocationId);
      if (highlightedLoc) {
        map.panTo({ lat: highlightedLoc.lat, lng: highlightedLoc.lng });
        if (map.getZoom()! < 14) {
          map.setZoom(14);
        }
      }
    }
  }, [map, highlightedLocationId, locations]);

  const getMarkerIcon = (loc: Location): google.maps.Symbol => {
    const isHovered = loc.activityId === hoveredActivityId;
    const isHighlighted = loc.activityId === highlightedLocationId;

    if (isActivitySelectionMode) {
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

    return {
      path: "M12 0C7.58 0 4 3.58 4 8c0 5.25 8 13 8 13s8-7.75 8-13c0-4.42-3.58-8-8-8z",
      fillColor: getDayColor(loc.day),
      fillOpacity: 1,
      strokeColor: isHighlighted ? "#F59E0B" : (isHovered ? "#3B82F6" : "#ffffff"),
      strokeWeight: isHighlighted || isHovered ? 3 : 1,
      scale: isHighlighted ? 2.2 : (isHovered ? 1.8 : 1.5),
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

  const mapCenter =
    locations.length > 0
      ? { lat: locations[0].lat, lng: locations[0].lng }
      : destinationCenter || { lat: 37.7749, lng: -122.4194 };

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
      {!isActivitySelectionMode &&
        Object.entries(locationsByDay)
          .filter(
            ([dayNum, dayLocs]) =>
              dayLocs.length >= 2 && (!selectedDayNumber || parseInt(dayNum) === selectedDayNumber)
          )
          .map(([dayNum, dayLocs]) => (
            <Polyline
              key={`polyline-day-${dayNum}`}
              path={dayLocs.map((loc) => ({ lat: loc.lat, lng: loc.lng }))}
              options={{
                strokeColor: getDayColor(parseInt(dayNum)) || "#666666",
                strokeOpacity: 0.8,
                strokeWeight: 4,
              }}
            />
          ))}

      {locations.map((loc, idx) => (
        <Marker
          key={idx}
          position={{ lat: loc.lat, lng: loc.lng }}
          icon={getMarkerIcon(loc)}
          label={{
            text: (loc.actIndex + 1).toString(),
            color: "white",
            fontWeight: "bold",
            fontSize:
              loc.activityId === highlightedLocationId || loc.activityId === hoveredActivityId || !isActivitySelectionMode ? "11px" : "10px",
          }}
          onClick={() => {
            if (isActivitySelectionMode && onActivityClick && loc.activityId) {
              onActivityClick(loc.activityId);
            } else {
              setSelectedMarker(loc);
            }
          }}
          onMouseOver={() => setHoveredMarker(loc)}
          onMouseOut={() => setHoveredMarker(null)}
        />
      ))}

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
