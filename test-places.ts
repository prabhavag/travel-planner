import { Client } from "@googlemaps/google-maps-services-js";

async function run() {
  const client = new Client({});
  const apiKey = process.env.GOOGLE_PLACES_API_KEY as string;

  if (!apiKey) {
    console.error("Missing API key");
    process.exit(1);
  }

  const queries = [
    "Road to Hana Tour, Maui",
    "Road to Hana, Maui",
    "Road to Hana",
    "Hana Highway, Maui"
  ];
  
  for (const query of queries) {
    console.log(`Searching for '${query}'...`);
    const searchResponse = await client.textSearch({
      params: {
        query,
        key: apiKey,
      }
    });

    console.log("Results found:", searchResponse.data.results.length);
    if (searchResponse.data.results.length > 0) {
      const place = searchResponse.data.results[0];
      console.log(`First result: ${place.name} (ID: ${place.place_id}) types: ${place.types?.join(', ')}`);
      
      const detailsResponse = await client.placeDetails({
        params: {
          place_id: place.place_id as string,
          fields: ["photos"],
          key: apiKey,
        }
      });
  
      const photos = detailsResponse.data.result?.photos || [];
      console.log(`Place details has ${photos.length} photos`);
    }
    console.log("---");
  }
}

run().catch(console.error);
