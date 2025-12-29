"""
Map display utilities for showing itinerary on an interactive Google Map.
"""
from typing import List, Dict, Any, Optional, Tuple
import json
import urllib.parse
import config


def create_static_map_url(
    places: List[Dict[str, Any]],
    width: int = 800,
    height: int = 500
) -> str:
    """
    Create a Google Maps Static API URL with markers.
    This is a fallback when the JavaScript API is not available.
    """
    api_key = config.GOOGLE_PLACES_API_KEY or ""

    # Filter places with valid coordinates
    valid_places = [
        p for p in places
        if p.get('latitude') and p.get('longitude')
    ]

    if not valid_places:
        return ""

    # Day colors for markers (Static API uses color names or hex without #)
    day_colors = ['red', 'blue', 'green', 'purple', 'orange', '0x1abc9c', 'pink', '0x00bcd4']

    # Build markers parameter
    markers_params = []
    for i, place in enumerate(valid_places):
        day = place.get('day', 1)
        color = day_colors[(day - 1) % len(day_colors)]
        label = str(i + 1) if i < 9 else ""  # Labels only support single chars
        lat = place['latitude']
        lng = place['longitude']
        markers_params.append(f"color:{color}|label:{label}|{lat},{lng}")

    # Build path parameter to connect markers
    path_coords = "|".join([f"{p['latitude']},{p['longitude']}" for p in valid_places])

    # Construct URL
    base_url = "https://maps.googleapis.com/maps/api/staticmap"
    params = {
        'size': f'{width}x{height}',
        'maptype': 'roadmap',
        'key': api_key,
        'path': f'color:0x3498db|weight:3|{path_coords}'
    }

    url = f"{base_url}?{'&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in params.items())}"

    # Add markers (each as separate parameter)
    for marker in markers_params[:25]:  # Limit to 25 markers for URL length
        url += f"&markers={urllib.parse.quote(marker)}"

    return url


