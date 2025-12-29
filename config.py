"""
Configuration module for API keys and settings.
Loads from environment variables or Streamlit secrets (for Streamlit Cloud).
Never commit API keys to version control!
"""
import os
from dotenv import load_dotenv

# Load environment variables from .env file (for local development)
load_dotenv()


def get_secret(key: str, default: str = None) -> str:
    """
    Get a secret from either Streamlit secrets or environment variables.
    Prioritizes Streamlit secrets if available (for deployed apps).
    
    This function safely tries to access Streamlit secrets first (for Streamlit Cloud),
    then falls back to environment variables (for local development).
    """
    # Try Streamlit secrets first (for Streamlit Cloud deployment)
    try:
        import streamlit as st
        from streamlit.errors import StreamlitSecretNotFoundError
        if hasattr(st, 'secrets'):
            try:
                if key in st.secrets:
                    return st.secrets[key]
            except StreamlitSecretNotFoundError:
                # Secrets file not found, fall back to env vars
                pass
    except (ImportError, RuntimeError, AttributeError, Exception):
        # Streamlit not available or not in Streamlit context
        pass
    
    # Fall back to environment variables (for local development)
    return os.getenv(key, default)

# LLM Configuration
OPENAI_API_KEY = get_secret("OPENAI_API_KEY")
DEEPSEEK_API_KEY = get_secret("DEEPSEEK_API_KEY")

# Use OpenAI by default if available, otherwise DeepSeek
USE_OPENAI = OPENAI_API_KEY is not None
LLM_API_KEY = OPENAI_API_KEY if USE_OPENAI else DEEPSEEK_API_KEY

# Amadeus API Configuration
AMADEUS_CLIENT_ID = get_secret("AMADEUS_CLIENT_ID")
AMADEUS_CLIENT_SECRET = get_secret("AMADEUS_CLIENT_SECRET")
AMADEUS_ENVIRONMENT = get_secret("AMADEUS_ENVIRONMENT", "test")  # "test" or "production"

# Google APIs
GOOGLE_PLACES_API_KEY = get_secret("GOOGLE_PLACES_API_KEY")
GOOGLE_GEOCODING_API_KEY = get_secret("GOOGLE_GEOCODING_API_KEY", GOOGLE_PLACES_API_KEY)

# Optional: OpenCage Geocoding
OPENCAGE_API_KEY = get_secret("OPENCAGE_API_KEY")
OPENCAGE_API_BASE_URL = "https://api.opencagedata.com/geocode/v1/json"

def validate_config():
    """Validate that required API keys are set."""
    errors = []
    warnings = []
    
    if not LLM_API_KEY:
        errors.append("Either OPENAI_API_KEY or DEEPSEEK_API_KEY must be set")
    
    # Amadeus API is optional - will use mock data if not available
    if not AMADEUS_CLIENT_ID or not AMADEUS_CLIENT_SECRET:
        warnings.append("AMADEUS_CLIENT_ID or AMADEUS_CLIENT_SECRET not set - will use mock flight data for testing")
    
    # Google Places API is optional but recommended
    if not GOOGLE_PLACES_API_KEY:
        warnings.append("GOOGLE_PLACES_API_KEY not set - location enrichment will be limited")
    
    if errors:
        raise ValueError("Configuration errors:\n" + "\n".join(f"- {e}" for e in errors))
    
    # Print warnings but don't fail
    if warnings:
        import sys
        print("Configuration warnings:", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)
    
    return True

