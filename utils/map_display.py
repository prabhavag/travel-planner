"""
Map display utilities for showing itinerary on an interactive Google Map.
"""
from typing import List, Dict, Any, Optional, Tuple
import json
import config


def create_google_maps_html(
    places: List[Dict[str, Any]],
    center: Optional[Tuple[float, float]] = None,
    zoom: int = 12,
    height: int = 500
) -> str:
    """
    Create an interactive Google Map showing itinerary places with markers and connections.

    Args:
        places: List of place dictionaries with keys:
            - name: Place name
            - latitude: Latitude coordinate
            - longitude: Longitude coordinate
            - description: Optional description
            - photo_url: Optional photo URL
            - day: Optional day number
            - time: Optional time of day (morning/afternoon/evening)
        center: Optional (lat, lng) tuple for map center
        zoom: Initial zoom level
        height: Map height in pixels

    Returns:
        HTML string for the Google Map
    """
    api_key = config.GOOGLE_PLACES_API_KEY or ""

    # Filter places with valid coordinates
    valid_places = [
        p for p in places
        if p.get('latitude') and p.get('longitude')
    ]

    if not valid_places:
        return f'<div style="height: {height}px; display: flex; align-items: center; justify-content: center; background: #f0f0f0; border-radius: 8px;"><p>No location data available for map</p></div>'

    # Calculate center if not provided
    if center is None:
        avg_lat = sum(p['latitude'] for p in valid_places) / len(valid_places)
        avg_lng = sum(p['longitude'] for p in valid_places) / len(valid_places)
        center = (avg_lat, avg_lng)

    # Day colors
    day_colors = [
        '#e74c3c',  # Day 1 - Red
        '#3498db',  # Day 2 - Blue
        '#2ecc71',  # Day 3 - Green
        '#9b59b6',  # Day 4 - Purple
        '#f39c12',  # Day 5 - Orange
        '#1abc9c',  # Day 6 - Teal
        '#e91e63',  # Day 7 - Pink
        '#00bcd4',  # Day 8 - Cyan
    ]

    # Prepare places data for JavaScript
    places_json = json.dumps([
        {
            'lat': p['latitude'],
            'lng': p['longitude'],
            'name': p.get('name', 'Unknown'),
            'description': p.get('description', '')[:200] if p.get('description') else '',
            'photo_url': p.get('photo_url', ''),
            'day': p.get('day', 1),
            'time': p.get('time', ''),
            'index': i + 1
        }
        for i, p in enumerate(valid_places)
    ])

    day_colors_json = json.dumps(day_colors)

    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            #map {{
                height: {height}px;
                width: 100%;
                border-radius: 8px;
            }}
            .info-window {{
                max-width: 280px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }}
            .info-window img {{
                width: 100%;
                height: 120px;
                object-fit: cover;
                border-radius: 8px;
                margin-bottom: 8px;
            }}
            .info-window h3 {{
                margin: 0 0 4px 0;
                font-size: 14px;
                color: #333;
            }}
            .info-window .day-badge {{
                display: inline-block;
                background: #3498db;
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                margin-bottom: 4px;
            }}
            .info-window .time-badge {{
                color: #666;
                font-size: 12px;
                margin-left: 8px;
            }}
            .info-window p {{
                margin: 8px 0 0 0;
                color: #666;
                font-size: 12px;
                line-height: 1.4;
            }}
            .legend {{
                background: white;
                padding: 10px 14px;
                border-radius: 8px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
            }}
            .legend-title {{
                font-weight: bold;
                margin-bottom: 8px;
            }}
            .legend-item {{
                display: flex;
                align-items: center;
                margin: 4px 0;
            }}
            .legend-color {{
                width: 14px;
                height: 14px;
                border-radius: 50%;
                margin-right: 8px;
            }}
        </style>
    </head>
    <body>
        <div id="map"></div>
        <script>
            const places = {places_json};
            const dayColors = {day_colors_json};
            let map;
            let markers = [];
            let infoWindow;

            function initMap() {{
                map = new google.maps.Map(document.getElementById('map'), {{
                    center: {{ lat: {center[0]}, lng: {center[1]} }},
                    zoom: {zoom},
                    styles: [
                        {{
                            featureType: "poi",
                            elementType: "labels",
                            stylers: [{{ visibility: "off" }}]
                        }}
                    ],
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: true
                }});

                infoWindow = new google.maps.InfoWindow();

                // Group places by day for polylines
                const placesByDay = {{}};
                places.forEach(place => {{
                    const day = place.day || 1;
                    if (!placesByDay[day]) placesByDay[day] = [];
                    placesByDay[day].push(place);
                }});

                // Draw polylines for each day
                Object.keys(placesByDay).forEach(day => {{
                    const dayPlaces = placesByDay[day];
                    if (dayPlaces.length > 1) {{
                        const path = dayPlaces.map(p => ({{ lat: p.lat, lng: p.lng }}));
                        const color = dayColors[(day - 1) % dayColors.length];

                        new google.maps.Polyline({{
                            path: path,
                            geodesic: true,
                            strokeColor: color,
                            strokeOpacity: 0.8,
                            strokeWeight: 3,
                            map: map
                        }});
                    }}
                }});

                // Add markers
                places.forEach((place, index) => {{
                    const color = dayColors[(place.day - 1) % dayColors.length];

                    // Create custom marker with number
                    const marker = new google.maps.Marker({{
                        position: {{ lat: place.lat, lng: place.lng }},
                        map: map,
                        title: place.name,
                        label: {{
                            text: String(place.index),
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: 'bold'
                        }},
                        icon: {{
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 14,
                            fillColor: color,
                            fillOpacity: 1,
                            strokeColor: 'white',
                            strokeWeight: 2
                        }}
                    }});

                    // Create info window content
                    const timeIcons = {{
                        'morning': '🌅',
                        'afternoon': '☀️',
                        'evening': '🌙'
                    }};
                    const timeIcon = timeIcons[place.time.toLowerCase()] || '📍';

                    let content = '<div class="info-window">';
                    if (place.photo_url) {{
                        content += `<img src="${{place.photo_url}}" onerror="this.style.display='none'" />`;
                    }}
                    content += `<span class="day-badge">Day ${{place.day}}</span>`;
                    if (place.time) {{
                        content += `<span class="time-badge">${{timeIcon}} ${{place.time.charAt(0).toUpperCase() + place.time.slice(1)}}</span>`;
                    }}
                    content += `<h3>${{place.name}}</h3>`;
                    if (place.description) {{
                        content += `<p>${{place.description}}</p>`;
                    }}
                    content += '</div>';

                    marker.addListener('click', () => {{
                        infoWindow.setContent(content);
                        infoWindow.open(map, marker);
                    }});

                    markers.push(marker);
                }});

                // Fit bounds to show all markers
                if (places.length > 1) {{
                    const bounds = new google.maps.LatLngBounds();
                    places.forEach(place => {{
                        bounds.extend({{ lat: place.lat, lng: place.lng }});
                    }});
                    map.fitBounds(bounds, {{ padding: 50 }});
                }}

                // Add legend
                const legendDiv = document.createElement('div');
                legendDiv.className = 'legend';
                legendDiv.innerHTML = '<div class="legend-title">Itinerary</div>';

                const uniqueDays = [...new Set(places.map(p => p.day))].sort((a, b) => a - b);
                uniqueDays.forEach(day => {{
                    const color = dayColors[(day - 1) % dayColors.length];
                    legendDiv.innerHTML += `
                        <div class="legend-item">
                            <div class="legend-color" style="background: ${{color}}"></div>
                            <span>Day ${{day}}</span>
                        </div>
                    `;
                }});

                map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(legendDiv);
            }}
        </script>
        <script async defer
            src="https://maps.googleapis.com/maps/api/js?key={api_key}&callback=initMap">
        </script>
    </body>
    </html>
    '''

    return html


def extract_places_from_plan(plan, places_client=None) -> List[Dict[str, Any]]:
    """
    Extract places with coordinates from a TravelPlan for map display.

    Args:
        plan: TravelPlan object
        places_client: Optional PlacesClient for fetching coordinates and photos

    Returns:
        List of place dictionaries with coordinates
    """
    places = []

    if not plan or not plan.itinerary:
        return places

    for day in plan.itinerary:
        day_num = day.day_number

        # Process morning activities
        for activity in day.morning:
            place = _extract_place_info(activity, day_num, 'morning', places_client)
            if place:
                places.append(place)

        # Process afternoon activities
        for activity in day.afternoon:
            place = _extract_place_info(activity, day_num, 'afternoon', places_client)
            if place:
                places.append(place)

        # Process evening activities
        for activity in day.evening:
            place = _extract_place_info(activity, day_num, 'evening', places_client)
            if place:
                places.append(place)

    return places


def _extract_place_info(
    activity,
    day: int,
    time_of_day: str,
    places_client=None
) -> Optional[Dict[str, Any]]:
    """Extract place info from an activity."""

    place = {
        'name': activity.name,
        'description': activity.description or '',
        'day': day,
        'time': time_of_day,
        'latitude': None,
        'longitude': None,
        'photo_url': None
    }

    # Try to get coordinates and photo from Google Places
    if places_client:
        try:
            # Build search query
            query = activity.name
            if activity.location:
                query = f"{activity.name} {activity.location}"

            # Search for the place
            place_info = places_client.get_place_with_photo(query)

            if place_info:
                place['latitude'] = place_info.get('latitude')
                place['longitude'] = place_info.get('longitude')
                place['photo_url'] = place_info.get('photo_url')

        except Exception as e:
            print(f"Error fetching place info for {activity.name}: {e}")

    # Return None if no coordinates found
    if place['latitude'] is None or place['longitude'] is None:
        return None

    return place


# Keep the old function name for backward compatibility
def create_itinerary_map(places: List[Dict[str, Any]], **kwargs) -> str:
    """Backward compatible wrapper for create_google_maps_html."""
    return create_google_maps_html(places, **kwargs)
