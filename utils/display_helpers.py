"""
Streamlit display helpers for rendering travel plans.
"""
import streamlit as st
import streamlit.components.v1 as components
from typing import List, Optional
from models.travel_plan import TravelPlan, Activity, DayItinerary
from utils.map_display import create_day_map, extract_places_from_day


def display_travel_plan(plan: TravelPlan, plan_number: int, places_client=None):
    """
    Display a travel plan in Streamlit.

    Args:
        plan: TravelPlan object to display
        plan_number: Plan number (1, 2, or 3)
        places_client: Optional PlacesClient for fetching map data
    """
    plan_titles = {
        "budget": "💰 Budget-Friendly",
        "balanced": "⚖️ Balanced",
        "comfort": "✨ Comfort-Focused",
        "customized": "✨ Your Customized Plan"
    }
    
    title = plan_titles.get(plan.plan_type, "✨ Your Travel Plan")
    
    with st.container():
        st.markdown(f"### {plan_number}. {title}")
        
        # Summary
        if plan.summary:
            st.info(plan.summary)
        
        # Cost overview
        col1, col2, col3 = st.columns(3)
        with col1:
            st.metric("Total Cost", f"${plan.cost_breakdown.total:,.0f}")
        with col2:
            if plan.cost_breakdown.per_person:
                st.metric("Per Person", f"${plan.cost_breakdown.per_person:,.0f}")
            else:
                st.metric("Per Person", f"${plan.cost_breakdown.total / plan.travelers:,.0f}")
        with col3:
            st.metric("Duration", f"{plan.duration_days} days")
        
        # Transportation
        with st.expander("✈️ Transportation Details", expanded=False):
            for transport in plan.transportation:
                st.write(f"**Type:** {transport.type.title()}")
                if transport.airline:
                    st.write(f"**Airline:** {transport.airline}")
                if transport.flight_number:
                    st.write(f"**Flight Number:** {transport.flight_number}")
                if transport.departure_time:
                    st.write(f"**Departure:** {transport.departure_date} at {transport.departure_time}")
                if transport.arrival_time:
                    st.write(f"**Arrival:** {transport.arrival_date} at {transport.arrival_time}")
                if transport.duration:
                    st.write(f"**Duration:** {transport.duration}")
                if transport.price:
                    st.write(f"**Price:** ${transport.price:,.0f} {transport.currency}")
                if transport.notes:
                    st.write(f"*{transport.notes}*")
        
        # Accommodation
        with st.expander("🏨 Accommodation", expanded=False):
            st.write(f"**{plan.accommodation.name}**")
            st.write(f"**Type:** {plan.accommodation.type.title()}")
            st.write(f"**Location:** {plan.accommodation.location}")
            if plan.accommodation.rating:
                st.write(f"**Rating:** {plan.accommodation.rating} ⭐")
            if plan.accommodation.price_per_night:
                st.write(f"**Price per night:** ${plan.accommodation.price_per_night:,.0f}")
            if plan.accommodation.total_price:
                st.write(f"**Total ({plan.accommodation.nights} nights):** ${plan.accommodation.total_price:,.0f}")
            if plan.accommodation.amenities:
                st.write(f"**Amenities:** {', '.join(plan.accommodation.amenities)}")
            if plan.accommodation.notes:
                st.write(f"*{plan.accommodation.notes}*")
        
        # Cost Breakdown
        with st.expander("💰 Detailed Cost Breakdown", expanded=False):
            col1, col2 = st.columns(2)
            with col1:
                st.write(f"**Transportation:** ${plan.cost_breakdown.transportation:,.0f}")
                st.write(f"**Accommodation:** ${plan.cost_breakdown.accommodation:,.0f}")
                st.write(f"**Activities:** ${plan.cost_breakdown.activities:,.0f}")
            with col2:
                st.write(f"**Food:** ${plan.cost_breakdown.food:,.0f}")
                st.write(f"**Local Transport:** ${plan.cost_breakdown.local_transport:,.0f}")
            st.markdown("---")
            st.write(f"### **Total: ${plan.cost_breakdown.total:,.0f}**")
        
        # Highlights
        if plan.highlights:
            with st.expander("🌟 Highlights", expanded=False):
                for highlight in plan.highlights:
                    st.write(f"• {highlight}")
        
        # Itinerary
        st.markdown("---")
        st.markdown("### 📅 Day-by-Day Itinerary")

        for day in plan.itinerary:
            display_day_itinerary(day, places_client)
        
        # Tips
        if plan.tips:
            with st.expander("💡 Travel Tips", expanded=False):
                for tip in plan.tips:
                    st.write(f"• {tip}")
        
        st.markdown("---")


