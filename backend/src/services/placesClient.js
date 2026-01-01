const { Client } = require("@googlemaps/google-maps-services-js");

class PlacesClient {
    constructor() {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
            throw new Error("GOOGLE_PLACES_API_KEY not set.");
        }

        if (!apiKey.trim()) {
            throw new Error("GOOGLE_PLACES_API_KEY is empty.");
        }

        this.client = new Client({});
        this.apiKey = apiKey.trim();
    }

    async searchPlaces(query, location = null, radius = 5000, placeType = null) {
        try {
            let params = {
                key: this.apiKey
            };

            if (location) {
                // Nearby search
                params.location = location; // {lat, lng}
                params.radius = radius;
                if (placeType) params.type = placeType;
                params.keyword = query;

                const response = await this.client.placesNearby({ params });
                return this._processResults(response.data.results);
            } else {
                // Text search
                params.query = query;
                if (placeType) params.type = placeType;

                const response = await this.client.textSearch({ params });
                return this._processResults(response.data.results);
            }
        } catch (error) {
            console.error("Error searching places:", error.message);
            return [];
        }
    }

    _processResults(results) {
        return results.slice(0, 10).map(place => ({
            name: place.name,
            place_id: place.place_id,
            types: place.types,
            rating: place.rating || 0.0,
            user_ratings_total: place.user_ratings_total || 0,
            location: place.geometry.location,
            vicinity: place.vicinity || place.formatted_address || '',
            price_level: place.price_level
        }));
    }

    async getPlaceDetails(placeId) {
        try {
            const response = await this.client.placeDetails({
                params: {
                    place_id: placeId,
                    key: this.apiKey,
                    // fields: ['name', 'formatted_address', 'geometry', 'rating', 'user_ratings_total', 'photos'] 
                }
            });

            const result = response.data.result;
            return {
                name: result.name,
                formatted_address: result.formatted_address,
                formatted_phone_number: result.formatted_phone_number,
                website: result.website,
                rating: result.rating,
                user_ratings_total: result.user_ratings_total,
                opening_hours: result.opening_hours,
                price_level: result.price_level,
                types: result.types,
                geometry: result.geometry,
                photos: (result.photos || []).slice(0, 3)
            };
        } catch (error) {
            console.error("Error getting place details:", error.message);
            return null;
        }
    }

    async enrichActivityWithPlaces(activityName, location, activityType = "tourist_attraction") {
        try {
            // First try nearby search with larger radius (50km for spread out attractions)
            let places = await this.searchPlaces(activityName, location, 50000, activityType);

            // If no results, try text search without location constraint
            if (!places || places.length === 0) {
                places = await this.searchPlaces(activityName, null, null, activityType);
            }

            if (places && places.length > 0) {
                // Return best match (highest rating)
                return places.reduce((prev, current) =>
                    (prev.rating > current.rating) ? prev : current
                );
            }
            return null;
        } catch (error) {
            console.error("Error enriching activity:", error.message);
            return null;
        }
    }

    getPlacePhotoUrl(photoReference, maxWidth = 400) {
        if (!photoReference) return null;
        return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${this.apiKey}`;
    }

    // Helper to get photo URL from place ID (requires extra call, usually we use photo reference from details)
    // But strictly matching Python `get_place_photo_url` which takes place_id
    async getPlacePhotoUrlFromId(placeId, maxWidth = 400) {
        if (!placeId) return null;
        try {
            const details = await this.getPlaceDetails(placeId);
            if (details && details.photos && details.photos.length > 0) {
                const photoRef = details.photos[0].photo_reference;
                return this.getPlacePhotoUrl(photoRef, maxWidth);
            }
            return null;
        } catch (error) {
            return null;
        }
    }
}

module.exports = PlacesClient;
