"""
Travel Planner Streamlit App
Main application entry point.
"""
import streamlit as st
from streamlit_searchbox import st_searchbox
from datetime import date, datetime, timedelta
from typing import List, Optional, Any, Dict

from models.travel_plan import TravelPlan, TravelRequest
from utils.travel_planner import TravelPlanner
from utils.display_helpers import display_travel_plan
from utils.llm_client import LLMClient
from utils.flights_client import FlightsClient
from utils.flight_display import display_flight_comparison_table
from utils.places_client import PlacesClient
from utils.hotels_client import HotelsClient
from utils.geocoding import GeocodingService
import config


# Initialize PlacesClient for autocomplete (cached to avoid re-initialization)
@st.cache_resource
def get_places_client():
    """Get or create a cached PlacesClient instance."""
    try:
        return PlacesClient()
    except ValueError:
        return None


def search_locations(query: str) -> List[tuple]:
    """
    Search function for location autocomplete.
    Returns list of (display_text, value) tuples for the searchbox.
    """
    if not query or len(query) < 2:
        return []

    places_client = get_places_client()
    if not places_client:
        return []

    suggestions = places_client.autocomplete_locations(query)
    # Return tuples of (display_text, value)
    return [(s["description"], s["description"]) for s in suggestions]


def search_hotels_autocomplete(query: str) -> List[tuple]:
    """
    Search function for hotel autocomplete.
    Returns list of (display_text, value_dict) tuples for the searchbox.
    """
    if not query or len(query) < 2:
        return []

    places_client = get_places_client()
    if not places_client:
        return []

    # Get destination coordinates if available for location bias
    location = None
    if 'destination_coords' in st.session_state and st.session_state.destination_coords:
        location = st.session_state.destination_coords

    suggestions = places_client.autocomplete_hotels(query, location=location)

    # Return tuples of (display_text, place_id) for selection
    results = []
    for s in suggestions:
        display = f"{s['name']} - {s['address']}" if s.get('address') else s['name']
        results.append((display, s['place_id']))

    return results


def search_hotel_areas(query: str) -> List[tuple]:
    """
    Search function for hotel area/location autocomplete.
    Returns list of (display_text, value) tuples for the searchbox.
    """
    if not query or len(query) < 2:
        return []

    places_client = get_places_client()
    if not places_client:
        return []

    # Get destination coordinates if available for location bias
    location = None
    if 'destination_coords' in st.session_state and st.session_state.destination_coords:
        location = st.session_state.destination_coords

    suggestions = places_client.autocomplete_areas(query, location=location)

    # Return tuples of (display_text, value) for selection
    return [(s["description"], s["description"]) for s in suggestions]


@st.cache_resource
def get_geocoding_service():
    """Get or create a cached GeocodingService instance."""
    try:
        return GeocodingService()
    except ValueError:
        return None


@st.cache_resource
def get_llm_client():
    """Get or create a cached LLMClient instance."""
    try:
        return LLMClient()
    except ValueError:
        return None