def display_day_itinerary(day: DayItinerary, places_client=None):
    """Display a single day's itinerary with a map."""
    st.markdown(f"#### Day {day.day_number} - {day.date}")

    # Create two columns: activities on left, map on right
    col_activities, col_map = st.columns([3, 2])

    with col_activities:
        # Morning
        if day.morning:
            st.markdown("**☀️ Morning**")
            for activity in day.morning:
                display_activity(activity)

        # Afternoon
        if day.afternoon:
            st.markdown("**🌤️ Afternoon**")
            for activity in day.afternoon:
                display_activity(activity)

        # Evening
        if day.evening:
            st.markdown("**🌙 Evening**")
            for activity in day.evening:
                display_activity(activity)

        if day.notes:
            st.caption(f"*Note: {day.notes}*")

    with col_map:
        # Extract places and create map for this day
        if places_client:
            with st.spinner("Loading map..."):
                day_places = extract_places_from_day(day, places_client)
                if day_places:
                    map_html = create_day_map(day_places, day.day_number, height=280)
                    if map_html:
                        components.html(map_html, height=300)
                    else:
                        st.caption("📍 Map not available")
                else:
                    st.caption("📍 Map locations not found")
        else:
            st.caption("📍 Map requires Places API")

    st.markdown("---")


def display_activity(activity: Activity):
    """Display a single activity."""
    activity_icons = {
        "attraction": "🎯",
        "restaurant": "🍽️",
        "activity": "🎪",
        "transport": "🚗"
    }
    
    icon = activity_icons.get(activity.type, "📍")
    
    # Build activity text
    activity_text = f"{icon} **{activity.name}**"
    
    if activity.location:
        activity_text += f" - *{activity.location}*"
    
    # Display rating if available
    if activity.rating:
        activity_text += f" ⭐ {activity.rating:.1f}" if isinstance(activity.rating, (int, float)) else f" ⭐ {activity.rating}"
    
    if activity.duration:
        activity_text += f" ({activity.duration})"
    
    if activity.cost and activity.cost > 0:
        activity_text += f" - ${activity.cost:,.0f}"
    
    st.write(activity_text)
    
    if activity.description:
        st.caption(activity.description)
    
    if activity.notes:
        st.caption(f"*{activity.notes}*")


def display_plan_comparison(plans: List[TravelPlan]):
    """Display a comparison table of all plans."""
    if not plans:
        return
    
    st.markdown("### 📊 Plan Comparison")
    
    comparison_data = []
    for plan in plans:
        comparison_data.append({
            "Plan": plan.plan_type.capitalize(),
            "Total Cost": f"${plan.cost_breakdown.total:,.0f}",
            "Per Person": f"${plan.cost_breakdown.per_person or (plan.cost_breakdown.total / plan.travelers):,.0f}",
            "Transportation": f"${plan.cost_breakdown.transportation:,.0f}",
            "Accommodation": f"${plan.cost_breakdown.accommodation:,.0f}",
            "Activities": f"${plan.cost_breakdown.activities:,.0f}"
        })
    
    st.table(comparison_data)

