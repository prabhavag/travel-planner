"""
Core travel planner orchestrator.
Coordinates LLM, APIs, and data processing to generate travel plans.
"""
from typing import List, Dict, Any, Optional

from models.travel_plan import TravelPlan, TravelRequest, Transportation, Accommodation, DayItinerary, Activity, CostBreakdown
from utils.llm_client import LLMClient
from utils.flights_client import FlightsClient
from utils.places_client import PlacesClient
from utils.geocoding import GeocodingService


class TravelPlanner:
    """Main travel planner class that orchestrates plan generation."""
    
    def __init__(self):
        self.llm_client = LLMClient()
        self.flights_client = FlightsClient()
        self.places_client = PlacesClient()
        self.geocoding = GeocodingService()
    
    def generate_travel_plan(
        self,
        request: TravelRequest
    ) -> Optional[TravelPlan]:
        """
        Generate a single customized travel plan based on user preferences.
        
        Args:
            request: TravelRequest object with user inputs and preferences
            
        Returns:
            TravelPlan object
        """
        # Calculate duration
        duration = (request.end_date - request.start_date).days + 1
        
        # Geocode locations
        dest_coords = self.geocoding.geocode(request.destination)
        
        try:
            plan = self._generate_single_plan(
                request=request,
                duration=duration,
                destination_coords=dest_coords
            )
            return plan
        except Exception as e:
            print(f"Error generating travel plan: {e}")
            return None
    
    def _generate_single_plan(
        self,
        request: TravelRequest,
        duration: int,
        destination_coords: Optional[tuple]
    ) -> Optional[TravelPlan]:
        """Generate a single travel plan."""
        
        # Format dates
        start_date_str = request.start_date.strftime("%Y-%m-%d")
        end_date_str = request.end_date.strftime("%Y-%m-%d")
        
        # Generate base plan using LLM with user preferences
        llm_plan_data = self.llm_client.generate_travel_plan(
            source=request.source,
            destination=request.destination,
            start_date=start_date_str,
            end_date=end_date_str,
            duration_days=duration,
            travelers=request.travelers,
            flight_class=request.flight_class,
            flight_price_min=request.flight_price_min,
            flight_price_max=request.flight_price_max,
            hotel_address=request.hotel_address,
            hotel_price_min=request.hotel_price_min,
            hotel_price_max=request.hotel_price_max,
            interest_categories=request.interest_categories,
            activity_level=request.activity_level
        )
        
        # Use selected flight if available, otherwise try to fetch flights
        flight_data = None
        if request.selected_flight:
            # Use user-selected flight
            flight_data = request.selected_flight
        else:
            # Try to enrich with real flight data (optional, fallback to LLM data if fails)
            try:
                return_date_str = end_date_str if request.trip_type == "return" else None
                flights = self.flights_client.search_flights(
                    origin=request.source,
                    destination=request.destination,
                    departure_date=start_date_str,
                    return_date=return_date_str,
                    passengers=request.travelers,
                    class_type=request.flight_class
                )
                if flights:
                    # Filter flights by price range if available
                    filtered_flights = [
                        f for f in flights
                        if request.flight_price_min <= f.get("price", float("inf")) <= request.flight_price_max
                    ]
                    flight_data = filtered_flights[0] if filtered_flights else flights[0]
            except Exception as e:
                print(f"Could not fetch real flight data: {e}, using LLM estimates")
        
        # Enrich itinerary with real places if coordinates available
        if destination_coords and "itinerary" in llm_plan_data:
            llm_plan_data["itinerary"] = self._enrich_itinerary_with_places(
                llm_plan_data["itinerary"],
                destination_coords
            )
        
        # Merge flight data if available
        if flight_data and "transportation" in llm_plan_data:
            llm_plan_data["transportation"].update(flight_data)
        
        # Convert to TravelPlan model
        plan = self._parse_llm_plan_to_travel_plan(
            llm_plan_data,
            request,
            duration
        )
        
        return plan
    
    def _enrich_itinerary_with_places(
        self,
        itinerary_data: List[Dict],
        destination_coords: tuple
    ) -> List[Dict]:
        """Enrich itinerary activities with real place data."""
        enriched = []
        
        for day_data in itinerary_data:
            enriched_day = day_data.copy()
            
            # Enrich activities in each time slot
            for time_slot in ["morning", "afternoon", "evening"]:
                if time_slot in enriched_day:
                    enriched_activities = []
                    for activity in enriched_day[time_slot]:
                        activity_name = activity.get("name", "")
                        if activity_name and destination_coords:
                            place_data = self.places_client.enrich_activity_with_places(
                                activity_name,
                                destination_coords,
                                activity_type="tourist_attraction" if activity.get("type") == "attraction" else "restaurant"
                            )
                            if place_data:
                                # Merge place data
                                activity["rating"] = place_data.get("rating")
                                activity["location"] = place_data.get("vicinity")
                                activity["user_ratings_total"] = place_data.get("user_ratings_total")
                        enriched_activities.append(activity)
                    enriched_day[time_slot] = enriched_activities
            
            enriched.append(enriched_day)
        
        return enriched
    
    def _parse_llm_plan_to_travel_plan(
        self,
        llm_data: Dict[str, Any],
        request: TravelRequest,
        duration: int
    ) -> TravelPlan:
        """Parse LLM-generated plan data into TravelPlan model."""
        
        # Parse transportation
        transport_data = llm_data.get("transportation", {})
        
        # If user selected a flight, use that data (preserves return flight info)
        if request.selected_flight:
            # Merge selected flight data with transport_data
            transport_data = {**transport_data, **request.selected_flight}
            # Use selected flight price if available
            if request.selected_flight.get("price"):
                transport_data["price"] = request.selected_flight.get("price")
        
        # Determine arrival date - use return date if it's a return trip
        arrival_date = request.end_date.strftime("%Y-%m-%d") if request.trip_type == "return" else request.start_date.strftime("%Y-%m-%d")
        
        transportation = Transportation(
            type=transport_data.get("type", "flight"),
            from_location=request.source,
            to_location=request.destination,
            departure_date=request.start_date.strftime("%Y-%m-%d"),
            departure_time=transport_data.get("departure_time"),
            arrival_date=arrival_date,
            arrival_time=transport_data.get("arrival_time"),
            airline=transport_data.get("airline"),
            flight_number=transport_data.get("flight_number"),
            class_type=transport_data.get("class_type", request.flight_class),
            price=transport_data.get("estimated_price") or transport_data.get("price"),
            duration=transport_data.get("duration"),
            notes=transport_data.get("notes") or (
                "Round trip flight" if request.trip_type == "return" else "One-way flight"
            )
        )
        
        # Parse accommodation
        accom_data = llm_data.get("accommodation", {})
        # Use user-provided hotel address if available, otherwise use LLM suggestion
        hotel_location = request.hotel_address if request.hotel_address else (accom_data.get("address") or request.destination)
        accommodation = Accommodation(
            name=accom_data.get("name", "Hotel"),
            type="hotel",  # Always hotel as per requirements
            location=hotel_location,
            price_per_night=accom_data.get("price_per_night"),
            total_price=accom_data.get("total_price"),
            rating=accom_data.get("rating"),
            address=hotel_location,
            check_in=request.start_date.strftime("%Y-%m-%d"),
            check_out=request.end_date.strftime("%Y-%m-%d"),
            nights=duration,
            notes=accom_data.get("notes"),
            amenities=accom_data.get("amenities", [])
        )
        
        # Parse itinerary - ensure we have all days
        itinerary = []
        itinerary_data = llm_data.get("itinerary", [])
        
        # If LLM didn't generate enough days, log a warning
        if len(itinerary_data) < duration:
            print(f"Warning: LLM only generated {len(itinerary_data)} days, expected {duration} days")
        
        for idx, day_data in enumerate(itinerary_data, 1):
            # Helper function to parse activities with inferred time
            def parse_activities(activities, time_slot):
                parsed = []
                for act in activities:
                    if isinstance(act, dict):
                        # Ensure time field is set
                        if "time" not in act:
                            act["time"] = time_slot
                        try:
                            parsed.append(Activity(**act))
                        except Exception as e:
                            print(f"Error parsing activity: {e}, activity data: {act}")
                            # Skip invalid activities
                            continue
                    else:
                        parsed.append(act)
                return parsed
            
            day = DayItinerary(
                date=day_data.get("date", ""),
                day_number=day_data.get("day_number", idx),
                morning=parse_activities(day_data.get("morning", []), "morning"),
                afternoon=parse_activities(day_data.get("afternoon", []), "afternoon"),
                evening=parse_activities(day_data.get("evening", []), "evening"),
                notes=day_data.get("notes")
            )
            itinerary.append(day)
        
        # Parse cost breakdown
        cost_data = llm_data.get("cost_breakdown", {})
        cost_breakdown = CostBreakdown(
            transportation=cost_data.get("transportation", 0.0),
            accommodation=cost_data.get("accommodation", 0.0),
            activities=cost_data.get("activities", 0.0),
            food=cost_data.get("food", 0.0),
            local_transport=cost_data.get("local_transport", 0.0),
            total=cost_data.get("total", 0.0),
            per_person=cost_data.get("per_person")
        )
        
        # Determine plan type based on preferences (for display)
        plan_type = "customized"
        if (request.flight_class in ["first", "business"] and
                request.hotel_price_max > 300):
            plan_type = "comfort"
        elif (request.flight_class == "economy" and
              request.hotel_price_max < 150):
            plan_type = "budget"
        else:
            plan_type = "balanced"
        
        # Create TravelPlan
        plan = TravelPlan(
            plan_type=plan_type,
            source=request.source,
            destination=request.destination,
            start_date=request.start_date.strftime("%Y-%m-%d"),
            end_date=request.end_date.strftime("%Y-%m-%d"),
            duration_days=duration,
            travelers=request.travelers,
            transportation=[transportation],
            accommodation=accommodation,
            itinerary=itinerary,
            cost_breakdown=cost_breakdown,
            summary=llm_data.get("summary"),
            highlights=llm_data.get("highlights", []),
            tips=llm_data.get("tips", [])
        )
        
        return plan

