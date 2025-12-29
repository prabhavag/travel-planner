"""
Flight selection and display utilities.
"""
import streamlit as st
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta


def display_flight_options(
    flights: List[Dict[str, Any]],
    default_selected: int = 0
) -> Optional[int]:
    """
    Display flight options in an interactive table format.
    Returns the index of the selected flight.
    
    Args:
        flights: List of flight dictionaries
        default_selected: Index of default selected flight
        
    Returns:
        Index of selected flight, or None if none selected
    """
    if not flights:
        st.warning("No flight options available. Using estimated flight details.")
        return None
    
    st.markdown("### ✈️ Flight Options")
    st.markdown("Select a flight from the options below:")
    
    # Sort options
    col1, col2, col3 = st.columns(3)
    with col1:
        sort_by = st.selectbox(
            "Sort by",
            options=["price", "duration", "departure_time", "stops"],
            index=0,
            format_func=lambda x: {
                "price": "💰 Price (Low to High)",
                "duration": "⏱️ Duration (Shortest)",
                "departure_time": "🕐 Departure Time",
                "stops": "✈️ Stops (Direct First)"
            }.get(x, x.replace("_", " ").title())
        )
    
    with col2:
        filter_stops = st.selectbox(
            "Filter by stops",
            options=["all", "direct", "1_stop", "2plus_stops"],
            index=0,
            format_func=lambda x: {
                "all": "All flights",
                "direct": "Direct only",
                "1_stop": "1 stop max",
                "2plus_stops": "2+ stops allowed"
            }.get(x, x.replace("_", " ").title())
        )
    
    with col3:
        max_results = st.number_input(
            "Max results",
            min_value=5,
            max_value=50,
            value=10,
            step=5
        )
    
    # Sort flights
    sorted_flights = _sort_flights(flights, sort_by)
    
    # Filter flights
    filtered_flights = _filter_flights(sorted_flights, filter_stops)
    
    # Limit results
    display_flights = filtered_flights[:max_results]
    
    if not display_flights:
        st.warning("No flights match your filters. Adjust filters and try again.")
        return None
    
    st.markdown("---")
    
    # Display flights in a selectable format
    selected_index = None
    
    # Create columns for flight cards
    for idx, flight in enumerate(display_flights):
        with st.container():
            # Create a unique key for each flight
            flight_key = f"flight_{idx}"
            
            # Flight card
            col1, col2, col3, col4 = st.columns([3, 2, 2, 2])
            
            with col1:
                # Airline and flight number
                airline = flight.get("airline", "Unknown")
                flight_num = flight.get("flight_number", "")
                st.markdown(f"**{airline}**")
                if flight_num:
                    st.caption(f"Flight {flight_num}")
            
            with col2:
                # Departure/Arrival times
                dep_time = flight.get("departure_time", "N/A")
                arr_time = flight.get("arrival_time", "N/A")
                st.markdown(f"**{dep_time}** → **{arr_time}**")
                
                # Duration
                duration = flight.get("duration", "N/A")
                st.caption(f"⏱️ {duration}")
            
            with col3:
                # Stops
                stops = flight.get("stops", 0)
                if stops == 0:
                    st.markdown("**Direct** ✈️")
                else:
                    st.markdown(f"**{stops} stop{'s' if stops > 1 else ''}**")
                
                # Class
                class_type = flight.get("class_type", "economy")
                st.caption(class_type.replace("_", " ").title())
            
            with col4:
                # Price
                price = flight.get("price", 0.0)
                currency = flight.get("currency", "USD")
                st.markdown(f"### **${price:,.0f}**")
                st.caption(currency)
            
            # Radio button for selection
            is_selected = st.radio(
                "Select this flight",
                options=[False, True],
                index=1 if idx == default_selected else 0,
                key=f"select_{flight_key}",
                label_visibility="collapsed",
                horizontal=True
            )
            
            if is_selected:
                selected_index = idx
                st.success("✓ Selected")
            
            st.markdown("---")
    
    if selected_index is not None:
        return selected_index
    
    return default_selected if default_selected < len(display_flights) else 0


