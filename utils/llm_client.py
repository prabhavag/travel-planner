"""
LLM client for generating travel plans.
Supports OpenAI and DeepSeek APIs.
"""
import json
import re
import openai
from typing import Dict, Any, Optional, List
import config


class LLMClient:
    """Client for LLM API calls."""
    
    def __init__(self):
        api_key = config.LLM_API_KEY
        if not api_key:
            raise ValueError("LLM API key not configured")
        
        self.use_openai = config.USE_OPENAI
        self.api_key = api_key
        
        if self.use_openai:
            self.client = openai.OpenAI(api_key=api_key)
            self.model = "gpt-3.5-turbo"
        else:
            # For DeepSeek or other providers, you'd initialize accordingly
            # This is a placeholder structure
            self.client = openai.OpenAI(
                api_key=api_key,
                base_url="https://api.deepseek.com"  # Update based on provider
            )
            self.model = "deepseek-chat"
    
    def generate_travel_plan(
        self,
        source: str,
        destination: str,
        start_date: str,
        end_date: str,
        duration_days: int,
        travelers: int,
        flight_class: str,
        flight_price_min: float,
        flight_price_max: float,
        hotel_address: Optional[str],
        hotel_price_min: float,
        hotel_price_max: float,
        interest_categories: List[str],
        activity_level: str
    ) -> Dict[str, Any]:
        """
        Generate a travel plan using LLM based on user preferences.
        
        Args:
            source: Source location
            destination: Destination location
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            duration_days: Number of days
            travelers: Number of travelers
            flight_class: Flight class preference
            flight_price_min: Minimum flight price
            flight_price_max: Maximum flight price
            hotel_address: Preferred hotel location/address
            hotel_price_min: Minimum hotel price per night
            hotel_price_max: Maximum hotel price per night
            interest_categories: List of interest categories
            activity_level: Activity level preference
            
        Returns:
            Dictionary containing the travel plan
        """
        prompt = self._build_prompt(
            source, destination, start_date, end_date,
            duration_days, travelers, flight_class, flight_price_min,
            flight_price_max, hotel_address, hotel_price_min,
            hotel_price_max, interest_categories, activity_level
        )
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_system_prompt()},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                response_format={"type": "json_object"} if self.use_openai else None
            )
            
            content = response.choices[0].message.content
            plan_data = json.loads(content)
            
            return plan_data
            
        except Exception as e:
            print(f"Error generating travel plan: {e}")
            raise
    
    def _get_system_prompt(self) -> str:
        """Get the system prompt for the LLM."""
        return """You are an expert travel planner. Generate detailed, realistic travel plans in JSON format.
Be specific with activities, locations, and recommendations. Provide accurate price estimates based on the plan type.
Always return valid JSON."""

    def _build_prompt(
        self,
        source: str,
        destination: str,
        start_date: str,
        end_date: str,
        duration_days: int,
        travelers: int,
        flight_class: str,
        flight_price_min: float,
        flight_price_max: float,
        hotel_address: Optional[str],
        hotel_price_min: float,
        hotel_price_max: float,
        interest_categories: List[str],
        activity_level: str
    ) -> str:
        """Build the user prompt for travel plan generation based on preferences."""
        
        # Format flight class for display
        flight_class_display = flight_class.replace("_", " ").title()
        
        # Format interest categories
        interests_str = ", ".join([cat.replace("_", " ").title() for cat in interest_categories]) if interest_categories else "General tourism"
        
        # Build hotel location preference
        hotel_location_note = ""
        if hotel_address:
            hotel_location_note = f"IMPORTANT: User prefers hotel location: {hotel_address}. Try to suggest hotels in this area."
        
        prompt = f"""Generate a detailed personalized travel plan from {source} to {destination} based on the following preferences:

Trip Details:
- Source: {source}
- Destination: {destination}
- Start Date: {start_date}
- End Date: {end_date}
- Duration: {duration_days} days (IMPORTANT: Generate itinerary for ALL {duration_days} days)
- Travelers: {travelers}

Flight Preferences:
- Class: {flight_class_display}
- Price Range: ${flight_price_min:.0f} - ${flight_price_max:.0f}

Hotel Preferences:
- Type: Hotel only
- Price Range: ${hotel_price_min:.0f} - ${hotel_price_max:.0f} per night
{hotel_location_note}

Activity Preferences:
- Interests: {interests_str}
- Activity Level: {activity_level.title()}

Guidelines:
- Transportation: {flight_class_display} class flights, stay within ${flight_price_min:.0f}-${flight_price_max:.0f} price range
- Accommodation: Hotels in the ${hotel_price_min:.0f}-${hotel_price_max:.0f}/night range{f" near {hotel_address}" if hotel_address else ""}
- Activities: Focus on {interests_str}. Activity level should be {activity_level} ({"more relaxed pace, fewer activities" if activity_level == "relaxed" else "moderate pace with balanced activities" if activity_level == "moderate" else "active schedule with many activities and experiences"})
- Dining: Match the hotel price range level - {"budget-friendly options" if hotel_price_max < 150 else "mid-range restaurants" if hotel_price_max < 300 else "fine dining and premium restaurants"}

Generate a comprehensive travel plan in JSON format with the following structure:

{{
    "plan_type": "customized",
    "summary": "Brief summary of the plan",
    "transportation": {{
        "type": "flight",
        "from_location": "{source}",
        "to_location": "{destination}",
        "departure_date": "{start_date}",
        "arrival_date": "{start_date}",
        "airline": "suggested airline",
        "class_type": "{flight_class}",
        "estimated_price": 0.0,
        "duration": "estimated duration",
        "notes": "any relevant notes"
    }},
    "accommodation": {{
        "name": "hotel name suggestion",
        "type": "hotel",
        "location": "{destination}",
        "price_per_night": 0.0,
        "total_price": 0.0,
        "check_in": "{start_date}",
        "check_out": "{end_date}",
        "nights": {duration_days},
        "rating": 0.0,
        "amenities": ["amenity1", "amenity2"],
        "notes": "accommodation notes"
    }},
    "itinerary": [
        {{
            "date": "YYYY-MM-DD",
            "day_number": 1,
            "morning": [{{"name": "activity", "type": "attraction", "time": "morning", "description": "...", "location": "...", "duration": "...", "cost": 0.0}}],
            "afternoon": [{{"name": "activity", "type": "attraction", "time": "afternoon", "description": "...", "location": "...", "duration": "...", "cost": 0.0}}],
            "evening": [{{"name": "activity", "type": "restaurant", "time": "evening", "description": "...", "location": "...", "duration": "...", "cost": 0.0}}]
        }},
        {{
            "date": "YYYY-MM-DD",
            "day_number": 2,
            "morning": [...],
            "afternoon": [...],
            "evening": [...]
        }}
        ... generate for ALL {duration_days} days of the trip ...
    ],
    "cost_breakdown": {{
        "transportation": 0.0,
        "accommodation": 0.0,
        "activities": 0.0,
        "food": 0.0,
        "local_transport": 0.0,
        "total": 0.0,
        "per_person": 0.0
    }},
    "highlights": ["highlight1", "highlight2"],
    "tips": ["tip1", "tip2"]
}}

CRITICAL REQUIREMENTS:
1. Generate itinerary for ALL {duration_days} days of the trip (from {start_date} to {end_date})
2. Each day must have day_number from 1 to {duration_days}, with corresponding dates
3. Fill in realistic activities for EACH day matching the interests: {interests_str}
4. Include morning, afternoon, and evening activities for EVERY day
5. Provide accurate price estimates within the specified ranges (flight: ${flight_price_min:.0f}-${flight_price_max:.0f}, hotel: ${hotel_price_min:.0f}-${hotel_price_max:.0f}/night)
6. Match the {activity_level} activity level - {"pace should be relaxed" if activity_level == "relaxed" else "moderate pace" if activity_level == "moderate" else "active and packed schedule"}
7. All prices should be in USD
8. Focus activities on: {interests_str}
9. The itinerary array MUST contain exactly {duration_days} day objects, one for each day of the trip
10. Return ONLY valid JSON, no additional text"""
        
        return prompt

    def modify_itinerary(
        self,
        current_plan: Dict[str, Any],
        user_message: str,
        conversation_history: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """
        Modify an existing travel plan based on user chat input.

        Args:
            current_plan: The current travel plan as a dictionary
            user_message: The user's modification request
            conversation_history: List of previous chat messages

        Returns:
            Dictionary containing the modified travel plan
        """
        system_prompt = """You are an expert travel planner assistant. You are helping modify an existing travel itinerary based on user feedback.

Your task is to:
1. Understand the user's request for changes
2. Modify ONLY the relevant parts of the itinerary
3. Keep ALL other fields intact (source, destination, dates, travelers, costs, etc.)
4. Return the complete modified plan in the EXACT same JSON structure

Be helpful. If the user asks to:
- Add an activity: Find an appropriate time slot and add it
- Remove an activity: Remove it from the itinerary
- Change a restaurant: Replace it with a suitable alternative
- Swap days: Reorganize the itinerary accordingly
- Add more free time: Reduce activities appropriately
- Make it more active/relaxed: Adjust activity density
- Focus on specific interests: Modify activities to match

CRITICAL: Your response must be a valid JSON object with this EXACT structure:
{
    "plan_type": "string",
    "source": "string",
    "destination": "string",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "duration_days": number,
    "travelers": number,
    "transportation": [{"type": "flight", "from_location": "...", "to_location": "...", "departure_date": "...", "arrival_date": "...", ...}],
    "accommodation": {"name": "...", "type": "hotel", "location": "...", "check_in": "...", "check_out": "...", "nights": number, ...},
    "itinerary": [{"date": "YYYY-MM-DD", "day_number": 1, "morning": [...], "afternoon": [...], "evening": [...]}],
    "cost_breakdown": {"transportation": 0, "accommodation": 0, "activities": 0, "food": 0, "local_transport": 0, "total": 0},
    "summary": "string",
    "highlights": ["..."],
    "tips": ["..."]
}

IMPORTANT:
- "transportation" must be an ARRAY (list) of transportation objects
- Keep all existing field values unless the user specifically asks to change them
- Return ONLY the JSON object, no additional text or explanation"""

        # Build conversation context
        messages = [{"role": "system", "content": system_prompt}]

        # Add the current plan context
        plan_context = f"""Here is the current travel plan that needs to be modified:

```json
{json.dumps(current_plan, indent=2)}
```

Modify this plan according to the user's request. Return the complete updated plan as a valid JSON object."""

        messages.append({"role": "user", "content": plan_context})
        messages.append({"role": "assistant", "content": "I understand the current travel plan. What changes would you like to make?"})

        # Add conversation history (limit to last 6 messages to avoid token limits)
        recent_history = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history
        for msg in recent_history:
            messages.append(msg)

        # Add the current user message
        messages.append({"role": "user", "content": user_message})

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                response_format={"type": "json_object"} if self.use_openai else None
            )

            content = response.choices[0].message.content

            # Try to parse the JSON from the response
            modified_plan = json.loads(content)

            # Ensure transportation is a list
            if "transportation" in modified_plan and not isinstance(modified_plan["transportation"], list):
                modified_plan["transportation"] = [modified_plan["transportation"]]

            # Merge with original plan to ensure no required fields are missing
            merged_plan = {**current_plan, **modified_plan}

            return {
                "success": True,
                "plan": merged_plan,
                "message": "Itinerary updated successfully!"
            }

        except json.JSONDecodeError:
            # If JSON parsing fails, try to extract JSON from the response
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                try:
                    modified_plan = json.loads(json_match.group())
                    # Ensure transportation is a list
                    if "transportation" in modified_plan and not isinstance(modified_plan["transportation"], list):
                        modified_plan["transportation"] = [modified_plan["transportation"]]
                    merged_plan = {**current_plan, **modified_plan}
                    return {
                        "success": True,
                        "plan": merged_plan,
                        "message": "Itinerary updated successfully!"
                    }
                except json.JSONDecodeError:
                    pass
            return {
                "success": False,
                "plan": current_plan,
                "message": "I understood your request but had trouble updating the plan. Could you try rephrasing?"
            }
        except Exception as e:
            print(f"Error modifying itinerary: {e}")
            return {
                "success": False,
                "plan": current_plan,
                "message": "Sorry, something went wrong while updating the itinerary. Please try again."
            }

