require('dotenv').config();
const { Client } = require("@googlemaps/google-maps-services-js");

async function run() {
  const client = new Client({});
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  console.log("Searching for 'Road to Hana Tour, Maui'...");
  const searchResponse = await client.textSearch({
    params: {
      query: "Road to Hana Tour, Maui",
      key: apiKey,
    }
  });

  console.log("Results found:", searchResponse.data.results.length);
  if (searchResponse.data.results.length > 0) {
    const place = searchResponse.data.results[0];
    console.log("First result:", place.name, place.place_id);
    
    // Check if place details gives photos
    const detailsResponse = await client.placeDetails({
      params: {
        place_id: place.place_id,
        fields: ["photos"],
        key: apiKey,
      }
    });

    const photos = detailsResponse.data.result?.photos || [];
    console.log(`Place details has ${photos.length} photos`);
  }
  
  console.log("\nSearching for 'Road to Hana, Maui'...");
  const searchResponse2 = await client.textSearch({
    params: {
      query: "Road to Hana, Maui",
      key: apiKey,
    }
  });

  console.log("Results found:", searchResponse2.data.results.length);
  if (searchResponse2.data.results.length > 0) {
    const place = searchResponse2.data.results[0];
    console.log("First result:", place.name, place.place_id);
    
    // Check if place details gives photos
    const detailsResponse2 = await client.placeDetails({
      params: {
        place_id: place.place_id,
        fields: ["photos"],
        key: apiKey,
      }
    });

    const photos = detailsResponse2.data.result?.photos || [];
    console.log(`Place details has ${photos.length} photos`);
  }
}

run().catch(console.error);