def _sort_flights(flights: List[Dict[str, Any]], sort_by: str) -> List[Dict[str, Any]]:
    """Sort flights by the specified criteria."""
    if sort_by == "price":
        return sorted(flights, key=lambda x: x.get("price", float("inf")))
    elif sort_by == "duration":
        # Sort by duration (parse duration string if possible)
        return sorted(
            flights,
            key=lambda x: _parse_duration_to_minutes(x.get("duration", ""))
        )
    elif sort_by == "departure_time":
        return sorted(
            flights,
            key=lambda x: x.get("departure_time", "23:59")
        )
    elif sort_by == "stops":
        return sorted(flights, key=lambda x: x.get("stops", 999))
    else:
        return flights


def _filter_flights(flights: List[Dict[str, Any]], filter_stops: str) -> List[Dict[str, Any]]:
    """Filter flights by number of stops."""
    if filter_stops == "all":
        return flights
    elif filter_stops == "direct":
        return [f for f in flights if f.get("stops", 999) == 0]
    elif filter_stops == "1_stop":
        return [f for f in flights if f.get("stops", 999) <= 1]
    elif filter_stops == "2plus_stops":
        return [f for f in flights if f.get("stops", 999) >= 2]
    else:
        return flights


def _parse_duration_to_minutes(duration_str: str) -> int:
    """Parse duration string (e.g., '5h 30m') to minutes."""
    if not duration_str:
        return 9999
    
    try:
        # Try to parse formats like "5h 30m", "5h30m", "5:30", etc.
        hours = 0
        minutes = 0
        
        # Handle "5h 30m" format
        if "h" in duration_str.lower():
            parts = duration_str.lower().split("h")
            hours = int(parts[0].strip()) if parts[0].strip().isdigit() else 0
            if len(parts) > 1 and "m" in parts[1]:
                minutes = int(parts[1].replace("m", "").strip()) if parts[1].replace("m", "").strip().isdigit() else 0
        # Handle "5:30" format
        elif ":" in duration_str:
            parts = duration_str.split(":")
            hours = int(parts[0]) if parts[0].isdigit() else 0
            minutes = int(parts[1]) if parts[1].isdigit() else 0
        # Handle just minutes
        elif "m" in duration_str.lower():
            minutes = int(duration_str.lower().replace("m", "").strip()) if duration_str.lower().replace("m", "").strip().isdigit() else 0
        
        return hours * 60 + minutes
    except:
        return 9999


