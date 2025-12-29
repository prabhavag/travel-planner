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


@st.cache_resource
def get_geocoding_service():
    """Get or create a cached GeocodingService instance."""
    try:
        return GeocodingService()
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
    page_icon="✈️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
    <style>
    .main-header {
        font-size: 2.5rem;
        font-weight: bold;
        color: #1f77b4;
        text-align: center;
        margin-bottom: 2rem;
    }
    .stButton>button {
        width: 100%;
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
    
    # Header
    st.markdown('<h1 class="main-header">✈️ Travel Planner</h1>', unsafe_allow_html=True)
    st.markdown("---")
    
    # Sidebar for inputs
    with st.sidebar:
        st.header("📍 Trip Details")

        st.markdown("**Source Location**")
        st.caption("Your current location or departure city")
        source = st_searchbox(
            search_locations,
            key="source_searchbox",
            placeholder="Type to search cities...",
            clear_on_submit=False,
            rerun_on_update=False
        )

        st.markdown("**Destination**")
        st.caption("Your travel destination")
        destination = st_searchbox(
            search_locations,
            key="destination_searchbox",
            placeholder="Type to search cities...",
            clear_on_submit=False,
            rerun_on_update=False
        )
        
        trip_type = st.radio(
            "Trip Type",
            options=["one_way", "return"],
            index=1,
            format_func=lambda x: "One Way" if x == "one_way" else "Return",
            help="Select one-way or return trip"
        )
        
        col1, col2 = st.columns(2)
        with col1:
            start_date = st.date_input(
                "Departure Date",
                min_value=date.today(),
                value=date.today() + timedelta(days=7)
            )
        
        with col2:
            if trip_type == "return":
                end_date = st.date_input(
                    "Return Date",
                    min_value=start_date + timedelta(days=1),
                    value=start_date + timedelta(days=7),
                    help="Return flight date"
                )
            else:
                end_date = st.date_input(
                    "End Date (for trip duration)",
                    min_value=start_date + timedelta(days=1),
                    value=start_date + timedelta(days=7),
                    help="End date of your stay (not a return flight)"
                )
        
        travelers = st.number_input(
            "Number of Travelers",
            min_value=1,
            max_value=10,
            value=1
        )
        
        st.markdown("---")
        st.markdown("### ✈️ Flight Preferences")
        
        flight_class = st.selectbox(
            "Flight Class",
            options=["economy", "premium_economy", "business", "first"],
            index=0,
            format_func=lambda x: x.replace("_", " ").title(),
            help="Select your preferred flight class"
        )
        
        flight_price_range = st.slider(
            "Flight Price Range (USD)",
            min_value=100,
            max_value=5000,
            value=(200, 2000),
            step=50,
            help="Your preferred budget range for flights"
        )
        flight_price_min, flight_price_max = flight_price_range
        
        st.markdown("---")
        st.markdown("### 🏨 Hotel Preferences")

        st.markdown("**Search for a Specific Hotel (Optional)**")
        st.caption("Search by hotel name to find a specific property")
        hotel_lookup = st_searchbox(
            search_hotels_autocomplete,
            key="hotel_lookup_searchbox",
            placeholder="Type hotel name to search...",
            clear_on_submit=False,
            rerun_on_update=False
        )

        # If a hotel is selected via lookup, get its details
        if hotel_lookup and hotel_lookup != st.session_state.get('last_hotel_lookup'):
            st.session_state.last_hotel_lookup = hotel_lookup
            places_client = get_places_client()
            if places_client:
                hotel_details = places_client.get_hotel_details(hotel_lookup)
                if hotel_details:
                    st.session_state.looked_up_hotel = hotel_details
                    st.success(f"Found: **{hotel_details.get('name')}**")

        # Show looked up hotel details if available
        if 'looked_up_hotel' in st.session_state and st.session_state.looked_up_hotel:
            hotel_info = st.session_state.looked_up_hotel
            with st.expander("📍 Selected Hotel Details", expanded=True):
                st.markdown(f"**{hotel_info.get('name', 'Unknown')}**")
                if hotel_info.get('rating'):
                    st.caption(f"⭐ {hotel_info.get('rating')}/5 ({hotel_info.get('user_ratings_total', 0)} reviews)")
                st.caption(f"📍 {hotel_info.get('address', 'Address not available')}")
                if st.button("Clear Selection", key="clear_hotel_lookup"):
                    st.session_state.looked_up_hotel = None
                    st.session_state.last_hotel_lookup = None
                    st.rerun()

        hotel_address = st.text_input(
            "Or Enter Hotel Location/Area (Optional)",
            placeholder="e.g., City center, Near airport, Downtown",
            help="Specify your preferred hotel location or area"
        )

        hotel_price_range = st.slider(
            "Hotel Price Range (USD per night)",
            min_value=30,
            max_value=1000,
            value=(50, 500),
            step=25,
            help="Your preferred budget range for hotel per night"
        )
        hotel_price_min, hotel_price_max = hotel_price_range
        
        st.markdown("---")
        st.markdown("### 🎯 Activity Preferences")
        
        interest_categories = st.multiselect(
            "Interest Categories",
            options=[
                "culture",
                "history",
                "nature",
                "outdoors",
                "food",
                "dining",
                "nightlife",
                "shopping",
                "adventure",
                "family_friendly",
                "art",
                "music",
                "sports",
                "religion",
                "architecture"
            ],
            default=["culture", "food", "nature"],
            format_func=lambda x: x.replace("_", " ").title(),
            help="Select your interests (can select multiple)"
        )
        
        activity_level = st.selectbox(
            "Activity Level",
            options=["relaxed", "moderate", "active"],
            index=1,
            format_func=lambda x: x.title(),
            help="How active do you want your itinerary to be?"
        )
        
        st.markdown("---")

        search_flights_button = st.button("🔍 Search Flights", type="secondary")
        search_hotels_button = st.button("🏨 Search Hotels", type="secondary")
        generate_button = st.button("🚀 Generate Travel Plan", type="primary")
        
        st.markdown("---")
        st.markdown("### ℹ️ About")
        st.markdown("""
        This app generates personalized travel plans customized to your preferences:
        - ✈️ Flight recommendations (choose class and price range)
        - 🏨 Hotel suggestions (set location and price range)
        - 📅 Day-by-day itineraries (based on your interests)
        - 💰 Cost breakdowns
        
        **Customize everything:**
        - Flight class and budget
        - Hotel location and price
        - Activity interests and pace
        - Change dates anytime to see updated plans
        """)
    
    # Initialize session state for selected flight
    if 'selected_flight' not in st.session_state:
        st.session_state.selected_flight = None
    if 'available_flights' not in st.session_state:
        st.session_state.available_flights = []

    # Initialize session state for hotels
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
    
    # Main content area
    # Flight search functionality
    if search_flights_button:
        # Validate inputs
        error = validate_inputs(source, destination, start_date, end_date)
        if error:
            st.error(error)
            return
        
        # Search for flights
        with st.spinner("🔍 Searching for flights... This may take a moment."):
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
                    # Filter by price range
                    filtered_flights = [
                        f for f in flights
                        if flight_price_min <= f.get("price", float("inf")) <= flight_price_max
                    ]
                    
                    if filtered_flights:
                        st.session_state.available_flights = filtered_flights
                        if flights_client.use_mock_data:
                            st.info(f"ℹ️ Using demo flight data (API unavailable). Found {len(filtered_flights)} flight options matching your criteria.")
                        else:
                            st.success(f"✅ Found {len(filtered_flights)} flight options!")
                    elif flights:
                        st.session_state.available_flights = flights
                        st.warning(f"⚠️ Found {len(flights)} flights, but none in your price range. Showing all options.")
                    else:
                        st.session_state.available_flights = []
                        st.warning("⚠️ No flights found. The plan will use estimated flight details.")
                else:
                    st.session_state.available_flights = []
                    st.warning("⚠️ No flights found. The plan will use estimated flight details.")
                    
            except ValueError as e:
                # Configuration error (e.g., missing API key)
                if "AMADEUS" in str(e):
                    st.info("ℹ️ Amadeus API credentials not configured. Using demo flight data for testing.")
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
                        st.success(f"✅ Generated {len(st.session_state.available_flights)} demo flight options!")
                    except:
                        st.session_state.available_flights = []
                else:
                    st.error(f"Error: {str(e)}")
                    st.session_state.available_flights = []
            except Exception as e:
                st.error(f"Error searching flights: {str(e)}")
                st.session_state.available_flights = []
    
    # Display flight options if available
    if st.session_state.available_flights:
        st.markdown("---")
        st.markdown("### ✈️ Available Flights")
        
        # Display flight comparison table
        display_flight_comparison_table(st.session_state.available_flights)
        
        # Get the selected flight from filtered flights stored in session state
        if 'filtered_flights' in st.session_state and 'flight_selection' in st.session_state:
            selected_idx = st.session_state.flight_selection
            filtered_flights = st.session_state.filtered_flights
            if selected_idx is not None and selected_idx < len(filtered_flights):
                st.session_state.selected_flight = filtered_flights[selected_idx]
        else:
            # Default: use first flight if no selection made
            st.session_state.selected_flight = st.session_state.available_flights[0] if st.session_state.available_flights else None

    # Hotel search functionality
    if search_hotels_button:
        # Validate inputs
        error = validate_inputs(source, destination, start_date, end_date)
        if error:
            st.error(error)
        else:
            # Search for hotels
            with st.spinner("🏨 Searching for hotels... This may take a moment."):
                try:
                    hotels_client = HotelsClient()

                    # Get destination coordinates for distance calculation
                    geocoding = get_geocoding_service()
                    landmark_coords = None
                    if geocoding and destination:
                        coords = geocoding.geocode(destination)
                        if coords:
                            landmark_coords = coords
                            st.session_state.destination_coords = coords

                    # Extract city code from destination (first 3 letters uppercase as fallback)
                    city_code = destination[:3].upper() if destination else "NYC"

                    hotels = hotels_client.search_hotels(
                        city_code=city_code,
                        check_in_date=start_date.strftime("%Y-%m-%d"),
                        check_out_date=end_date.strftime("%Y-%m-%d"),
                        adults=travelers,
                        rooms=1,
                        landmark_coords=landmark_coords
                    )

                    if hotels:
                        # Filter by price range
                        filtered_hotels = [
                            h for h in hotels
                            if hotel_price_min <= h.get("price_per_night", float("inf")) <= hotel_price_max
                        ]

                        if filtered_hotels:
                            st.session_state.available_hotels = filtered_hotels
                            if hotels_client.use_mock_data:
                                st.info(f"ℹ️ Using demo hotel data (API unavailable). Found {len(filtered_hotels)} hotel options.")
                            else:
                                st.success(f"✅ Found {len(filtered_hotels)} hotel options!")
                        elif hotels:
                            st.session_state.available_hotels = hotels
                            st.warning(f"⚠️ Found {len(hotels)} hotels, but none in your price range. Showing all options.")
                        else:
                            st.session_state.available_hotels = []
                            st.warning("⚠️ No hotels found.")
                    else:
                        st.session_state.available_hotels = []
                        st.warning("⚠️ No hotels found for this destination.")

                except Exception as e:
                    st.error(f"Error searching hotels: {str(e)}")
                    st.session_state.available_hotels = []

    # Display hotel options if available
    if st.session_state.available_hotels:
        st.markdown("---")
        st.markdown("### 🏨 Available Hotels")
        if st.session_state.destination_coords:
            st.caption(f"Distances calculated from city center")

        # Display hotel comparison table with selection
        display_hotel_comparison_table(st.session_state.available_hotels)

        # Show selected hotel if any
        if st.session_state.selected_hotel:
            st.success(f"✅ Selected Hotel: **{st.session_state.selected_hotel.get('name')}** - ${st.session_state.selected_hotel.get('price_per_night', 0):,.0f}/night")

    # Generate travel plan
    if generate_button:
        # Validate inputs
        error = validate_inputs(source, destination, start_date, end_date)
        if error:
            st.error(error)
            return
        
        # Validate configuration
        try:
            config.validate_config()
        except ValueError as e:
            st.error(f"Configuration Error:\n{e}")
            st.info("Please check your API keys in the .env file")
            return
        
        # Determine which hotel to use: looked up hotel takes priority, then selected from search
        final_selected_hotel = None
        if st.session_state.looked_up_hotel:
            # Convert looked up hotel to the expected format
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

        # Create travel request with selected flight and hotel if available
        travel_request = TravelRequest(
            source=source.strip() if source else "",
            destination=destination.strip() if destination else "",
            start_date=start_date,
            end_date=end_date,
            travelers=travelers,
            trip_type=trip_type,
            flight_class=flight_class,
            flight_price_min=float(flight_price_min),
            flight_price_max=float(flight_price_max),
            hotel_address=hotel_address.strip() if hotel_address else None,
            hotel_price_min=float(hotel_price_min),
            hotel_price_max=float(hotel_price_max),
            interest_categories=interest_categories if interest_categories else ["culture", "food", "nature"],
            activity_level=activity_level,
            selected_flight=st.session_state.selected_flight,
            selected_hotel=final_selected_hotel
        )
        
        # Show progress
        with st.spinner("🔄 Generating your personalized travel plan... This may take a minute."):
            try:
                # Initialize planner
                planner = TravelPlanner()
                
                # Generate single customized plan
                plan = planner.generate_travel_plan(travel_request)
                
                if not plan:
                    st.error("Failed to generate travel plan. Please check your API keys and try again.")
                    return
                
                # Display results
                st.success("✅ Generated your personalized travel plan!")
                st.markdown("---")
                
                # Trip summary header
                duration = (end_date - start_date).days + 1
                st.markdown(f"""
                ### 🌍 Your Travel Plan: {source} → {destination}
                **📅 Trip Dates:** {start_date.strftime('%B %d, %Y')} to {end_date.strftime('%B %d, %Y')}  
                **⏱️ Duration:** {duration} days  
                **👥 Travelers:** {travelers}
                """)
                
                # Display the plan
                display_travel_plan(plan, 1)
                
            except Exception as e:
                st.error(f"An error occurred: {str(e)}")
                st.exception(e)
                st.info("Please check that all API keys are correctly set in your .env file")
    
    else:
        # Initial state - show welcome message
        st.markdown("""
        ### 👋 Welcome to Travel Planner!
        
        **Get started by filling in your trip details and preferences in the sidebar:**
        
        1. Enter your **source location** and **destination**
        2. Select your **travel dates** (you can change them anytime to see updated plans)
        3. Specify the **number of travelers**
        4. Customize your **flight preferences** (class and price range)
        5. Set your **hotel preferences** (location and price range)
        6. Choose your **interests** and **activity level**
        7. Click **"Generate Travel Plan"** to get your personalized itinerary!
        
        ---
        
        **What you'll get:**
        
        ✈️ **One personalized travel plan** customized to your preferences
        
        📋 **Your plan includes:**
        - Flight recommendations matching your class and budget
        - Hotel suggestions in your preferred location and price range
        - Detailed day-by-day itinerary based on your interests
        - Activities tailored to your preferred activity level
        - Complete cost breakdown
        - Travel tips and highlights
        
        💡 **Tip**: Change your dates or preferences and regenerate to see different options!
        
        ---
        
        **Ready to plan your next adventure?** Fill in the sidebar and let's get started! 🗺️
        """)


if __name__ == "__main__":
    main()