def create_leaflet_map_html(
    places: List[Dict[str, Any]],
    center: Optional[Tuple[float, float]] = None,
    zoom: int = 12,
    height: int = 500
) -> str:
    """
    Create an interactive map using Leaflet and OpenStreetMap (no API key required).
    Used as a fallback when Google Maps API key is not available.
    """
    # Calculate center if not provided
    if center is None:
        avg_lat = sum(p['latitude'] for p in places) / len(places)
        avg_lng = sum(p['longitude'] for p in places) / len(places)
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
        for i, p in enumerate(places)
    ])

    day_colors_json = json.dumps(day_colors)

    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
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
            .custom-marker {{
                background: white;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                text-align: center;
                line-height: 24px;
                font-weight: bold;
                font-size: 12px;
                color: white;
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

            // Initialize map
            const map = L.map('map').setView([{center[0]}, {center[1]}], {zoom});

            // Add OpenStreetMap tiles
            L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
                attribution: '© OpenStreetMap contributors'
            }}).addTo(map);

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
                    const path = dayPlaces.map(p => [p.lat, p.lng]);
                    const color = dayColors[(day - 1) % dayColors.length];
                    L.polyline(path, {{
                        color: color,
                        weight: 3,
                        opacity: 0.8
                    }}).addTo(map);
                }}
            }});

            // Add markers
            const markers = [];
            places.forEach((place, index) => {{
                const color = dayColors[(place.day - 1) % dayColors.length];

                // Create custom icon
                const icon = L.divIcon({{
                    className: 'custom-marker',
                    html: `<div style="background: ${{color}}; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${{place.index}}</div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                }});

                const marker = L.marker([place.lat, place.lng], {{ icon: icon }}).addTo(map);

                // Create popup content
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
                content += `<span class="day-badge" style="background: ${{color}}">Day ${{place.day}}</span>`;
                if (place.time) {{
                    content += `<span class="time-badge">${{timeIcon}} ${{place.time.charAt(0).toUpperCase() + place.time.slice(1)}}</span>`;
                }}
                content += `<h3>${{place.name}}</h3>`;
                if (place.description) {{
                    content += `<p>${{place.description}}</p>`;
                }}
                content += '</div>';

                marker.bindPopup(content);
                markers.push(marker);
            }});

            // Fit bounds to show all markers
            if (places.length > 1) {{
                const group = L.featureGroup(markers);
                map.fitBounds(group.getBounds().pad(0.1));
            }}

            // Add legend
            const legend = L.control({{ position: 'bottomleft' }});
            legend.onAdd = function(map) {{
                const div = L.DomUtil.create('div', 'legend');
                div.innerHTML = '<div class="legend-title">Itinerary</div>';

                const uniqueDays = [...new Set(places.map(p => p.day))].sort((a, b) => a - b);
                uniqueDays.forEach(day => {{
                    const color = dayColors[(day - 1) % dayColors.length];
                    div.innerHTML += `
                        <div class="legend-item">
                            <div class="legend-color" style="background: ${{color}}"></div>
                            <span>Day ${{day}}</span>
                        </div>
                    `;
                }});
                return div;
            }};
            legend.addTo(map);
        </script>
    </body>
    </html>
    '''

    return html


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

    # Use Leaflet as fallback if no API key
    if not api_key:
        return create_leaflet_map_html(valid_places, center, zoom, height)

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

            // Error handler for Google Maps API
            function gm_authFailure() {{
                document.getElementById('map').innerHTML = `
                    <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f8d7da; border-radius: 8px; padding: 20px; text-align: center;">
                        <p style="color: #721c24; font-weight: bold;">Google Maps API Error</p>
                        <p style="color: #721c24; font-size: 14px;">Please check:</p>
                        <ul style="color: #721c24; font-size: 12px; text-align: left;">
                            <li>Maps JavaScript API is enabled in Google Cloud Console</li>
                            <li>Billing is enabled for your project</li>
                            <li>API key has no restrictive referrer/IP settings</li>
                        </ul>
                    </div>
                `;
            }}

            window.gm_authFailure = gm_authFailure;
        </script>
        <script async defer
            src="https://maps.googleapis.com/maps/api/js?key={api_key}&callback=initMap"
            onerror="document.getElementById('map').innerHTML='<div style=\\'height:100%;display:flex;align-items:center;justify-content:center;background:#fff3cd;border-radius:8px;\\'><p style=\\'color:#856404;\\'>Failed to load Google Maps. Check your internet connection.</p></div>'">
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


def create_day_map(
    places: List[Dict[str, Any]],
    day_number: int,
    height: int = 250
) -> str:
    """
    Create a small map for a single day's itinerary.

    Args:
        places: List of place dictionaries for this day
        day_number: The day number (for color coding)
        height: Map height in pixels (default 250 for compact view)

    Returns:
        HTML string for the day's map
    """
    if not places:
        return ""

    # Filter places with valid coordinates
    valid_places = [
        p for p in places
        if p.get('latitude') and p.get('longitude')
    ]

    if not valid_places:
        return ""

    api_key = config.GOOGLE_PLACES_API_KEY or ""

    # Day colors
    day_colors = [
        '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
        '#f39c12', '#1abc9c', '#e91e63', '#00bcd4'
    ]
    day_color = day_colors[(day_number - 1) % len(day_colors)]

    # Calculate center
    avg_lat = sum(p['latitude'] for p in valid_places) / len(valid_places)
    avg_lng = sum(p['longitude'] for p in valid_places) / len(valid_places)

    # Prepare places data for JavaScript
    places_json = json.dumps([
        {
            'lat': p['latitude'],
            'lng': p['longitude'],
            'name': p.get('name', 'Unknown'),
            'description': p.get('description', '')[:150] if p.get('description') else '',
            'photo_url': p.get('photo_url', ''),
            'time': p.get('time', ''),
            'index': i + 1
        }
        for i, p in enumerate(valid_places)
    ])

    # Use Leaflet if no API key
    if not api_key:
        return _create_day_map_leaflet(valid_places, day_number, day_color, height)

    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            #map-day-{day_number} {{
                height: {height}px;
                width: 100%;
                border-radius: 8px;
            }}
            .info-window {{
                max-width: 200px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }}
            .info-window img {{
                width: 100%;
                height: 80px;
                object-fit: cover;
                border-radius: 6px;
                margin-bottom: 6px;
            }}
            .info-window h3 {{
                margin: 0 0 4px 0;
                font-size: 13px;
                color: #333;
            }}
            .info-window .time-badge {{
                display: inline-block;
                background: {day_color};
                color: white;
                padding: 2px 6px;
                border-radius: 10px;
                font-size: 10px;
                margin-bottom: 4px;
            }}
            .info-window p {{
                margin: 4px 0 0 0;
                color: #666;
                font-size: 11px;
                line-height: 1.3;
            }}
        </style>
    </head>
    <body>
        <div id="map-day-{day_number}"></div>
        <script>
            const places_{day_number} = {places_json};
            const dayColor_{day_number} = '{day_color}';
            let map_{day_number};

            function initMap_{day_number}() {{
                map_{day_number} = new google.maps.Map(document.getElementById('map-day-{day_number}'), {{
                    center: {{ lat: {avg_lat}, lng: {avg_lng} }},
                    zoom: 13,
                    styles: [{{ featureType: "poi", elementType: "labels", stylers: [{{ visibility: "off" }}] }}],
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false,
                    zoomControl: true
                }});

                const infoWindow = new google.maps.InfoWindow();
                const markers = [];

                // Draw path connecting places
                if (places_{day_number}.length > 1) {{
                    const path = places_{day_number}.map(p => ({{ lat: p.lat, lng: p.lng }}));
                    new google.maps.Polyline({{
                        path: path,
                        geodesic: true,
                        strokeColor: dayColor_{day_number},
                        strokeOpacity: 0.8,
                        strokeWeight: 3,
                        map: map_{day_number}
                    }});
                }}

                // Add markers
                places_{day_number}.forEach((place, index) => {{
                    const marker = new google.maps.Marker({{
                        position: {{ lat: place.lat, lng: place.lng }},
                        map: map_{day_number},
                        title: place.name,
                        label: {{
                            text: String(place.index),
                            color: 'white',
                            fontSize: '11px',
                            fontWeight: 'bold'
                        }},
                        icon: {{
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 12,
                            fillColor: dayColor_{day_number},
                            fillOpacity: 1,
                            strokeColor: 'white',
                            strokeWeight: 2
                        }}
                    }});

                    const timeIcons = {{ 'morning': '🌅', 'afternoon': '☀️', 'evening': '🌙' }};
                    const timeIcon = timeIcons[place.time.toLowerCase()] || '📍';

                    let content = '<div class="info-window">';
                    if (place.photo_url) {{
                        content += `<img src="${{place.photo_url}}" onerror="this.style.display='none'" />`;
                    }}
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
                        infoWindow.open(map_{day_number}, marker);
                    }});

                    markers.push(marker);
                }});

                // Fit bounds
                if (places_{day_number}.length > 1) {{
                    const bounds = new google.maps.LatLngBounds();
                    places_{day_number}.forEach(place => bounds.extend({{ lat: place.lat, lng: place.lng }}));
                    map_{day_number}.fitBounds(bounds, {{ padding: 30 }});
                }}
            }}

            // Initialize when Google Maps is ready
            if (typeof google !== 'undefined' && google.maps) {{
                initMap_{day_number}();
            }} else {{
                window.initMap_{day_number} = initMap_{day_number};
            }}
        </script>
        <script async defer
            src="https://maps.googleapis.com/maps/api/js?key={api_key}&callback=initMap_{day_number}">
        </script>
    </body>
    </html>
    '''

    return html


def _create_day_map_leaflet(
    places: List[Dict[str, Any]],
    day_number: int,
    day_color: str,
    height: int
) -> str:
    """Create a day map using Leaflet (fallback when no Google API key)."""
    avg_lat = sum(p['latitude'] for p in places) / len(places)
    avg_lng = sum(p['longitude'] for p in places) / len(places)

    places_json = json.dumps([
        {
            'lat': p['latitude'],
            'lng': p['longitude'],
            'name': p.get('name', 'Unknown'),
            'description': p.get('description', '')[:150] if p.get('description') else '',
            'photo_url': p.get('photo_url', ''),
            'time': p.get('time', ''),
            'index': i + 1
        }
        for i, p in enumerate(places)
    ])

    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
            #map-day-{day_number} {{ height: {height}px; width: 100%; border-radius: 8px; }}
            .info-window {{ max-width: 200px; font-family: sans-serif; }}
            .info-window img {{ width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 6px; }}
            .info-window h3 {{ margin: 0 0 4px 0; font-size: 13px; }}
            .info-window p {{ margin: 4px 0 0 0; font-size: 11px; color: #666; }}
        </style>
    </head>
    <body>
        <div id="map-day-{day_number}"></div>
        <script>
            const places = {places_json};
            const dayColor = '{day_color}';
            const map = L.map('map-day-{day_number}').setView([{avg_lat}, {avg_lng}], 13);
            L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
                attribution: '© OpenStreetMap'
            }}).addTo(map);

            if (places.length > 1) {{
                const path = places.map(p => [p.lat, p.lng]);
                L.polyline(path, {{ color: dayColor, weight: 3, opacity: 0.8 }}).addTo(map);
            }}

            const markers = [];
            places.forEach((place, index) => {{
                const icon = L.divIcon({{
                    className: '',
                    html: `<div style="background: ${{dayColor}}; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); color: white; font-weight: bold; font-size: 11px;">${{place.index}}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                }});

                const marker = L.marker([place.lat, place.lng], {{ icon }}).addTo(map);
                let content = '<div class="info-window">';
                if (place.photo_url) content += `<img src="${{place.photo_url}}" onerror="this.style.display='none'" />`;
                content += `<h3>${{place.name}}</h3>`;
                if (place.description) content += `<p>${{place.description}}</p>`;
                content += '</div>';
                marker.bindPopup(content);
                markers.push(marker);
            }});

            if (places.length > 1) {{
                const group = L.featureGroup(markers);
                map.fitBounds(group.getBounds().pad(0.1));
            }}
        </script>
    </body>
    </html>
    '''
    return html


def extract_places_from_day(day, places_client=None) -> List[Dict[str, Any]]:
    """
    Extract places with coordinates from a single DayItinerary.

    Args:
        day: DayItinerary object
        places_client: Optional PlacesClient for fetching coordinates and photos

    Returns:
        List of place dictionaries with coordinates for this day
    """
    places = []
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