def display_flight_comparison_table(flights: List[Dict[str, Any]]) -> Optional[int]:
    """
    Display flights in an interactive comparison format similar to Google Flights.
    Returns the index of the selected flight.
    
    Args:
        flights: List of flight dictionaries
        
    Returns:
        Index of selected flight, or None
    """
    if not flights:
        return None
    
    # Add sorting and filtering options
    col1, col2 = st.columns(2)
    with col1:
        sort_by = st.selectbox(
            "Sort by",
            options=["price", "duration", "departure_time", "stops"],
            index=0,
            key="flight_sort",
            format_func=lambda x: {
                "price": "💰 Price (Low to High)",
                "duration": "⏱️ Duration (Shortest)",
                "departure_time": "🕐 Departure Time",
                "stops": "✈️ Stops (Direct First)"
            }.get(x, x.replace("_", " ").title())
        )
    
    with col2:
        filter_stops = st.selectbox(
            "Filter by stops",
            options=["all", "direct", "1_stop", "2plus_stops"],
            index=0,
            key="flight_filter",
            format_func=lambda x: {
                "all": "All flights",
                "direct": "Direct only",
                "1_stop": "1 stop max",
                "2plus_stops": "2+ stops allowed"
            }.get(x, x.replace("_", " ").title())
        )
    
    # Sort and filter
    sorted_flights = _sort_flights(flights, sort_by)
    filtered_flights = _filter_flights(sorted_flights, filter_stops)
    
    if not filtered_flights:
        st.warning("No flights match your filters. Try adjusting the filters.")
        return 0
    
    st.markdown("---")
    
    # Display flights in radio buttons for selection
    st.markdown("**Select a flight:**")
    selected_idx = st.radio(
        "",
        options=range(len(filtered_flights)),
        format_func=lambda x: _format_flight_option(filtered_flights[x]),
        index=0,
        key="flight_selection"
    )
    
    # Store filtered flights in session state so app.py can access the selected one
    st.session_state.filtered_flights = filtered_flights
    
    # Show details for selected flight
    if selected_idx is not None and selected_idx < len(filtered_flights):
        flight = filtered_flights[selected_idx]
        
        st.markdown("#### ✈️ Selected Flight Details")
        
        # Check if this is a return trip
        is_return_trip = flight.get('trip_type') == 'return' or flight.get('return_date')
        
        if is_return_trip:
            # Show outbound and return flight information
            st.markdown("**🛫 Outbound Flight:**")
            col1, col2, col3 = st.columns(3)
            with col1:
                st.write(f"**Airline:** {flight.get('airline', 'Unknown')}")
                st.write(f"**Flight Number:** {flight.get('flight_number', 'N/A')}")
                st.write(f"**Class:** {flight.get('class_type', 'economy').replace('_', ' ').title()}")
            with col2:
                st.write(f"**Departure:** {flight.get('departure_time', 'N/A')}")
                st.write(f"**Arrival:** {flight.get('arrival_time', 'N/A')}")
                st.write(f"**Duration:** {flight.get('duration', 'N/A')}")
            with col3:
                stops = flight.get('stops', 0)
                st.write(f"**Stops:** {stops if stops > 0 else 'Direct ✈️'}")
            
            st.markdown("**🛬 Return Flight:**")
            col1, col2, col3 = st.columns(3)
            with col1:
                st.write(f"**Airline:** {flight.get('return_airline', flight.get('airline', 'Unknown'))}")
                st.write(f"**Flight Number:** {flight.get('return_flight_number', 'N/A')}")
                st.write(f"**Class:** {flight.get('class_type', 'economy').replace('_', ' ').title()}")
            with col2:
                st.write(f"**Departure:** {flight.get('return_departure_time', 'N/A')}")
                st.write(f"**Arrival:** {flight.get('return_arrival_time', 'N/A')}")
                st.write(f"**Duration:** {flight.get('return_duration', 'N/A')}")
            with col3:
                return_stops = flight.get('return_stops', flight.get('stops', 0))
                st.write(f"**Stops:** {return_stops if return_stops > 0 else 'Direct ✈️'}")
                st.write(f"**Return Date:** {flight.get('return_date', 'N/A')}")
                price = flight.get('price', 0.0)
                currency = flight.get('currency', 'USD')
                st.write(f"**Total Price (Round Trip):** ${price:,.0f} {currency}")
        else:
            # One-way flight
            col1, col2, col3 = st.columns(3)
            with col1:
                st.write(f"**Airline:** {flight.get('airline', 'Unknown')}")
                st.write(f"**Flight Number:** {flight.get('flight_number', 'N/A')}")
                st.write(f"**Class:** {flight.get('class_type', 'economy').replace('_', ' ').title()}")
            with col2:
                st.write(f"**Departure:** {flight.get('departure_time', 'N/A')}")
                st.write(f"**Arrival:** {flight.get('arrival_time', 'N/A')}")
                st.write(f"**Duration:** {flight.get('duration', 'N/A')}")
            with col3:
                stops = flight.get('stops', 0)
                st.write(f"**Stops:** {stops if stops > 0 else 'Direct ✈️'}")
                price = flight.get('price', 0.0)
                currency = flight.get('currency', 'USD')
                st.write(f"**Price:** ${price:,.0f} {currency}")
        
        return selected_idx
    
    return 0


def _format_flight_option(flight: Dict[str, Any]) -> str:
    """Format flight option for radio button display."""
    airline = flight.get('airline', 'Unknown')
    dep_time = flight.get('departure_time', 'N/A')
    arr_time = flight.get('arrival_time', 'N/A')
    price = flight.get('price', 0.0)
    stops = flight.get('stops', 0)
    stops_text = "Direct" if stops == 0 else f"{stops} stop{'s' if stops > 1 else ''}"
    
    # Check if it's a return trip
    is_return = flight.get('trip_type') == 'return' or flight.get('return_date')
    trip_label = " (Round Trip)" if is_return else " (One Way)"
    
    return f"{airline} | {dep_time}→{arr_time} | {stops_text} | ${price:,.0f}{trip_label}"

