"""
Google Places API client for attractions, restaurants, and hotels.
"""
import googlemaps
from typing import List, Dict, Any, Optional, Tuple
import config


class PlacesClient:
    """Client for Google Places API."""
    
    def __init__(self):
        api_key = config.GOOGLE_PLACES_API_KEY
        if not api_key:
            raise ValueError("GOOGLE_PLACES_API_KEY not set. Please add it to your .env file.")
        
        # Strip whitespace from API key
        api_key = api_key.strip()
        
        if not api_key:
            raise ValueError("GOOGLE_PLACES_API_KEY is empty. Please check your .env file.")
        
        try:
            self.client = googlemaps.Client(key=api_key)
        except ValueError as e:
            error_msg = str(e)
            if "Invalid API key" in error_msg:
                raise ValueError(
                    "Invalid Google Places API key. Please check:\n"
                    "1. The API key in your .env file is correct\n"
                    "2. The Places API is enabled in Google Cloud Console\n"
                    "3. The API key has no extra spaces or quotes\n"
                    "4. The API key has proper permissions for Places API"
                ) from e
            raise
    
    def search_places(
        self,
        query: str,
        location: Optional[Tuple[float, float]] = None,
        radius: int = 5000,
        place_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Search for places using Google Places API.
        
        Args:
            query: Search query (e.g., "tourist attractions in Paris")
            location: (lat, lng) tuple for location-based search
            radius: Search radius in meters
            place_type: Place type filter (e.g., "tourist_attraction", "restaurant", "lodging")
            
        Returns:
            List of place results
        """
        try:
            if location:
                # Nearby search
                places_result = self.client.places_nearby(
                    location=location,
                    radius=radius,
                    type=place_type,
                    keyword=query
                )
            else:
                # Text search
                places_result = self.client.places(query=query, type=place_type)
            
            places = []
            for place in places_result.get('results', [])[:10]:  # Limit to 10 results
                place_info = {
                    "name": place.get('name', ''),
                    "place_id": place.get('place_id', ''),
                    "types": place.get('types', []),
                    "rating": place.get('rating', 0.0),
                    "user_ratings_total": place.get('user_ratings_total', 0),
                    "location": place.get('geometry', {}).get('location', {}),
                    "vicinity": place.get('vicinity', ''),
                    "price_level": place.get('price_level', None)
                }
                places.append(place_info)
            
            return places
            
        except Exception as e:
            print(f"Error searching places: {e}")
            return []
    
    def get_place_details(self, place_id: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a place.
        
        Args:
            place_id: Google Places place_id
            
        Returns:
            Place details dictionary
        """
        try:
            place_details = self.client.place(place_id=place_id)
            result = place_details.get('result', {})
            
            details = {
                "name": result.get('name', ''),
                "formatted_address": result.get('formatted_address', ''),
                "formatted_phone_number": result.get('formatted_phone_number', ''),
                "website": result.get('website', ''),
                "rating": result.get('rating', 0.0),
                "user_ratings_total": result.get('user_ratings_total', 0),
                "opening_hours": result.get('opening_hours', {}),
                "price_level": result.get('price_level', None),
                "types": result.get('types', []),
                "geometry": result.get('geometry', {}),
                "photos": result.get('photos', [])[:3]  # Limit to 3 photos
            }
            
            return details
            
        except Exception as e:
            print(f"Error getting place details: {e}")
            return None
    
    def search_attractions(
        self,
        destination: str,
        location: Optional[Tuple[float, float]] = None
    ) -> List[Dict[str, Any]]:
        """Search for tourist attractions."""
        return self.search_places(
            query=f"tourist attractions {destination}",
            location=location,
            place_type="tourist_attraction"
        )
    
    def search_restaurants(
        self,
        destination: str,
        location: Optional[Tuple[float, float]] = None,
        cuisine_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search for restaurants."""
        query = f"restaurants {destination}"
        if cuisine_type:
            query = f"{cuisine_type} {query}"
        
        return self.search_places(
            query=query,
            location=location,
            place_type="restaurant"
        )
    
    def search_hotels(
        self,
        destination: str,
        location: Optional[Tuple[float, float]] = None
    ) -> List[Dict[str, Any]]:
        """Search for hotels/lodging."""
        return self.search_places(
            query=f"hotels {destination}",
            location=location,
            place_type="lodging"
        )
    
    def enrich_activity_with_places(
        self,
        activity_name: str,
        location: Tuple[float, float],
        activity_type: str = "tourist_attraction"
    ) -> Optional[Dict[str, Any]]:
        """
        Enrich an activity name with real place data.
        
        Args:
            activity_name: Name of the activity
            location: (lat, lng) tuple
            activity_type: Type of place to search for
            
        Returns:
            Enriched place data or None
        """
        places = self.search_places(
            query=activity_name,
            location=location,
            place_type=activity_type,
            radius=2000
        )
        
        if places:
            # Return the best match (highest rating)
            return max(places, key=lambda x: x.get('rating', 0))
        return None