def display_hotel_comparison_table(hotels: List[Dict[str, Any]]) -> None:
    """Display hotels in a filterable table with selection."""
    if not hotels:
        st.warning("No hotels found.")
        return

    # Filtering options
    col1, col2, col3 = st.columns(3)

    with col1:
        sort_by = st.selectbox(
            "Sort by",
            options=["price", "distance", "rating"],
            format_func=lambda x: {"price": "Price (Low to High)", "distance": "Distance (Nearest)", "rating": "Rating (Highest)"}[x],
            key="hotel_sort"
        )

    with col2:
        max_price = st.slider(
            "Max Price per Night ($)",
            min_value=50,
            max_value=1000,
            value=500,
            step=25,
            key="hotel_max_price"
        )

    with col3:
        max_distance = st.slider(
            "Max Distance (km)",
            min_value=1.0,
            max_value=20.0,
            value=10.0,
            step=0.5,
            key="hotel_max_distance"
        )

    # Filter hotels
    filtered_hotels = [
        h for h in hotels
        if h.get('price_per_night', 0) <= max_price
        and (h.get('distance_km') is None or h.get('distance_km', 0) <= max_distance)
    ]

    # Sort hotels
    if sort_by == "price":
        filtered_hotels.sort(key=lambda x: x.get('price_per_night', float('inf')))
    elif sort_by == "distance":
        filtered_hotels.sort(key=lambda x: x.get('distance_km', float('inf')))
    elif sort_by == "rating":
        filtered_hotels.sort(key=lambda x: x.get('rating', 0), reverse=True)

    # Store filtered hotels in session state for selection
    st.session_state.filtered_hotels = filtered_hotels

    if not filtered_hotels:
        st.warning("No hotels match your filters. Try adjusting the price or distance limits.")
        return

    st.markdown(f"**Showing {len(filtered_hotels)} hotels**")

    # Display hotels as cards
    for idx, hotel in enumerate(filtered_hotels):
        with st.container():
            col1, col2, col3, col4 = st.columns([3, 2, 2, 1])

            with col1:
                st.markdown(f"**{hotel.get('name', 'Unknown Hotel')}**")
                rating = hotel.get('rating', 0)
                stars = "⭐" * int(rating) if rating else ""
                st.caption(f"{stars} ({rating}/5) | {hotel.get('room_type', 'Standard Room')}")
                if hotel.get('amenities'):
                    st.caption(", ".join(hotel.get('amenities', [])[:4]))

            with col2:
                st.metric(
                    "Price/Night",
                    f"${hotel.get('price_per_night', 0):,.0f}",
                    help=f"Total: ${hotel.get('total_price', 0):,.0f}"
                )

            with col3:
                distance = hotel.get('distance_km')
                if distance:
                    st.metric("Distance", f"{distance:.1f} km", help="Distance to city center/landmark")
                else:
                    st.metric("Distance", "N/A")

            with col4:
                if st.button("Select", key=f"select_hotel_{idx}"):
                    st.session_state.selected_hotel = hotel
                    st.success(f"Selected: {hotel.get('name')}")

            st.divider()


