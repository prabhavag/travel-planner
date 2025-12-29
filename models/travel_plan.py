"""
Data models for travel plans.
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import date, datetime


class Transportation(BaseModel):
    """Transportation details."""
    type: str  # "flight", "train", "bus", "car", etc.
    from_location: str
    to_location: str
    departure_date: str
    departure_time: Optional[str] = None
    arrival_date: str
    arrival_time: Optional[str] = None
    airline: Optional[str] = None
    flight_number: Optional[str] = None
    class_type: Optional[str] = None  # "economy", "business", etc.
    price: Optional[float] = None
    currency: str = "USD"
    duration: Optional[str] = None
    notes: Optional[str] = None


class Accommodation(BaseModel):
    """Accommodation details."""
    name: str
    type: str  # "hotel", "hostel", "airbnb", etc.
    location: str
    price_per_night: Optional[float] = None
    total_price: Optional[float] = None
    currency: str = "USD"
    rating: Optional[float] = None
    address: Optional[str] = None
    check_in: str
    check_out: str
    nights: int
    notes: Optional[str] = None
    amenities: Optional[List[str]] = None


class Activity(BaseModel):
    """Activity or attraction."""
    name: str
    type: str  # "attraction", "restaurant", "activity", etc.
    time: str  # "morning", "afternoon", "evening"
    description: Optional[str] = None
    location: Optional[str] = None
    duration: Optional[str] = None
    cost: Optional[float] = None
    currency: str = "USD"
    notes: Optional[str] = None
    rating: Optional[float] = None  # Rating from Google Places API
    user_ratings_total: Optional[int] = None  # Total number of ratings from Google Places API


class DayItinerary(BaseModel):
    """Day-by-day itinerary."""
    date: str
    day_number: int
    morning: List[Activity]
    afternoon: List[Activity]
    evening: List[Activity]
    notes: Optional[str] = None


class CostBreakdown(BaseModel):
    """Cost breakdown for the travel plan."""
    transportation: float
    accommodation: float
    activities: float
    food: float
    local_transport: float
    total: float
    currency: str = "USD"
    per_person: Optional[float] = None


class TravelPlan(BaseModel):
    """Complete travel plan."""
    plan_type: str  # "budget", "balanced", "comfort"
    source: str
    destination: str
    start_date: str
    end_date: str
    duration_days: int
    travelers: int
    
    transportation: List[Transportation]
    accommodation: Accommodation
    itinerary: List[DayItinerary]
    cost_breakdown: CostBreakdown
    
    summary: Optional[str] = None
    highlights: Optional[List[str]] = None
    tips: Optional[List[str]] = None


class TravelRequest(BaseModel):
    """User's travel request input with preferences."""
    source: str
    destination: str
    start_date: date
    end_date: date
    travelers: int = 1
    trip_type: str = "return"  # "one_way" or "return"
    
    # Flight preferences
    flight_class: str = "economy"  # "economy", "premium_economy", "business", "first"
    flight_price_min: float = 200.0
    flight_price_max: float = 2000.0
    
    # Hotel preferences
    hotel_address: Optional[str] = None  # User-provided hotel address/location preference
    hotel_price_min: float = 50.0
    hotel_price_max: float = 500.0
    
    # Activity preferences
    interest_categories: List[str] = []  # e.g., ["culture", "food", "nature"]
    activity_level: str = "moderate"  # "relaxed", "moderate", "active"
    
    # Selected flight (optional - user can select from flight options)
    selected_flight: Optional[Dict[str, Any]] = None

