"""
Travel Planner Streamlit App
Main application entry point.
"""
import streamlit as st
from datetime import date, datetime, timedelta
from typing import List, Optional

from models.travel_plan import TravelPlan, TravelRequest
from utils.travel_planner import TravelPlanner
from utils.display_helpers import display_travel_plan
from utils.flights_client import FlightsClient
from utils.flight_display import display_flight_comparison_table
import config


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


def validate_inputs(source: str, destination: str, start_date: date, end_date: date) -> Optional[str]:
    """Validate user inputs."""
    if not source or not source.strip():
        return "Please enter a source location"
    
    if not destination or not destination.strip():
        return "Please enter a destination"
    
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
        
        source = st.text_input(
            "Source Location",
            placeholder="e.g., New York, NY",
            help="Your current location or departure city"
        )
        
        destination = st.text_input(
            "Destination",
            placeholder="e.g., Paris, France",
            help="Your travel destination"
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
        
        hotel_address = st.text_input(
            "Preferred Hotel Location/Address (Optional)",
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
        
        # Create travel request with selected flight if available
        travel_request = TravelRequest(
            source=source.strip(),
            destination=destination.strip(),
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
            selected_flight=st.session_state.selected_flight
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