# Page configuration
st.set_page_config(
    page_title="Travel Planner",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Custom CSS
st.markdown("""
    <style>
    .stButton>button {
        background-color: #1f77b4;
        color: white;
        font-weight: bold;
    }
    </style>
""", unsafe_allow_html=True)


def validate_inputs(source: Optional[str], destination: Optional[str], start_date: date, end_date: date) -> Optional[str]:
    """Validate user inputs."""
    if not source or (isinstance(source, str) and not source.strip()):
        return "Please select a source location"

    if not destination or (isinstance(destination, str) and not destination.strip()):
        return "Please select a destination"
    
    if start_date < date.today():
        return "Start date cannot be in the past"
    
    if end_date <= start_date:
        return "End date must be after start date"
    
    duration = (end_date - start_date).days
    if duration > 30:
        return "Maximum trip duration is 30 days"
    
    if duration < 1:
        return "Trip must be at least 1 day"
    
    return None


def main():
    """Main application function."""

    # Initialize session state
    if 'selected_flight' not in st.session_state:
        st.session_state.selected_flight = None
    if 'available_flights' not in st.session_state:
        st.session_state.available_flights = []
    if 'selected_hotel' not in st.session_state:
        st.session_state.selected_hotel = None
    if 'available_hotels' not in st.session_state:
        st.session_state.available_hotels = []
    if 'destination_coords' not in st.session_state:
        st.session_state.destination_coords = None
    if 'looked_up_hotel' not in st.session_state:
        st.session_state.looked_up_hotel = None
    if 'last_hotel_lookup' not in st.session_state:
        st.session_state.last_hotel_lookup = None
    if 'current_travel_plan' not in st.session_state:
        st.session_state.current_travel_plan = None
    if 'current_plan_dict' not in st.session_state:
        st.session_state.current_plan_dict = None
    if 'chat_messages' not in st.session_state:
        st.session_state.chat_messages = []
    if 'chat_history' not in st.session_state:
        st.session_state.chat_history = []

    # Main content area with tabs
    tab_flights, tab_hotels, tab_itinerary = st.tabs(["Flights", "Hotels", "Itinerary"])

    # Flights Tab
    with tab_flights:
        # Trip details section
        st.subheader("Trip Details")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            source = st_searchbox(
                search_locations,
                key="source_searchbox",
                placeholder="From",
                clear_on_submit=False,
                rerun_on_update=False
            )

        with col2:
            destination = st_searchbox(
                search_locations,
                key="destination_searchbox",
                placeholder="To",
                clear_on_submit=False,
                rerun_on_update=False
            )

        with col3:
            start_date = st.date_input(
                "Departure",
                min_value=date.today(),
                value=date.today() + timedelta(days=7),
                key="flight_start_date"
            )

        with col4:
            end_date = st.date_input(
                "Return",
                min_value=start_date + timedelta(days=1),
                value=start_date + timedelta(days=7),
                key="flight_end_date"
            )

        # Flight preferences
        st.subheader("Preferences")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            travelers = st.number_input(
                "Travelers",
                min_value=1,
                max_value=10,
                value=1,
                key="flight_travelers"
            )

        with col2:
            trip_type = st.selectbox(
                "Trip Type",
                options=["return", "one_way"],
                index=0,
                format_func=lambda x: "Return" if x == "return" else "One Way",
                key="flight_trip_type"
            )

        with col3:
            flight_class = st.selectbox(
                "Class",
                options=["economy", "premium_economy", "business", "first"],
                index=0,
                format_func=lambda x: x.replace("_", " ").title(),
                key="flight_class"
            )

        with col4:
            flight_price_range = st.slider(
                "Price Range (USD)",
                min_value=100,
                max_value=5000,
                value=(200, 2000),
                step=50,
                key="flight_price_range"
            )
        flight_price_min, flight_price_max = flight_price_range

        # Search button
        search_flights_button = st.button("Search Flights", type="primary", key="search_flights_btn")

        if search_flights_button:
            error = validate_inputs(source, destination, start_date, end_date)
            if error:
                st.error(error)
            else:
                with st.spinner("Searching for flights..."):
                    try:
                        flights_client = FlightsClient()
                        return_date = end_date.strftime("%Y-%m-%d") if trip_type == "return" else None
                        flights = flights_client.search_flights(
                            origin=source.strip(),
                            destination=destination.strip(),
                            departure_date=start_date.strftime("%Y-%m-%d"),
                            return_date=return_date,
                            passengers=travelers,
                            class_type=flight_class
                        )

                        if flights:
                            filtered_flights = [
                                f for f in flights
                                if flight_price_min <= f.get("price", float("inf")) <= flight_price_max
                            ]
                            st.session_state.available_flights = filtered_flights if filtered_flights else flights
                        else:
                            st.session_state.available_flights = []

                    except ValueError as e:
                        if "AMADEUS" in str(e):
                            try:
                                flights_client = FlightsClient()
                                return_date_param = end_date.strftime("%Y-%m-%d") if trip_type == "return" else None
                                flights = flights_client._generate_mock_flights(
                                    source.strip(),
                                    destination.strip(),
                                    start_date.strftime("%Y-%m-%d"),
                                    travelers,
                                    flight_class,
                                    return_date_param
                                )
                                filtered_flights = [
                                    f for f in flights
                                    if flight_price_min <= f.get("price", float("inf")) <= flight_price_max
                                ]
                                st.session_state.available_flights = filtered_flights if filtered_flights else flights
                            except:
                                st.session_state.available_flights = []
                        else:
                            st.error(f"Error: {str(e)}")
                            st.session_state.available_flights = []
                    except Exception as e:
                        st.error(f"Error searching flights: {str(e)}")
                        st.session_state.available_flights = []

        # Display results
        st.markdown("---")
        if st.session_state.available_flights:
            st.markdown(f"**{len(st.session_state.available_flights)} flights found**")
            display_flight_comparison_table(st.session_state.available_flights)

            if 'filtered_flights' in st.session_state and 'flight_selection' in st.session_state:
                selected_idx = st.session_state.flight_selection
                filtered_flights = st.session_state.filtered_flights
                if selected_idx is not None and selected_idx < len(filtered_flights):
                    st.session_state.selected_flight = filtered_flights[selected_idx]
            else:
                st.session_state.selected_flight = st.session_state.available_flights[0] if st.session_state.available_flights else None

    # Hotels Tab
    with tab_hotels:
        # Trip details section
        st.subheader("Search")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            hotel_destination = st_searchbox(
                search_locations,
                key="hotel_destination_searchbox",
                placeholder="Destination",
                clear_on_submit=False,
                rerun_on_update=False
            )

        with col2:
            hotel_check_in = st.date_input(
                "Check-in",
                min_value=date.today(),
                value=date.today() + timedelta(days=7),
                key="hotel_check_in"
            )

        with col3:
            hotel_check_out = st.date_input(
                "Check-out",
                min_value=hotel_check_in + timedelta(days=1),
                value=hotel_check_in + timedelta(days=7),
                key="hotel_check_out"
            )

        with col4:
            hotel_guests = st.number_input(
                "Guests",
                min_value=1,
                max_value=10,
                value=1,
                key="hotel_guests"
            )

        # Hotel preferences
        st.subheader("Preferences")
        col1, col2 = st.columns(2)

        with col1:
            hotel_lookup = st_searchbox(
                search_hotels_autocomplete,
                key="hotel_lookup_searchbox",
                placeholder="Search specific hotel (optional)",
                clear_on_submit=False,
                rerun_on_update=False
            )

            # Handle hotel lookup
            if hotel_lookup and hotel_lookup != st.session_state.get('last_hotel_lookup'):
                st.session_state.last_hotel_lookup = hotel_lookup
                places_client = get_places_client()
                if places_client:
                    hotel_details = places_client.get_hotel_details(hotel_lookup)
                    if hotel_details:
                        st.session_state.looked_up_hotel = hotel_details

            if st.session_state.looked_up_hotel:
                hotel_info = st.session_state.looked_up_hotel
                st.success(f"Selected: {hotel_info.get('name', 'Unknown')}")
                if st.button("Clear", key="clear_hotel_lookup"):
                    st.session_state.looked_up_hotel = None
                    st.session_state.last_hotel_lookup = None
                    st.rerun()

        with col2:
            hotel_address = st_searchbox(
                search_hotel_areas,
                key="hotel_area_searchbox",
                placeholder="Search area (optional)",
                clear_on_submit=False,
                rerun_on_update=False
            )

        col1, col2 = st.columns(2)
        with col1:
            hotel_price_range = st.slider(
                "Price per Night (USD)",
                min_value=30,
                max_value=1000,
                value=(50, 500),
                step=25,
                key="hotel_price_range"
            )
        hotel_price_min, hotel_price_max = hotel_price_range

        # Search button
        search_hotels_button = st.button("Search Hotels", type="primary", key="search_hotels_btn")

        if search_hotels_button:
            dest = hotel_destination or destination
            error = validate_inputs(source or "temp", dest, hotel_check_in, hotel_check_out)
            if error and "source" not in error.lower():
                st.error(error)
            elif not dest:
                st.error("Please select a destination")
            else:
                with st.spinner("Searching for hotels..."):
                    try:
                        hotels_client = HotelsClient()
                        geocoding = get_geocoding_service()
                        landmark_coords = None
                        if geocoding and dest:
                            coords = geocoding.geocode(dest)
                            if coords:
                                landmark_coords = coords
                                st.session_state.destination_coords = coords

                        city_code = dest[:3].upper() if dest else "NYC"

                        hotels = hotels_client.search_hotels(
                            city_code=city_code,
                            check_in_date=hotel_check_in.strftime("%Y-%m-%d"),
                            check_out_date=hotel_check_out.strftime("%Y-%m-%d"),
                            adults=hotel_guests,
                            rooms=1,
                            landmark_coords=landmark_coords
                        )

                        if hotels:
                            filtered_hotels = [
                                h for h in hotels
                                if hotel_price_min <= h.get("price_per_night", float("inf")) <= hotel_price_max
                            ]
                            st.session_state.available_hotels = filtered_hotels if filtered_hotels else hotels
                        else:
                            st.session_state.available_hotels = []

                    except Exception as e:
                        st.error(f"Error searching hotels: {str(e)}")
                        st.session_state.available_hotels = []

        # Display results
        st.markdown("---")
        if st.session_state.available_hotels:
            st.markdown(f"**{len(st.session_state.available_hotels)} hotels found**")
            if st.session_state.destination_coords:
                st.caption("Distances calculated from city center")
            display_hotel_comparison_table(st.session_state.available_hotels)

            if st.session_state.selected_hotel:
                st.success(f"Selected: **{st.session_state.selected_hotel.get('name')}** - ${st.session_state.selected_hotel.get('price_per_night', 0):,.0f}/night")

    # Itinerary Tab
    with tab_itinerary:
        # Trip summary
        st.subheader("Trip Summary")

        col1, col2, col3, col4 = st.columns(4)
        with col1:
            itin_source = st_searchbox(
                search_locations,
                key="itin_source_searchbox",
                placeholder="From",
                clear_on_submit=False,
                rerun_on_update=False
            )
        with col2:
            itin_destination = st_searchbox(
                search_locations,
                key="itin_destination_searchbox",
                placeholder="To",
                clear_on_submit=False,
                rerun_on_update=False
            )
        with col3:
            itin_start = st.date_input(
                "Start",
                min_value=date.today(),
                value=date.today() + timedelta(days=7),
                key="itin_start_date"
            )
        with col4:
            itin_end = st.date_input(
                "End",
                min_value=itin_start + timedelta(days=1),
                value=itin_start + timedelta(days=7),
                key="itin_end_date"
            )

        # Activity preferences
        st.subheader("Activity Preferences")
        col1, col2, col3 = st.columns(3)

        with col1:
            itin_travelers = st.number_input(
                "Travelers",
                min_value=1,
                max_value=10,
                value=1,
                key="itin_travelers"
            )

        with col2:
            activity_level = st.selectbox(
                "Activity Level",
                options=["relaxed", "moderate", "active"],
                index=1,
                format_func=lambda x: x.title(),
                key="itin_activity_level"
            )

        with col3:
            interest_categories = st.multiselect(
                "Interests",
                options=[
                    "culture", "history", "nature", "outdoors", "food",
                    "dining", "nightlife", "shopping", "adventure",
                    "family_friendly", "art", "music", "sports",
                    "religion", "architecture"
                ],
                default=["culture", "food", "nature"],
                format_func=lambda x: x.replace("_", " ").title(),
                key="itin_interests"
            )

        # Show current selections
        if st.session_state.selected_flight or st.session_state.selected_hotel or st.session_state.looked_up_hotel:
            st.subheader("Your Selections")
            col1, col2 = st.columns(2)
            with col1:
                if st.session_state.selected_flight:
                    flight = st.session_state.selected_flight
                    st.info(f"**Flight:** {flight.get('airline', 'N/A')} - ${flight.get('price', 0):,.0f}")
            with col2:
                if st.session_state.looked_up_hotel:
                    hotel = st.session_state.looked_up_hotel
                    st.info(f"**Hotel:** {hotel.get('name', 'N/A')}")
                elif st.session_state.selected_hotel:
                    hotel = st.session_state.selected_hotel
                    st.info(f"**Hotel:** {hotel.get('name', 'N/A')} - ${hotel.get('price_per_night', 0):,.0f}/night")

        # Generate button
        generate_button = st.button("Generate Itinerary", type="primary", key="generate_itin_btn")

        if generate_button:
            final_source = itin_source or source
            final_destination = itin_destination or destination or hotel_destination
            final_start = itin_start
            final_end = itin_end
            final_travelers = itin_travelers

            error = validate_inputs(final_source, final_destination, final_start, final_end)
            if error:
                st.error(error)
            else:
                try:
                    config.validate_config()
                except ValueError as e:
                    st.error(f"Configuration Error:\n{e}")
                    st.info("Please check your API keys in the .env file")
                else:
                    final_selected_hotel = None
                    if st.session_state.looked_up_hotel:
                        looked_up = st.session_state.looked_up_hotel
                        final_selected_hotel = {
                            'name': looked_up.get('name', ''),
                            'address': looked_up.get('address', ''),
                            'rating': looked_up.get('rating', 0),
                            'latitude': looked_up.get('latitude'),
                            'longitude': looked_up.get('longitude'),
                            'place_id': looked_up.get('place_id', '')
                        }
                    elif st.session_state.selected_hotel:
                        final_selected_hotel = st.session_state.selected_hotel

                    travel_request = TravelRequest(
                        source=final_source.strip() if final_source else "",
                        destination=final_destination.strip() if final_destination else "",
                        start_date=final_start,
                        end_date=final_end,
                        travelers=final_travelers,
                        trip_type=trip_type if 'trip_type' in dir() else "return",
                        flight_class=flight_class if 'flight_class' in dir() else "economy",
                        flight_price_min=float(flight_price_min) if 'flight_price_min' in dir() else 200.0,
                        flight_price_max=float(flight_price_max) if 'flight_price_max' in dir() else 2000.0,
                        hotel_address=hotel_address.strip() if hotel_address else None,
                        hotel_price_min=float(hotel_price_min) if 'hotel_price_min' in dir() else 50.0,
                        hotel_price_max=float(hotel_price_max) if 'hotel_price_max' in dir() else 500.0,
                        interest_categories=interest_categories if interest_categories else ["culture", "food", "nature"],
                        activity_level=activity_level,
                        selected_flight=st.session_state.selected_flight,
                        selected_hotel=final_selected_hotel
                    )

                    with st.spinner("Generating your travel plan..."):
                        try:
                            planner = TravelPlanner()
                            plan = planner.generate_travel_plan(travel_request)

                            if not plan:
                                st.error("Failed to generate travel plan. Please check your API keys and try again.")
                            else:
                                # Store the plan in session state
                                st.session_state.current_travel_plan = plan
                                st.session_state.current_plan_dict = plan.model_dump()
                                # Reset chat when generating new plan
                                st.session_state.chat_messages = []
                                st.session_state.chat_history = []
                                st.rerun()

                        except Exception as e:
                            st.error(f"An error occurred: {str(e)}")
                            st.exception(e)

        # Display generated itinerary if available
        if st.session_state.current_travel_plan:
            plan = st.session_state.current_travel_plan
            st.markdown("---")
            duration = plan.duration_days
            st.markdown(f"### {plan.source} → {plan.destination}")
            st.markdown(f"**{plan.start_date} - {plan.end_date}** · {duration} days · {plan.travelers} traveler{'s' if plan.travelers > 1 else ''}")

            places_client = get_places_client()
            display_travel_plan(plan, 1, places_client)

            # Chat interface for modifying itinerary
            st.markdown("---")
            st.markdown("### Chat with your Itinerary")
            st.caption("Ask me to modify your itinerary - add activities, change restaurants, swap days, etc.")

            # Display chat messages
            chat_container = st.container()
            with chat_container:
                for msg in st.session_state.chat_messages:
                    if msg["role"] == "user":
                        st.chat_message("user").write(msg["content"])
                    else:
                        st.chat_message("assistant").write(msg["content"])

            # Chat input
            user_input = st.chat_input("What changes would you like to make to your itinerary?")

            if user_input:
                # Add user message to display
                st.session_state.chat_messages.append({"role": "user", "content": user_input})

                with st.spinner("Updating your itinerary..."):
                    try:
                        llm_client = get_llm_client()
                        if not llm_client:
                            st.session_state.chat_messages.append({
                                "role": "assistant",
                                "content": "Sorry, the LLM service is not configured. Please check your API keys."
                            })
                            st.rerun()

                        result = llm_client.modify_itinerary(
                            current_plan=st.session_state.current_plan_dict,
                            user_message=user_input,
                            conversation_history=st.session_state.chat_history
                        )

                        if result["success"]:
                            # Update the plan
                            updated_plan_dict = result["plan"]

                            # Try to rebuild TravelPlan from updated dict
                            try:
                                updated_plan = TravelPlan(**updated_plan_dict)
                                st.session_state.current_plan_dict = updated_plan_dict
                                st.session_state.current_travel_plan = updated_plan

                                # Add to chat history for context (limit history size)
                                st.session_state.chat_history.append({"role": "user", "content": user_input})
                                st.session_state.chat_history.append({"role": "assistant", "content": "Done! I've updated the itinerary."})

                                # Trim chat history if too long
                                if len(st.session_state.chat_history) > 10:
                                    st.session_state.chat_history = st.session_state.chat_history[-10:]

                                # Add assistant response to display
                                st.session_state.chat_messages.append({
                                    "role": "assistant",
                                    "content": "Done! I've updated your itinerary based on your request. Take a look at the changes above!"
                                })
                            except Exception as validation_error:
                                # Plan structure was invalid
                                st.session_state.chat_messages.append({
                                    "role": "assistant",
                                    "content": "I modified the plan but encountered a formatting issue. Could you try rephrasing your request?"
                                })
                        else:
                            st.session_state.chat_messages.append({
                                "role": "assistant",
                                "content": result["message"]
                            })

                        st.rerun()

                    except Exception as e:
                        st.session_state.chat_messages.append({
                            "role": "assistant",
                            "content": "Sorry, something went wrong. Please try again."
                        })
                        st.rerun()

            # Action buttons and example prompts
            col1, col2, col3 = st.columns([1, 1, 4])
            with col1:
                if st.button("Clear Chat", key="clear_chat_btn"):
                    st.session_state.chat_messages = []
                    st.session_state.chat_history = []
                    st.rerun()
            with col2:
                if st.button("New Itinerary", key="new_itin_btn"):
                    st.session_state.current_travel_plan = None
                    st.session_state.current_plan_dict = None
                    st.session_state.chat_messages = []
                    st.session_state.chat_history = []
                    st.rerun()

            # Example prompts
            with st.expander("Example requests", expanded=False):
                st.markdown("""
**Try asking things like:**
- "Add a visit to the Eiffel Tower on day 2"
- "Replace the dinner on day 1 with a local street food tour"
- "Make day 3 more relaxed with fewer activities"
- "Add more cultural activities throughout the trip"
- "Swap day 1 and day 2"
- "Remove the museum visit on day 2 afternoon"
- "Add a coffee break in the morning of day 1"
- "Change all dinners to budget-friendly options"
                """)


if __name__ == "__main__":
    main()

