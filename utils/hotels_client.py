"""
Amadeus API client for hotel search.
"""
from typing import List, Dict, Any, Optional, Tuple
from datetime import date, datetime
import config
import random
import math

try:
    from amadeus import Client, ResponseError
    AMADEUS_AVAILABLE = True
except ImportError:
    AMADEUS_AVAILABLE = False
    ResponseError = Exception


class HotelsClient:
    """Client for Amadeus Hotel APIs."""

    def __init__(self):
        self.client = None
        self.use_mock_data = True

        # Initialize Amadeus client if credentials are available
        if AMADEUS_AVAILABLE and config.AMADEUS_CLIENT_ID and config.AMADEUS_CLIENT_SECRET:
            try:
                environment = 'production' if config.AMADEUS_ENVIRONMENT == 'production' else 'test'
                self.client = Client(
                    client_id=config.AMADEUS_CLIENT_ID,
                    client_secret=config.AMADEUS_CLIENT_SECRET,
                    hostname=environment
                )
                self.use_mock_data = False
            except Exception as e:
                print(f"Error initializing Amadeus client for hotels: {e}, using mock data")
                self.use_mock_data = True
        else:
            self.use_mock_data = True

    def _haversine_distance(
        self,
        lat1: float,
        lon1: float,
        lat2: float,
        lon2: float
    ) -> float:
        """
        Calculate the great-circle distance between two points on Earth.

        Args:
            lat1, lon1: Coordinates of point 1
            lat2, lon2: Coordinates of point 2

        Returns:
            Distance in kilometers
        """
        R = 6371  # Earth's radius in kilometers

        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)

        a = (math.sin(delta_lat / 2) ** 2 +
             math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return R * c

    def search_hotels(
        self,
        city_code: str,
        check_in_date: str,
        check_out_date: str,
        adults: int = 1,
        rooms: int = 1,
        landmark_coords: Optional[Tuple[float, float]] = None,
        radius: int = 50,
        radius_unit: str = "KM"
    ) -> List[Dict[str, Any]]:
        """
        Search for hotels using Amadeus API or fallback to mock data.

        Args:
            city_code: City IATA code (e.g., "PAR" for Paris)
            check_in_date: Check-in date (YYYY-MM-DD)
            check_out_date: Check-out date (YYYY-MM-DD)
            adults: Number of adults
            rooms: Number of rooms
            landmark_coords: Optional (lat, lng) tuple for distance calculation
            radius: Search radius
            radius_unit: "KM" or "MILE"

        Returns:
            List of hotel options with price and distance info
        """
        if self.use_mock_data:
            return self._generate_mock_hotels(
                city_code, check_in_date, check_out_date,
                adults, rooms, landmark_coords
            )

        try:
            # Step 1: Get hotels by city
            hotels_by_city = self.client.reference_data.locations.hotels.by_city.get(
                cityCode=city_code.upper(),
                radius=radius,
                radiusUnit=radius_unit
            )

            if not hotels_by_city.data:
                return self._generate_mock_hotels(
                    city_code, check_in_date, check_out_date,
                    adults, rooms, landmark_coords
                )

            # Limit to first 20 hotels to avoid too many API calls
            hotel_ids = [h.get('hotelId') for h in hotels_by_city.data[:20] if h.get('hotelId')]

            if not hotel_ids:
                return self._generate_mock_hotels(
                    city_code, check_in_date, check_out_date,
                    adults, rooms, landmark_coords
                )

            # Step 2: Get hotel offers for these hotels
            hotel_offers = self.client.shopping.hotel_offers_search.get(
                hotelIds=hotel_ids,
                checkInDate=check_in_date,
                checkOutDate=check_out_date,
                adults=adults,
                roomQuantity=rooms,
                currency='USD'
            )

            return self._parse_amadeus_hotels(
                hotels_by_city.data,
                hotel_offers.data,
                landmark_coords
            )

        except ResponseError as e:
            print(f"Amadeus Hotel API error: {e}")
            return self._generate_mock_hotels(
                city_code, check_in_date, check_out_date,
                adults, rooms, landmark_coords
            )
        except Exception as e:
            print(f"Error fetching hotels from Amadeus API: {e}")
            return self._generate_mock_hotels(
                city_code, check_in_date, check_out_date,
                adults, rooms, landmark_coords
            )

    def _parse_amadeus_hotels(
        self,
        hotels_data: List[Dict[str, Any]],
        offers_data: List[Dict[str, Any]],
        landmark_coords: Optional[Tuple[float, float]] = None
    ) -> List[Dict[str, Any]]:
        """Parse Amadeus hotel data into standardized format."""
        # Create a map of hotel info by ID
        hotel_info_map = {}
        for hotel in hotels_data:
            hotel_id = hotel.get('hotelId')
            if hotel_id:
                hotel_info_map[hotel_id] = {
                    'name': hotel.get('name', 'Unknown Hotel'),
                    'latitude': hotel.get('geoCode', {}).get('latitude'),
                    'longitude': hotel.get('geoCode', {}).get('longitude'),
                    'address': hotel.get('address', {}).get('lines', [''])[0] if hotel.get('address', {}).get('lines') else '',
                    'city': hotel.get('address', {}).get('cityName', ''),
                    'rating': hotel.get('rating', 0)
                }

        hotels = []
        for offer in offers_data:
            hotel = offer.get('hotel', {})
            hotel_id = hotel.get('hotelId')
            offers = offer.get('offers', [])

            if not offers:
                continue

            # Get the first (usually cheapest) offer
            first_offer = offers[0]
            price_info = first_offer.get('price', {})
            total_price = float(price_info.get('total', 0))
            currency = price_info.get('currency', 'USD')

            # Get hotel info from our map or from the offer
            info = hotel_info_map.get(hotel_id, {})
            name = info.get('name') or hotel.get('name', 'Unknown Hotel')
            lat = info.get('latitude') or hotel.get('latitude')
            lng = info.get('longitude') or hotel.get('longitude')

            # Calculate distance to landmark if coordinates available
            distance_km = None
            if landmark_coords and lat and lng:
                distance_km = self._haversine_distance(
                    landmark_coords[0], landmark_coords[1],
                    float(lat), float(lng)
                )

            # Get room info
            room = first_offer.get('room', {})
            room_type = room.get('typeEstimated', {}).get('category', 'Standard Room')

            hotel_data = {
                'hotel_id': hotel_id,
                'name': name,
                'address': info.get('address', ''),
                'city': info.get('city', ''),
                'rating': info.get('rating', hotel.get('rating', 0)),
                'latitude': lat,
                'longitude': lng,
                'price_per_night': total_price,
                'total_price': total_price,
                'currency': currency,
                'room_type': room_type,
                'distance_km': round(distance_km, 2) if distance_km else None,
                'amenities': [],
                'check_in_date': first_offer.get('checkInDate'),
                'check_out_date': first_offer.get('checkOutDate'),
                'amadeus_offer_id': first_offer.get('id')
            }

            hotels.append(hotel_data)

        # Sort by price
        hotels.sort(key=lambda x: x.get('price_per_night', float('inf')))

        return hotels

    def _generate_mock_hotels(
        self,
        city_code: str,
        check_in_date: str,
        check_out_date: str,
        adults: int,
        rooms: int,
        landmark_coords: Optional[Tuple[float, float]] = None
    ) -> List[Dict[str, Any]]:
        """Generate mock hotel data for testing/demo purposes."""
        hotel_chains = [
            "Marriott", "Hilton", "Hyatt", "InterContinental",
            "Radisson", "Best Western", "Holiday Inn", "Sheraton",
            "Westin", "Four Seasons", "Ritz-Carlton", "W Hotels"
        ]

        hotel_types = [
            "Hotel", "Inn", "Resort", "Suites", "Plaza", "Grand Hotel"
        ]

        room_types = [
            "Standard Room", "Deluxe Room", "Superior Room",
            "Executive Suite", "Junior Suite", "Family Room"
        ]

        # Calculate number of nights
        try:
            check_in = datetime.strptime(check_in_date, "%Y-%m-%d")
            check_out = datetime.strptime(check_out_date, "%Y-%m-%d")
            nights = (check_out - check_in).days
        except:
            nights = 1

        hotels = []
        num_hotels = random.randint(8, 15)

        # City center coordinates (mock - slightly randomized around landmark or default)
        if landmark_coords:
            center_lat, center_lng = landmark_coords
        else:
            # Default to a central location
            center_lat, center_lng = 48.8566, 2.3522  # Paris as default

        for i in range(num_hotels):
            chain = random.choice(hotel_chains)
            hotel_type = random.choice(hotel_types)
            name = f"{chain} {hotel_type} {city_code}"

            # Generate random coordinates within ~10km of center
            lat_offset = random.uniform(-0.05, 0.05)
            lng_offset = random.uniform(-0.05, 0.05)
            lat = center_lat + lat_offset
            lng = center_lng + lng_offset

            # Calculate distance to landmark
            distance_km = None
            if landmark_coords:
                distance_km = self._haversine_distance(
                    landmark_coords[0], landmark_coords[1],
                    lat, lng
                )

            # Base price varies by hotel "tier"
            tier = random.choice(['budget', 'mid', 'upscale', 'luxury'])
            base_prices = {
                'budget': random.randint(60, 100),
                'mid': random.randint(100, 180),
                'upscale': random.randint(180, 350),
                'luxury': random.randint(350, 800)
            }
            price_per_night = base_prices[tier]

            # Adjust price based on distance (closer to landmark = more expensive)
            if distance_km and distance_km < 2:
                price_per_night = int(price_per_night * 1.3)
            elif distance_km and distance_km < 5:
                price_per_night = int(price_per_night * 1.1)

            total_price = price_per_night * nights * rooms

            # Rating based on tier
            rating_ranges = {
                'budget': (2.5, 3.5),
                'mid': (3.5, 4.0),
                'upscale': (4.0, 4.5),
                'luxury': (4.5, 5.0)
            }
            rating = round(random.uniform(*rating_ranges[tier]), 1)

            amenities = []
            if tier in ['upscale', 'luxury']:
                amenities = ['Free WiFi', 'Pool', 'Spa', 'Gym', 'Restaurant', 'Room Service']
            elif tier == 'mid':
                amenities = ['Free WiFi', 'Gym', 'Restaurant', 'Parking']
            else:
                amenities = ['Free WiFi', 'Parking']

            hotel_data = {
                'hotel_id': f"MOCK_{i}_{city_code}",
                'name': name,
                'address': f"{random.randint(1, 200)} {random.choice(['Main St', 'Central Ave', 'Park Blvd', 'Market St'])}",
                'city': city_code,
                'rating': rating,
                'latitude': round(lat, 6),
                'longitude': round(lng, 6),
                'price_per_night': price_per_night,
                'total_price': total_price,
                'currency': 'USD',
                'room_type': random.choice(room_types),
                'distance_km': round(distance_km, 2) if distance_km else round(random.uniform(0.5, 10), 2),
                'amenities': amenities,
                'tier': tier,
                'check_in_date': check_in_date,
                'check_out_date': check_out_date
            }

            hotels.append(hotel_data)

        # Sort by price
        hotels.sort(key=lambda x: x['price_per_night'])

        return hotels

    def get_best_hotel(
        self,
        city_code: str,
        check_in_date: str,
        check_out_date: str,
        adults: int = 1,
        rooms: int = 1,
        landmark_coords: Optional[Tuple[float, float]] = None,
        preference: str = "price"
    ) -> Optional[Dict[str, Any]]:
        """
        Get the best hotel option based on preference.

        Args:
            preference: "price" (cheapest), "distance" (closest), "rating" (highest rated)
        """
        hotels = self.search_hotels(
            city_code, check_in_date, check_out_date,
            adults, rooms, landmark_coords
        )

        if not hotels:
            return None

        if preference == "price":
            return min(hotels, key=lambda x: x.get('price_per_night', float('inf')))
        elif preference == "distance":
            return min(hotels, key=lambda x: x.get('distance_km', float('inf')))
        elif preference == "rating":
            return max(hotels, key=lambda x: x.get('rating', 0))

        return hotels[0]
