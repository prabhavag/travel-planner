"""
Geocoding utilities for converting addresses to coordinates.
"""
import googlemaps
from typing import Optional, Tuple
import config


class GeocodingService:
    """Geocoding service using Google Geocoding API."""
    
    def __init__(self):
        api_key = config.GOOGLE_GEOCODING_API_KEY
        if not api_key:
            raise ValueError("GOOGLE_GEOCODING_API_KEY not set. Please add it to your .env file.")
        
        # Strip whitespace from API key
        api_key = api_key.strip()
        
        if not api_key:
            raise ValueError("GOOGLE_GEOCODING_API_KEY is empty. Please check your .env file.")
        
        try:
            self.client = googlemaps.Client(key=api_key)
        except ValueError as e:
            error_msg = str(e)
            if "Invalid API key" in error_msg:
                raise ValueError(
                    "Invalid Google Geocoding API key. Please check:\n"
                    "1. The API key in your .env file is correct\n"
                    "2. The Geocoding API is enabled in Google Cloud Console\n"
                    "3. The API key has no extra spaces or quotes\n"
                    "4. The API key has proper permissions for Geocoding API"
                ) from e
            raise
    
    def geocode(self, address: str) -> Optional[Tuple[float, float]]:
        """
        Geocode an address to latitude and longitude.
        
        Args:
            address: Address string (e.g., "New York, NY")
            
        Returns:
            Tuple of (latitude, longitude) or None if not found
        """
        try:
            geocode_result = self.client.geocode(address)
            if geocode_result:
                location = geocode_result[0]['geometry']['location']
                return (location['lat'], location['lng'])
            return None
        except Exception as e:
            print(f"Geocoding error for '{address}': {e}")
            return None
    
    def reverse_geocode(self, lat: float, lng: float) -> Optional[str]:
        """
        Reverse geocode coordinates to an address.
        
        Args:
            lat: Latitude
            lng: Longitude
            
        Returns:
            Formatted address string or None
        """
        try:
            reverse_result = self.client.reverse_geocode((lat, lng))
            if reverse_result:
                return reverse_result[0]['formatted_address']
            return None
        except Exception as e:
            print(f"Reverse geocoding error: {e}")
            return None


def get_coordinates(location: str) -> Optional[Tuple[float, float]]:
    """Convenience function to get coordinates for a location."""
    service = GeocodingService()
    return service.geocode(location)

