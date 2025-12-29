"""
Amadeus API client for flight search and booking.
"""
from typing import List, Dict, Any, Optional
from datetime import date, datetime
import config
import random

try:
    from amadeus import Client, ResponseError
    AMADEUS_AVAILABLE = True
except ImportError:
    AMADEUS_AVAILABLE = False
    ResponseError = Exception


class FlightsClient:
    """Client for Amadeus Flight APIs."""
    
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
                    hostname=environment  # 'test' or 'production'
                )
                self.use_mock_data = False
            except Exception as e:
                print(f"Error initializing Amadeus client: {e}, using mock data")
                self.use_mock_data = True
        else:
            if not AMADEUS_AVAILABLE:
                print("Amadeus SDK not installed. Install with: pip install amadeus")
            self.use_mock_data = True
    
    def search_flights(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        return_date: Optional[str] = None,
        passengers: int = 1,
        class_type: str = "economy"
    ) -> List[Dict[str, Any]]:
        """
        Search for flights using Amadeus API or fallback to mock data.
        
        Args:
            origin: Origin city/airport IATA code (e.g., "NYC", "JFK")
            destination: Destination city/airport IATA code (e.g., "PAR", "CDG")
            departure_date: Departure date (YYYY-MM-DD)
            return_date: Return date (YYYY-MM-DD) - optional for one-way
            passengers: Number of passengers
            class_type: "economy", "premium_economy", "business", "first"
            
        Returns:
            List of flight options in standardized format
        """
        # If no API client available, use mock data
        if self.use_mock_data:
            return self._generate_mock_flights(
                origin, destination, departure_date, passengers, class_type, return_date
            )
        
        # Try to fetch from Amadeus API
        try:
            # Map class_type to Amadeus travel class
            travel_class_map = {
                "economy": "ECONOMY",
                "premium_economy": "PREMIUM_ECONOMY",
                "business": "BUSINESS",
                "first": "FIRST"
            }
            amadeus_class = travel_class_map.get(class_type.lower(), "ECONOMY")
            
            # Build request parameters
            params = {
                'originLocationCode': origin.upper(),
                'destinationLocationCode': destination.upper(),
                'departureDate': departure_date,
                'adults': passengers,
                'travelClass': amadeus_class,
                'currencyCode': 'USD',
                'max': 50  # Maximum number of results
            }
            
            # Add return date if provided
            if return_date:
                params['returnDate'] = return_date
            
            # Call Amadeus Flight Offers Search API
            response = self.client.shopping.flight_offers_search.get(**params)
            
            # Amadeus SDK returns response object with .data attribute on success
            # If there's an error, it raises ResponseError exception
            data = response.data
            return self._parse_amadeus_flights(data, return_date)
                
        except ResponseError as e:
            print(f"Amadeus API error: {e}")
            # Fallback to mock data on API error
            return self._generate_mock_flights(
                origin, destination, departure_date, passengers, class_type, return_date
            )
        except Exception as e:
            print(f"Error fetching flights from Amadeus API (using mock data): {e}")
            # Fallback to mock data on connection/other errors
            return self._generate_mock_flights(
                origin, destination, departure_date, passengers, class_type, return_date
            )
    
    def _parse_amadeus_flights(
        self,
        amadeus_data: List[Dict[str, Any]],
        return_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Parse Amadeus API response into standardized format.
        
        Args:
            amadeus_data: List of flight offers from Amadeus API
            return_date: Return date if it's a return trip
            
        Returns:
            List of flights in standardized format
        """
        flights = []
        
        for offer in amadeus_data:
            # Extract itinerary segments
            itineraries = offer.get('itineraries', [])
            if not itineraries:
                continue
            
            # Parse outbound flight (first itinerary)
            outbound_itinerary = itineraries[0]
            outbound_segments = outbound_itinerary.get('segments', [])
            if not outbound_segments:
                continue
            
            # Get first and last segments for outbound departure/arrival
            outbound_first_segment = outbound_segments[0]
            outbound_last_segment = outbound_segments[-1]
            
            # Extract pricing information
            price_data = offer.get('price', {})
            total_price = float(price_data.get('total', 0))
            currency = price_data.get('currency', 'USD')
            
            # Calculate outbound duration
            outbound_duration = outbound_itinerary.get('duration', '')
            
            # Count outbound stops (segments - 1)
            outbound_stops = len(outbound_segments) - 1
            
            # Extract outbound airline information
            outbound_carrier_code = outbound_first_segment.get('carrierCode', '')
            outbound_flight_number = outbound_first_segment.get('number', '')
            
            # Extract outbound times
            outbound_departure_time = outbound_first_segment.get('departure', {}).get('at', '')[:16]
            outbound_arrival_time = outbound_last_segment.get('arrival', {}).get('at', '')[:16]
            
            # Format outbound times for display (keep only HH:MM)
            if outbound_departure_time:
                outbound_departure_time = outbound_departure_time[-5:]
            if outbound_arrival_time:
                outbound_arrival_time = outbound_arrival_time[-5:]
            
            # Map travel class
            travel_class = offer.get('travelerPricings', [{}])[0].get('fareDetailsBySegment', [{}])[0].get('cabin', 'ECONOMY')
            class_type_map = {
                'ECONOMY': 'economy',
                'PREMIUM_ECONOMY': 'premium_economy',
                'BUSINESS': 'business',
                'FIRST': 'first'
            }
            class_type = class_type_map.get(travel_class, 'economy')
            
            # Format outbound duration
            outbound_duration_formatted = self._format_duration(outbound_duration)
            
            flight_data = {
                "airline": self._get_airline_name(outbound_carrier_code),
                "flight_number": f"{outbound_carrier_code}{outbound_flight_number}",
                "departure_time": outbound_departure_time,
                "arrival_time": outbound_arrival_time,
                "duration": outbound_duration_formatted,
                "price": total_price,
                "currency": currency,
                "class_type": class_type,
                "stops": outbound_stops,
                "amadeus_offer_id": offer.get('id')  # Store for booking later
            }
            
            # Parse return flight if it exists (second itinerary)
            if len(itineraries) > 1 and return_date:
                return_itinerary = itineraries[1]
                return_segments = return_itinerary.get('segments', [])
                
                if return_segments:
                    # Get first and last segments for return departure/arrival
                    return_first_segment = return_segments[0]
                    return_last_segment = return_segments[-1]
                    
                    # Extract return airline information
                    return_carrier_code = return_first_segment.get('carrierCode', '')
                    return_flight_number = return_first_segment.get('number', '')
                    
                    # Extract return times
                    return_departure_time = return_first_segment.get('departure', {}).get('at', '')[:16]
                    return_arrival_time = return_last_segment.get('arrival', {}).get('at', '')[:16]
                    
                    # Format return times for display
                    if return_departure_time:
                        return_departure_time = return_departure_time[-5:]
                    if return_arrival_time:
                        return_arrival_time = return_arrival_time[-5:]
                    
                    # Calculate return duration
                    return_duration = return_itinerary.get('duration', '')
                    return_duration_formatted = self._format_duration(return_duration)
                    
                    # Count return stops
                    return_stops = len(return_segments) - 1
                    
                    # Extract return date from departure time
                    return_date_str = return_first_segment.get('departure', {}).get('at', '')[:10] if return_departure_time else return_date
                    
                    # Add return flight details
                    flight_data["return_airline"] = self._get_airline_name(return_carrier_code)
                    flight_data["return_flight_number"] = f"{return_carrier_code}{return_flight_number}"
                    flight_data["return_departure_time"] = return_departure_time
                    flight_data["return_arrival_time"] = return_arrival_time
                    flight_data["return_duration"] = return_duration_formatted
                    flight_data["return_stops"] = return_stops
                    flight_data["return_date"] = return_date_str
                    flight_data["trip_type"] = "return"
                else:
                    flight_data["return_date"] = return_date
                    flight_data["trip_type"] = "return"
            elif return_date:
                flight_data["return_date"] = return_date
                flight_data["trip_type"] = "return"
            else:
                flight_data["trip_type"] = "one_way"
            
            flights.append(flight_data)
        
        # Sort by price (cheapest first)
        flights.sort(key=lambda x: x.get("price", float("inf")))
        
        return flights
    
    def _format_duration(self, duration: str) -> str:
        """Convert ISO 8601 duration (PT5H30M) to readable format (5h 30m)."""
        if not duration or not duration.startswith('PT'):
            return duration
        
        duration = duration[2:]  # Remove 'PT' prefix
        hours = 0
        minutes = 0
        
        if 'H' in duration:
            hours_str = duration.split('H')[0]
            hours = int(hours_str) if hours_str.isdigit() else 0
            duration = duration.split('H')[1] if 'H' in duration else duration
        
        if 'M' in duration:
            minutes_str = duration.split('M')[0]
            minutes = int(minutes_str) if minutes_str.isdigit() else 0
        
        if hours > 0 and minutes > 0:
            return f"{hours}h {minutes}m"
        elif hours > 0:
            return f"{hours}h"
        elif minutes > 0:
            return f"{minutes}m"
        else:
            return "N/A"
    
    def _get_airline_name(self, carrier_code: str) -> str:
        """Map airline carrier code to airline name."""
        airline_map = {
            'AA': 'American Airlines',
            'UA': 'United Airlines',
            'DL': 'Delta Air Lines',
            'BA': 'British Airways',
            'AF': 'Air France',
            'LH': 'Lufthansa',
            'KL': 'KLM',
            'VS': 'Virgin Atlantic',
            'EK': 'Emirates',
            'SQ': 'Singapore Airlines',
            'B6': 'JetBlue Airways',
            'AS': 'Alaska Airlines',
            'WN': 'Southwest Airlines'
        }
        return airline_map.get(carrier_code, f"Airline {carrier_code}")
    
    def get_best_flight(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        return_date: Optional[str] = None,
        passengers: int = 1,
        class_type: str = "economy",
        preference: str = "price"  # "price", "duration", "direct"
    ) -> Optional[Dict[str, Any]]:
        """
        Get the best flight option based on preference.
        
        Args:
            preference: "price" (cheapest), "duration" (shortest), "direct" (non-stop)
        """
        flights = self.search_flights(
            origin, destination, departure_date,
            return_date, passengers, class_type
        )
        
        if not flights:
            return None
        
        if preference == "price":
            return min(flights, key=lambda x: x.get("price", float("inf")))
        elif preference == "duration":
            # Parse duration string and find shortest
            def duration_minutes(dur_str):
                try:
                    parts = dur_str.replace('h', ' ').replace('m', '').split()
                    hours = int(parts[0]) if len(parts) > 0 else 0
                    mins = int(parts[1]) if len(parts) > 1 else 0
                    return hours * 60 + mins
                except:
                    return float('inf')
            return min(flights, key=lambda x: duration_minutes(x.get("duration", "")))
        elif preference == "direct":
            direct_flights = [f for f in flights if f.get("stops", 1) == 0]
            return direct_flights[0] if direct_flights else flights[0]
        
        return flights[0]
    
    def _generate_mock_flights(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        passengers: int,
        class_type: str,
        return_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Generate mock flight data for testing/demo purposes when API is unavailable.
        Creates realistic-looking flight options with varying prices, times, and stops.
        """
        airlines = ["American Airlines", "United Airlines", "Delta Air Lines", 
                   "JetBlue Airways", "Southwest Airlines", "Alaska Airlines"]
        
        # Base price varies by class
        base_prices = {
            "economy": 300,
            "premium_economy": 600,
            "business": 1200,
            "first": 2500
        }
        
        base_price = base_prices.get(class_type.lower(), 300)
        # Return trips typically cost 1.7-2x a one-way ticket
        price_multiplier = 1.85 if return_date else 1.0
        
        flights = []
        
        # Generate 8-12 flight options
        num_flights = random.randint(8, 12)
        
        for i in range(num_flights):
            airline = random.choice(airlines)
            
            # Vary departure times throughout the day
            hour = 6 + (i * 2) % 18  # Spread across day
            minute = random.choice([0, 15, 30, 45])
            departure_time = f"{hour:02d}:{minute:02d}"
            
            # Flight duration varies (3-12 hours)
            duration_hours = random.randint(3, 12)
            duration_minutes = random.choice([0, 15, 30, 45])
            duration = f"{duration_hours}h {duration_minutes}m"
            
            # Calculate arrival time
            arr_hour = (hour + duration_hours) % 24
            arr_min = (minute + duration_minutes) % 60
            if minute + duration_minutes >= 60:
                arr_hour = (arr_hour + 1) % 24
            arrival_time = f"{arr_hour:02d}:{arr_min:02d}"
            
            # Vary price (±30% from base)
            price_variation = random.uniform(0.7, 1.3)
            price = int(base_price * price_variation * price_multiplier * passengers)
            
            # Stops: 70% direct, 25% 1 stop, 5% 2+ stops
            stop_prob = random.random()
            if stop_prob < 0.7:
                stops = 0
            elif stop_prob < 0.95:
                stops = 1
            else:
                stops = 2
            
            # Flight number
            flight_number = f"{random.randint(100, 9999)}"
            
            flight_data = {
                "airline": airline,
                "flight_number": flight_number,
                "departure_time": departure_time,
                "arrival_time": arrival_time,
                "duration": duration,
                "price": price,
                "currency": "USD",
                "class_type": class_type,
                "stops": stops
            }
            
            # Add return flight info if return trip (generate mock return flight)
            if return_date:
                # Generate return flight details for mock data
                return_airline = random.choice(airlines)
                return_hour = 14 + (i * 2) % 10  # Afternoon return times
                return_minute = random.choice([0, 15, 30, 45])
                return_departure_time = f"{return_hour:02d}:{return_minute:02d}"
                
                return_duration_hours = random.randint(3, 12)
                return_duration_minutes = random.choice([0, 15, 30, 45])
                return_duration = f"{return_duration_hours}h {return_duration_minutes}m"
                
                return_arr_hour = (return_hour + return_duration_hours) % 24
                return_arr_min = (return_minute + return_duration_minutes) % 60
                if return_minute + return_duration_minutes >= 60:
                    return_arr_hour = (return_arr_hour + 1) % 24
                return_arrival_time = f"{return_arr_hour:02d}:{return_arr_min:02d}"
                
                return_stop_prob = random.random()
                if return_stop_prob < 0.7:
                    return_stops = 0
                elif return_stop_prob < 0.95:
                    return_stops = 1
                else:
                    return_stops = 2
                
                return_flight_number = f"{random.randint(100, 9999)}"
                
                flight_data["return_airline"] = return_airline
                flight_data["return_flight_number"] = return_flight_number
                flight_data["return_departure_time"] = return_departure_time
                flight_data["return_arrival_time"] = return_arrival_time
                flight_data["return_duration"] = return_duration
                flight_data["return_stops"] = return_stops
                flight_data["return_date"] = return_date
                flight_data["trip_type"] = "return"
            else:
                flight_data["trip_type"] = "one_way"
            
            flights.append(flight_data)
        
        # Sort by price (cheapest first)
        flights.sort(key=lambda x: x["price"])
        
        return flights
