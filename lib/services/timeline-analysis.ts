import { getPlacesClient, type PlaceDetails, type ReverseGeocodeResult } from "@/lib/services/places-client";
import type {
  TimelineAnalysisResponse,
  TimelineMapPoint,
  TimelineVisitedPlace,
  TimelineVisit,
} from "@/lib/timeline";

interface AggregatedPlace {
  key: string;
  placeId: string | null;
  lat: number;
  lng: number;
  visitCount: number;
  totalDurationMinutes: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
  semanticTypeCounts: Map<string, number>;
  nameCounts: Map<string, number>;
  distanceFromHomeKm: number;
  bucket: "home" | "local" | "regional" | "travel";
  details: PlaceDetails | null;
}

interface TravelEpisode {
  startTime: string | null;
  endTime: string | null;
  uniquePlaceCount: number;
  maxDistanceKm: number;
  visitCount: number;
  durationHours: number;
  weekendLike: boolean;
}

interface TravelCluster {
  lat: number;
  lng: number;
  totalScore: number;
  totalDurationMinutes: number;
  visitCount: number;
  places: AggregatedPlace[];
}

interface ParkCoordinateFallback {
  canonical: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

interface CategoryRule {
  types: string[];
  signal: string;
  preference: string;
}

interface FoodPreferenceRule {
  typeTokens: string[];
  textPatterns: RegExp[];
  preference: string;
  minScore?: number;
  minMatchedPlaces?: number;
}

const LOCAL_FOOD_RULES: CategoryRule[] = [
  {
    types: ["cafe"],
    signal: "Local habits lean toward cafe-style stops and flexible coffee breaks.",
    preference: "Enjoys cafe-driven neighborhoods and casual coffee breaks",
  },
  {
    types: ["bakery"],
    signal: "Bakeries and quick pastry stops appear repeatedly in the local pattern.",
    preference: "Likes bakeries, dessert stops, and snack-friendly neighborhoods",
  },
  {
    types: ["restaurant", "meal_takeaway", "meal_delivery"],
    signal: "Repeated local restaurant stops suggest food is part of how you choose where to spend time.",
    preference: "Likes food-forward itineraries with strong local restaurant options",
  },
  {
    types: ["bar", "night_club"],
    signal: "Evening venues show up often enough to treat lively neighborhoods as a fit.",
    preference: "Open to lively evening neighborhoods and bar scenes",
  },
  {
    types: ["supermarket", "grocery_or_supermarket", "farmers_market"],
    signal: "Food shopping stops suggest markets and ingredient-driven neighborhoods are appealing.",
    preference: "Interested in markets and food-shopping experiences while traveling",
  },
];

const TRAVEL_RULES: CategoryRule[] = [
  {
    types: ["museum", "art_gallery", "tourist_attraction"],
    signal: "Trips include a recurring mix of landmark and culture-oriented stops.",
    preference: "Enjoys culture, landmarks, and worthwhile anchor attractions",
  },
  {
    types: ["park", "natural_feature", "campground"],
    signal: "Outdoor and scenic places recur enough to treat nature access as a real preference.",
    preference: "Likes scenic outdoor stops, parks, and nature-driven outings",
  },
  {
    types: ["beach"],
    signal: "Waterfront or beach-oriented destinations show up repeatedly in the travel pattern.",
    preference: "Drawn to coastlines, waterfronts, and relaxed scenic time",
  },
  {
    types: ["restaurant", "cafe", "bakery", "bar"],
    signal: "Travel stops consistently include dining-led places, not just attractions.",
    preference: "Builds trips around strong food neighborhoods and local dining",
  },
  {
    types: ["shopping_mall", "market", "book_store", "department_store"],
    signal: "Trips repeatedly include browseable retail and market areas.",
    preference: "Enjoys lively shopping streets, markets, and browseable neighborhoods",
  },
  {
    types: ["spa", "lodging", "rv_park"],
    signal: "The travel pattern includes comfort-oriented stays rather than nonstop activity only.",
    preference: "Prefers comfortable bases and a less frantic travel pace",
  },
  {
    types: ["amusement_park", "zoo", "aquarium"],
    signal: "Trips include popular leisure attractions often enough to keep them in play.",
    preference: "Open to popular leisure attractions and family-friendly stops",
  },
];

const FOOD_CONTEXT_TYPE_TOKENS = new Set([
  "bakery",
  "bar",
  "cafe",
  "food_court",
  "grocery_or_supermarket",
  "market",
  "meal_delivery",
  "meal_takeaway",
  "night_club",
  "restaurant",
  "supermarket",
]);

const FOOD_CONTEXT_TEXT_PATTERNS = [
  /\b(bakery|bar|bbq|bistro|brunch|cafe|coffee|dessert|dining|deli|food hall|grill|ice cream|market|restaurant|sushi|taco|tea)\b/i,
];

const FOOD_STYLE_RULES: FoodPreferenceRule[] = [
  {
    typeTokens: ["cafe"],
    textPatterns: [/\b(boba|cafe|chai|coffee|espresso|latte|matcha|tea)\b/i],
    preference: "Returns to coffee shops, tea spots, and cafe-friendly neighborhoods",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["bakery"],
    textPatterns: [/\b(bakery|dessert|donut|gelato|ice cream|pastry|patisserie|sweet)\b/i],
    preference: "Likely enjoys bakeries, dessert stops, and easy snack breaks",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["supermarket", "grocery_or_supermarket", "market", "food_court"],
    textPatterns: [/\b(deli|farmers market|food hall|grocery|market|mercado|supermarket)\b/i],
    preference: "Interested in markets, food halls, and ingredient-driven neighborhoods",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["bar", "night_club"],
    textPatterns: [/\b(bar|brewery|cocktail|pub|speakeasy|taproom|wine)\b/i],
    preference: "Open to bars, breweries, and lively evening food districts",
    minScore: 10,
    minMatchedPlaces: 2,
  },
];

const FOOD_CUISINE_RULES: FoodPreferenceRule[] = [
  {
    typeTokens: ["italian_restaurant"],
    textPatterns: [/\b(italian|osteria|pasta|pizzeria|pizza|trattoria)\b/i],
    preference: "Often chooses Italian meals, especially pizza and pasta spots",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["japanese_restaurant"],
    textPatterns: [/\b(hand roll|izakaya|japanese|omakase|ramen|sashimi|sushi|udon|yakitori)\b/i],
    preference: "Often chooses Japanese food, especially sushi and noodle spots",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["chinese_restaurant"],
    textPatterns: [/\b(chinese|dim sum|dumpling|hot pot|noodle house|sichuan|szechuan)\b/i],
    preference: "Frequently picks Chinese food, dumpling spots, or noodle houses",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["korean_restaurant"],
    textPatterns: [/\b(bibimbap|kbbq|korean|soondubu|tteokbokki)\b/i],
    preference: "Seems to enjoy Korean food and grill-forward meals",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["mexican_restaurant"],
    textPatterns: [/\b(birria|burrito|cantina|mezcal|mexican|taqueria|taco)\b/i],
    preference: "Often goes for Mexican food and taco-driven casual spots",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["indian_restaurant"],
    textPatterns: [/\b(biryani|chaat|curry|dosa|indian|tandoori)\b/i],
    preference: "Frequently chooses Indian food and spice-forward casual meals",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["thai_restaurant"],
    textPatterns: [/\b(khao soi|pad thai|satay|som tum|thai)\b/i],
    preference: "Shows a recurring preference for Thai food",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["vietnamese_restaurant"],
    textPatterns: [/\b(bahn mi|banh mi|pho|spring roll|vermicelli|vietnamese)\b/i],
    preference: "Often chooses Vietnamese food and noodle-heavy casual spots",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["mediterranean_restaurant", "greek_restaurant"],
    textPatterns: [/\b(falafel|greek|gyro|hummus|kebab|mediterranean|mezze|shawarma)\b/i],
    preference: "Seems to like Mediterranean, Greek, and Middle Eastern flavors",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["seafood_restaurant"],
    textPatterns: [/\b(crab|lobster|oyster|seafood|shack)\b/i],
    preference: "Seems drawn to seafood-focused meals when traveling",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["barbecue_restaurant"],
    textPatterns: [/\b(barbecue|bbq|brisket|smokehouse)\b/i],
    preference: "Often picks barbecue or grill-forward meals",
    minScore: 10,
    minMatchedPlaces: 2,
  },
  {
    typeTokens: ["vegan_restaurant", "vegetarian_restaurant"],
    textPatterns: [/\b(plant based|plant-based|vegan|vegetarian)\b/i],
    preference: "Regularly seeks vegetarian or plant-forward dining options",
    minScore: 8,
    minMatchedPlaces: 2,
  },
];

const SAFE_SINGLE_WORD_PARK_ALIASES = new Set([
  "acadia",
  "biscayne",
  "congaree",
  "denali",
  "everglades",
  "haleakala",
  "olympic",
  "pinnacles",
  "saguaro",
  "sequoia",
  "shenandoah",
  "yellowstone",
  "yosemite",
  "zion",
]);

const US_NATIONAL_PARKS = [
  "Acadia National Park",
  "American Samoa National Park",
  "Arches National Park",
  "Badlands National Park",
  "Big Bend National Park",
  "Biscayne National Park",
  "Black Canyon of the Gunnison National Park",
  "Bryce Canyon National Park",
  "Canyonlands National Park",
  "Capitol Reef National Park",
  "Carlsbad Caverns National Park",
  "Channel Islands National Park",
  "Congaree National Park",
  "Crater Lake National Park",
  "Cuyahoga Valley National Park",
  "Death Valley National Park",
  "Denali National Park",
  "Dry Tortugas National Park",
  "Everglades National Park",
  "Gates of the Arctic National Park",
  "Gateway Arch National Park",
  "Glacier National Park",
  "Glacier Bay National Park",
  "Grand Canyon National Park",
  "Grand Teton National Park",
  "Great Basin National Park",
  "Great Sand Dunes National Park",
  "Great Smoky Mountains National Park",
  "Guadalupe Mountains National Park",
  "Haleakala National Park",
  "Hawaii Volcanoes National Park",
  "Hot Springs National Park",
  "Indiana Dunes National Park",
  "Isle Royale National Park",
  "Joshua Tree National Park",
  "Katmai National Park",
  "Kenai Fjords National Park",
  "Kings Canyon National Park",
  "Kobuk Valley National Park",
  "Lake Clark National Park",
  "Lassen Volcanic National Park",
  "Mammoth Cave National Park",
  "Mesa Verde National Park",
  "Mount Rainier National Park",
  "New River Gorge National Park",
  "North Cascades National Park",
  "Olympic National Park",
  "Petrified Forest National Park",
  "Pinnacles National Park",
  "Redwood National Park",
  "Rocky Mountain National Park",
  "Saguaro National Park",
  "Sequoia National Park",
  "Shenandoah National Park",
  "Theodore Roosevelt National Park",
  "Virgin Islands National Park",
  "Voyageurs National Park",
  "White Sands National Park",
  "Wind Cave National Park",
  "Wrangell-St Elias National Park",
  "Yellowstone National Park",
  "Yosemite National Park",
  "Zion National Park",
].map((name) => ({
  canonical: name,
  aliases: buildParkAliases(name),
}));

const TRANSIT_OR_PASS_THROUGH_TYPES = new Set([
  "airport",
  "bus_station",
  "car_rental",
  "electric_vehicle_charging_station",
  "gas_station",
  "light_rail_station",
  "parking",
  "subway_station",
  "taxi_stand",
  "train_station",
  "transit_station",
]);

const DESTINATION_ANCHOR_TYPES = new Set([
  "amusement_park",
  "aquarium",
  "art_gallery",
  "beach",
  "campground",
  "hindu_temple",
  "lodging",
  "museum",
  "natural_feature",
  "park",
  "rv_park",
  "spa",
  "tourist_attraction",
  "zoo",
]);

const COUNTRY_LABELS = new Set([
  "australia",
  "canada",
  "france",
  "germany",
  "india",
  "ireland",
  "italy",
  "japan",
  "mexico",
  "new zealand",
  "singapore",
  "spain",
  "uae",
  "uk",
  "united arab emirates",
  "united kingdom",
  "united states",
  "usa",
]);

const PARK_COORDINATE_FALLBACKS: ParkCoordinateFallback[] = [
  { canonical: "Yosemite National Park", lat: 37.8651, lng: -119.5383, radiusKm: 45 },
  { canonical: "Zion National Park", lat: 37.2982, lng: -113.0263, radiusKm: 35 },
  { canonical: "Grand Teton National Park", lat: 43.7904, lng: -110.6818, radiusKm: 45 },
  { canonical: "Olympic National Park", lat: 47.8021, lng: -123.6044, radiusKm: 70 },
  { canonical: "Yellowstone National Park", lat: 44.428, lng: -110.5885, radiusKm: 70 },
  { canonical: "Mount Rainier National Park", lat: 46.8523, lng: -121.7603, radiusKm: 45 },
];

const TRAVEL_CLUSTER_RADIUS_KM = 55;
const MAX_VISITED_DESTINATIONS = 48;
const MAX_LOCALITY_REVERSE_GEOCODE_SAMPLES = 3;
const MAX_DESTINATION_CLUSTERS_TO_LABEL = 32;
const REGION_LIKE_FEATURE_PATTERNS = [
  /\b(lake|lakes|valley|island|islands|mountain|mountains|beach|coast|coastal|canyon|bay|shore|desert|forest|peninsula|reef|cove|falls|wine country|vineyards?)\b/i,
];
const GENERIC_FEATURE_LABEL_PATTERNS = [
  /\bcounty\b/i,
  /\bprovince\b/i,
  /\bstate of\b/i,
];

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDateHours(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getHours();
}

function isWeekend(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 5 || day === 6;
}

function dedupe(items: string[], limit = items.length): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function hasGoogleLocationKey(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY);
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPostalCode(value: string): string {
  return value
    .replace(/\b\d{4,6}(?:-\d{4})?\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/[,-]\s*$/g, "")
    .trim();
}

function looksLikeCountryLabel(value: string): boolean {
  return COUNTRY_LABELS.has(normalizeForMatch(value));
}

function buildParkAliases(canonical: string): string[] {
  const aliases = new Set<string>([canonical]);
  const stripped = canonical
    .replace(/\bNational Park\b/gi, "")
    .replace(/\band Preserve\b/gi, "")
    .trim();

  if (stripped.split(/\s+/).length >= 2 || SAFE_SINGLE_WORD_PARK_ALIASES.has(stripped.toLowerCase())) {
    aliases.add(stripped);
  }

  if (canonical === "Great Smoky Mountains National Park") {
    aliases.add("Smoky Mountains");
  }
  if (canonical === "Wrangell-St Elias National Park") {
    aliases.add("Wrangell St Elias");
  }
  if (canonical === "Hawaii Volcanoes National Park") {
    aliases.add("Hawaii Volcanoes");
  }

  return Array.from(aliases).map(normalizeForMatch);
}

function getDominantValue(counts: Map<string, number>, fallback: string): string {
  let bestValue = fallback;
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

function aggregatePlaces(visits: TimelineVisit[]): AggregatedPlace[] {
  const byKey = new Map<string, AggregatedPlace>();

  for (const visit of visits) {
    const existing = byKey.get(visit.key);
    if (existing) {
      existing.visitCount += 1;
      existing.totalDurationMinutes += visit.durationMinutes;
      if (visit.startTime && (!existing.firstVisitedAt || visit.startTime < existing.firstVisitedAt)) {
        existing.firstVisitedAt = visit.startTime;
      }
      if (visit.endTime && (!existing.lastVisitedAt || visit.endTime > existing.lastVisitedAt)) {
        existing.lastVisitedAt = visit.endTime;
      }
      if (visit.semanticType) {
        existing.semanticTypeCounts.set(
          visit.semanticType,
          (existing.semanticTypeCounts.get(visit.semanticType) || 0) + 1
        );
      }
      if (visit.name) {
        existing.nameCounts.set(visit.name, (existing.nameCounts.get(visit.name) || 0) + 1);
      }
      continue;
    }

    const semanticTypeCounts = new Map<string, number>();
    const nameCounts = new Map<string, number>();
    if (visit.semanticType) semanticTypeCounts.set(visit.semanticType, 1);
    if (visit.name) nameCounts.set(visit.name, 1);

    byKey.set(visit.key, {
      key: visit.key,
      placeId: visit.placeId,
      lat: visit.lat,
      lng: visit.lng,
      visitCount: 1,
      totalDurationMinutes: visit.durationMinutes,
      firstVisitedAt: visit.startTime,
      lastVisitedAt: visit.endTime,
      semanticTypeCounts,
      nameCounts,
      distanceFromHomeKm: 0,
      bucket: "local",
      details: null,
    });
  }

  return Array.from(byKey.values());
}

function chooseHomePlace(places: AggregatedPlace[], visits: TimelineVisit[]): AggregatedPlace | null {
  const explicitHome = places
    .filter((place) => place.semanticTypeCounts.has("Home"))
    .sort((a, b) => b.visitCount * 4 + b.totalDurationMinutes / 60 - (a.visitCount * 4 + a.totalDurationMinutes / 60))[0];
  if (explicitHome) return explicitHome;

  const nightWeights = new Map<string, number>();
  for (const visit of visits) {
    const hour = getDateHours(visit.startTime) ?? getDateHours(visit.endTime);
    if (hour == null) continue;
    if (hour >= 20 || hour <= 6) {
      nightWeights.set(visit.key, (nightWeights.get(visit.key) || 0) + Math.max(visit.durationMinutes, 30));
    }
  }

  return [...places]
    .sort((a, b) => {
      const scoreA = (nightWeights.get(a.key) || 0) + a.visitCount * 3 + a.totalDurationMinutes / 90;
      const scoreB = (nightWeights.get(b.key) || 0) + b.visitCount * 3 + b.totalDurationMinutes / 90;
      return scoreB - scoreA;
    })[0] || null;
}

function bucketPlace(distanceFromHomeKm: number, semanticType: string): AggregatedPlace["bucket"] {
  if (semanticType === "Home") return "home";
  if (distanceFromHomeKm <= 50) return "local";
  if (distanceFromHomeKm <= 250) return "regional";
  return "travel";
}

async function enrichPlaces(places: AggregatedPlace[]): Promise<void> {
  if (!hasGoogleLocationKey()) return;

  let placesClient;
  try {
    placesClient = getPlacesClient();
  } catch {
    return;
  }

  const targets = [...places]
    .filter((place) => {
      if (!place.placeId) return false;
      if (place.bucket !== "regional" && place.bucket !== "travel") return false;
      const semanticType = getDominantValue(place.semanticTypeCounts, "");
      if (semanticType === "Home" || semanticType === "Work") return false;
      return isLikelyRealVisitPlace(place);
    })
    .sort((a, b) => {
      const bucketScore = (bucket: AggregatedPlace["bucket"]) => {
        if (bucket === "travel") return 3;
        if (bucket === "regional") return 2;
        if (bucket === "local") return 1;
        return 0;
      };
      const bucketDelta = bucketScore(b.bucket) - bucketScore(a.bucket);
      if (bucketDelta !== 0) return bucketDelta;
      return scorePlace(b) - scorePlace(a);
    });

  const targetedKeys = new Set(targets.map((place) => place.key));
  const destinationClusters = buildTravelClusters(
    places.filter((place) => place.bucket === "regional" || place.bucket === "travel"),
    isTravelClusterCandidate
  ).filter((cluster) => cluster.totalDurationMinutes >= 90 || cluster.visitCount >= 3 || cluster.places.length >= 3);

  for (const cluster of destinationClusters) {
    const unresolvedClusterPlaces = cluster.places
      .filter((place) => place.placeId && !targetedKeys.has(place.key))
      .sort((a, b) => scorePlace(b) - scorePlace(a))
      .slice(0, 6);

    for (const place of unresolvedClusterPlaces) {
      targetedKeys.add(place.key);
      targets.push(place);
    }
  }

  for (let index = 0; index < targets.length; index += 8) {
    const batch = targets.slice(index, index + 8);
    await Promise.all(
      batch.map(async (place) => {
        try {
          place.details = await placesClient.getPlaceDetails(place.placeId!);
        } catch {
          place.details = null;
        }
      })
    );
  }
}

function ruleMatches(place: AggregatedPlace, rule: CategoryRule): boolean {
  const types = place.details?.types || [];
  return rule.types.some((type) => types.includes(type));
}

function scorePlace(place: AggregatedPlace): number {
  const durationBoost = Math.min(place.totalDurationMinutes / 60, 18);
  return place.visitCount * 3 + durationBoost;
}

function pickSignals(places: AggregatedPlace[], rules: CategoryRule[], limit: number): {
  signals: string[];
  preferences: string[];
} {
  const scoredRules = rules
    .map((rule) => ({
      rule,
      score: places
        .filter((place) => ruleMatches(place, rule))
        .reduce((sum, place) => sum + scorePlace(place), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    signals: scoredRules.map((entry) => entry.rule.signal),
    preferences: scoredRules.map((entry) => entry.rule.preference),
  };
}

function getFoodContextText(place: AggregatedPlace): string {
  return normalizeForMatch(
    [
      place.details?.name,
      place.details?.editorial_summary,
      getDominantValue(place.nameCounts, ""),
      getDominantValue(place.semanticTypeCounts, ""),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function getNormalizedPlaceTypes(place: AggregatedPlace): string[] {
  return (place.details?.types || []).map((type) => normalizeForMatch(type));
}

function placeMatchesFoodRule(place: AggregatedPlace, rule: FoodPreferenceRule): boolean {
  const types = getNormalizedPlaceTypes(place);
  if (rule.typeTokens.some((type) => types.includes(type))) {
    return true;
  }

  const text = getFoodContextText(place);
  return rule.textPatterns.some((pattern) => pattern.test(text));
}

function isLikelyFoodContextPlace(place: AggregatedPlace): boolean {
  const types = getNormalizedPlaceTypes(place);
  if (types.some((type) => FOOD_CONTEXT_TYPE_TOKENS.has(type))) {
    return true;
  }

  const semanticType = normalizeForMatch(getDominantValue(place.semanticTypeCounts, ""));
  if (semanticType && FOOD_CONTEXT_TEXT_PATTERNS.some((pattern) => pattern.test(semanticType))) {
    return true;
  }

  const text = getFoodContextText(place);
  return FOOD_CONTEXT_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function rankFoodPreferenceRules(
  places: AggregatedPlace[],
  rules: FoodPreferenceRule[],
  limit: number
): string[] {
  return rules
    .map((rule) => {
      const matchingPlaces = places.filter((place) => placeMatchesFoodRule(place, rule));
      return {
        rule,
        matchedPlaces: matchingPlaces.length,
        score: matchingPlaces.reduce((sum, place) => sum + scorePlace(place), 0),
      };
    })
    .filter((entry) => {
      const minScore = entry.rule.minScore ?? 8;
      const minMatchedPlaces = entry.rule.minMatchedPlaces ?? 1;
      return entry.score >= minScore && entry.matchedPlaces >= minMatchedPlaces;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.matchedPlaces - a.matchedPlaces;
    })
    .slice(0, limit)
    .map((entry) => entry.rule.preference);
}

function inferFoodPreferences(places: AggregatedPlace[]): string[] {
  const foodPlaces = places
    .filter((place) => {
      const semanticType = getDominantValue(place.semanticTypeCounts, "");
      if (semanticType === "Home" || semanticType === "Work") return false;
      return isLikelyFoodContextPlace(place);
    })
    .sort((a, b) => scorePlace(b) - scorePlace(a));

  if (foodPlaces.length === 0) return [];

  const stylePreferences = rankFoodPreferenceRules(foodPlaces, FOOD_STYLE_RULES, 2);
  const cuisinePreferences = rankFoodPreferenceRules(foodPlaces, FOOD_CUISINE_RULES, 2);
  const preferences = dedupe([...stylePreferences, ...cuisinePreferences], 4);

  if (preferences.length > 0) {
    return preferences;
  }

  if (foodPlaces.length >= 6) {
    return ["Food seems to shape which neighborhoods and repeat stops you return to"];
  }

  return [];
}

function isFoodPreferenceText(value: string): boolean {
  return /\b(food|dining|restaurant|cafe|coffee|bakery|dessert|market|bar|brewery|snack)\b/i.test(value);
}

function summarizeEpisodes(episodes: TravelEpisode[]): { signals: string[]; preferences: string[] } {
  if (episodes.length === 0) return { signals: [], preferences: [] };

  const signals: string[] = [];
  const preferences: string[] = [];
  const averageDurationHours =
    episodes.reduce((sum, episode) => sum + episode.durationHours, 0) / Math.max(episodes.length, 1);
  const averageUniquePlaces =
    episodes.reduce((sum, episode) => sum + episode.uniquePlaceCount, 0) / Math.max(episodes.length, 1);
  const weekendRatio =
    episodes.filter((episode) => episode.weekendLike).length / Math.max(episodes.length, 1);
  const maxDistanceKm = Math.max(...episodes.map((episode) => episode.maxDistanceKm), 0);

  if (episodes.length >= 2 && averageDurationHours <= 72) {
    signals.push("Most travel looks like compact getaways rather than long single-base vacations.");
    preferences.push("Comfortable with short getaways and efficient regional trips");
  }

  if (averageUniquePlaces >= 3) {
    signals.push("Trips usually include multiple stops, which points to comfort with exploratory days.");
    preferences.push("Enjoys multi-stop days with a couple of anchor experiences and room to explore");
  }

  if (weekendRatio >= 0.45) {
    signals.push("A large share of travel appears weekend-shaped, so efficient logistics likely matter.");
    preferences.push("Prefers trips that work well as tight, low-friction getaways");
  }

  if (maxDistanceKm >= 750) {
    signals.push("The timeline includes long-distance travel, so bigger destination trips are part of the mix.");
    preferences.push("Open to bigger destination trips, not only nearby escapes");
  }

  return { signals, preferences };
}

function detectTravelEpisodes(
  visits: TimelineVisit[],
  distanceByKey: Map<string, number>,
  bucketByKey: Map<string, AggregatedPlace["bucket"]>
): TravelEpisode[] {
  const sortedVisits = [...visits]
    .filter((visit) => {
      const bucket = bucketByKey.get(visit.key);
      return bucket === "regional" || bucket === "travel";
    })
    .sort((a, b) => {
      const aTime = a.startTime || a.endTime || "";
      const bTime = b.startTime || b.endTime || "";
      return aTime.localeCompare(bTime);
    });

  const episodes: TravelEpisode[] = [];
  let current: TimelineVisit[] = [];

  const pushCurrent = () => {
    if (current.length === 0) return;
    const uniqueKeys = new Set(current.map((visit) => visit.key));
    const startTime = current[0].startTime || current[0].endTime;
    const endTime = current[current.length - 1].endTime || current[current.length - 1].startTime;
    const start = startTime ? new Date(startTime) : null;
    const end = endTime ? new Date(endTime) : null;
    const durationHours =
      start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
        ? Math.max((end.getTime() - start.getTime()) / (1000 * 60 * 60), 0)
        : 0;

    episodes.push({
      startTime,
      endTime,
      uniquePlaceCount: uniqueKeys.size,
      maxDistanceKm: Math.max(...current.map((visit) => distanceByKey.get(visit.key) || 0), 0),
      visitCount: current.length,
      durationHours,
      weekendLike: current.filter((visit) => isWeekend(visit.startTime || visit.endTime)).length >= current.length / 2,
    });
    current = [];
  };

  for (const visit of sortedVisits) {
    if (current.length === 0) {
      current.push(visit);
      continue;
    }

    const previous = current[current.length - 1];
    const previousEnd = previous.endTime || previous.startTime;
    const currentStart = visit.startTime || visit.endTime;
    if (!previousEnd || !currentStart) {
      current.push(visit);
      continue;
    }

    const previousDate = new Date(previousEnd);
    const currentDate = new Date(currentStart);
    if (Number.isNaN(previousDate.getTime()) || Number.isNaN(currentDate.getTime())) {
      current.push(visit);
      continue;
    }

    const gapHours = (currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60);
    if (gapHours > 18) {
      pushCurrent();
    }
    current.push(visit);
  }

  pushCurrent();
  return episodes;
}

function getDisplayName(place: AggregatedPlace): string {
  if (place.details?.name?.trim()) return place.details.name.trim();
  const name = getDominantValue(place.nameCounts, "");
  if (name) return name;
  const semanticType = getDominantValue(place.semanticTypeCounts, "");
  if (semanticType && semanticType !== "Unknown") return semanticType;
  return place.bucket === "local" ? "Local place" : "Visited place";
}

function getPlaceSearchText(place: AggregatedPlace): string {
  return normalizeForMatch(
    [
      place.details?.name,
      place.details?.formatted_address,
      place.details?.editorial_summary,
      getDominantValue(place.nameCounts, ""),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function getParkMatchFromText(value: string): string | null {
  const haystack = normalizeForMatch(value);
  if (!haystack) return null;

  for (const park of US_NATIONAL_PARKS) {
    if (park.aliases.some((alias) => haystack.includes(alias))) {
      return park.canonical;
    }
  }

  return null;
}

function getParkMatchFromCoordinates(lat: number, lng: number): string | null {
  for (const park of PARK_COORDINATE_FALLBACKS) {
    if (distanceKm(lat, lng, park.lat, park.lng) <= park.radiusKm) {
      return park.canonical;
    }
  }
  return null;
}

function getPlaceTypes(place: AggregatedPlace): string[] {
  return place.details?.types || [];
}

function extractDestinationLocalityLabel(place: AggregatedPlace): string | null {
  const address = place.details?.formatted_address;
  if (!address) return null;

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  let end = parts.length - 1;
  if (looksLikeCountryLabel(parts[end])) {
    end -= 1;
  }

  if (end < 1) return null;

  const region = stripPostalCode(parts[end]);
  const locality = stripPostalCode(parts[end - 1]);

  if (!locality || /\d/.test(locality)) return null;
  if (region && locality.toLowerCase() === region.toLowerCase()) return locality;

  return region ? `${locality}, ${region}` : locality;
}

function voteClusterLocalityLabels(cluster: TravelCluster): Map<string, number> {
  const labelScores = new Map<string, number>();

  const addLabel = (label: string | null, score: number) => {
    if (!label || score <= 0) return;
    labelScores.set(label, (labelScores.get(label) || 0) + score);
  };

  for (const place of cluster.places) {
    const placeScore = scorePlace(place);
    const localityLabel = extractDestinationLocalityLabel(place);
    if (localityLabel) {
      addLabel(localityLabel, placeScore * 3 + (place.bucket === "travel" ? 8 : 4));
    }
  }

  return labelScores;
}

function chooseTopScoredLabel(labelScores: Map<string, number>): string | null {
  return [...labelScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function getTopScore(labelScores: Map<string, number>): number {
  return [...labelScores.values()].sort((a, b) => b - a)[0] || 0;
}

function getSecondScore(labelScores: Map<string, number>): number {
  return [...labelScores.values()].sort((a, b) => b - a)[1] || 0;
}

function getTotalScore(labelScores: Map<string, number>): number {
  return [...labelScores.values()].reduce((sum, score) => sum + score, 0);
}

function formatReverseGeocodeLocalityLabel(result: ReverseGeocodeResult | null): string | null {
  if (!result) return null;

  const locality = result.locality || result.adminAreaLevel2;
  const region = result.adminAreaLevel1;

  if (locality && region && normalizeForMatch(locality) !== normalizeForMatch(region)) {
    return `${locality}, ${region}`;
  }

  return locality || region || null;
}

function isRegionLikeFeatureLabel(value: string | null): value is string {
  if (!value) return false;

  const normalized = value.trim();
  if (!normalized) return false;
  if (looksLikeCountryLabel(normalized)) return false;
  if (GENERIC_FEATURE_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))) return false;

  return REGION_LIKE_FEATURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function formatReverseGeocodeFeatureLabel(result: ReverseGeocodeResult | null): string | null {
  if (!result) return null;

  const featureName = result.featureName || null;
  if (isRegionLikeFeatureLabel(featureName)) {
    return featureName.trim();
  }

  return null;
}

function choosePreferredClusterDestinationLabel(
  localityScores: Map<string, number>,
  featureScores: Map<string, number>
): string | null {
  const topFeatureLabel = chooseTopScoredLabel(featureScores);
  const topLocalityLabel = chooseTopScoredLabel(localityScores);

  if (!topFeatureLabel) {
    return topLocalityLabel;
  }

  if (!topLocalityLabel) {
    return topFeatureLabel;
  }

  const topFeatureScore = getTopScore(featureScores);
  const topLocalityScore = getTopScore(localityScores);
  const secondLocalityScore = getSecondScore(localityScores);
  const totalLocalityScore = getTotalScore(localityScores);
  const localityFragmented =
    localityScores.size >= 2 &&
    (topLocalityScore / Math.max(totalLocalityScore, 1) < 0.62 || secondLocalityScore >= topLocalityScore * 0.55);

  if (localityFragmented && topFeatureScore >= Math.max(10, topLocalityScore * 0.7)) {
    return topFeatureLabel;
  }

  return topLocalityLabel;
}

async function inferClusterLocalityDestination(cluster: TravelCluster): Promise<string | null> {
  const localityScores = voteClusterLocalityLabels(cluster);
  const featureScores = new Map<string, number>();
  if (!hasGoogleLocationKey()) {
    return choosePreferredClusterDestinationLabel(localityScores, featureScores);
  }

  try {
    const placesClient = getPlacesClient();
    for (const place of [...cluster.places]
      .sort((a, b) => scorePlace(b) - scorePlace(a))
      .slice(0, MAX_LOCALITY_REVERSE_GEOCODE_SAMPLES)) {
      const reverseGeocode = await placesClient.reverseGeocode({ lat: place.lat, lng: place.lng });
      const localityLabel = formatReverseGeocodeLocalityLabel(reverseGeocode);
      const placeScore = scorePlace(place);
      if (localityLabel) {
        localityScores.set(
          localityLabel,
          (localityScores.get(localityLabel) || 0) + placeScore * 2 + Math.min(place.visitCount, 4)
        );
      }

      const featureLabel = formatReverseGeocodeFeatureLabel(reverseGeocode);
      if (featureLabel) {
        featureScores.set(
          featureLabel,
          (featureScores.get(featureLabel) || 0) + placeScore * 2 + Math.min(place.visitCount, 4)
        );
      }
    }

    if (localityScores.size === 0 && featureScores.size === 0) {
      const centroidReverseGeocode = await placesClient.reverseGeocode({ lat: cluster.lat, lng: cluster.lng });
      const centroidLabel = formatReverseGeocodeLocalityLabel(centroidReverseGeocode);
      if (centroidLabel) {
        localityScores.set(centroidLabel, cluster.totalScore + Math.min(cluster.visitCount, 6));
      }

      const centroidFeatureLabel = formatReverseGeocodeFeatureLabel(centroidReverseGeocode);
      if (centroidFeatureLabel) {
        featureScores.set(centroidFeatureLabel, cluster.totalScore + Math.min(cluster.visitCount, 6));
      }
    }

    return choosePreferredClusterDestinationLabel(localityScores, featureScores);
  } catch (error) {
    console.warn("Failed to infer travel locality from reverse geocode:", (error as Error).message);
    return choosePreferredClusterDestinationLabel(localityScores, featureScores);
  }
}

async function inferClusterParkDestination(cluster: TravelCluster): Promise<string | null> {
  const coordinateMatch = getParkMatchFromCoordinates(cluster.lat, cluster.lng);
  if (coordinateMatch) return coordinateMatch;

  if (!hasGoogleLocationKey()) return null;

  try {
    const placesClient = getPlacesClient();
    const nearbyParks = await placesClient.searchPlaces(
      "National Park",
      { lat: cluster.lat, lng: cluster.lng },
      120000,
      null,
      { preferTextSearch: false }
    );

    let bestMatch: { canonical: string; score: number } | null = null;
    for (const result of nearbyParks) {
      const canonical = getParkMatchFromText(`${result.name} ${result.vicinity || ""}`);
      if (!canonical) continue;

      const distancePenalty = distanceKm(cluster.lat, cluster.lng, result.location.lat, result.location.lng);
      if (distancePenalty > 120) continue;

      const score =
        cluster.totalScore +
        (result.types.includes("park") || result.types.includes("natural_feature") ? 4 : 0) -
        distancePenalty / 25;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { canonical, score };
      }
    }

    return bestMatch?.canonical || null;
  } catch (error) {
    console.warn("Failed to infer visited park from nearby search:", (error as Error).message);
    return null;
  }
}

function hasResolvedPlaceName(place: AggregatedPlace): boolean {
  if (place.details?.name?.trim()) return true;
  const name = getDominantValue(place.nameCounts, "");
  return Boolean(name.trim());
}

function isLikelyRealVisitPlace(place: AggregatedPlace): boolean {
  const semanticType = getDominantValue(place.semanticTypeCounts, "");
  if (semanticType === "Home" || semanticType === "Work") return false;

  const types = getPlaceTypes(place);
  if (types.some((type) => TRANSIT_OR_PASS_THROUGH_TYPES.has(type))) {
    return false;
  }

  if (place.visitCount >= 2) return true;
  if (place.totalDurationMinutes >= 45) return true;
  if (types.some((type) => DESTINATION_ANCHOR_TYPES.has(type))) return true;

  return false;
}

function isTravelClusterCandidate(place: AggregatedPlace): boolean {
  const semanticType = getDominantValue(place.semanticTypeCounts, "");
  if (semanticType === "Home" || semanticType === "Work") return false;

  const types = getPlaceTypes(place);
  if (types.some((type) => TRANSIT_OR_PASS_THROUGH_TYPES.has(type))) {
    return false;
  }

  return place.bucket === "regional" || place.bucket === "travel";
}

function isSignificantDestinationCluster(cluster: TravelCluster): boolean {
  return cluster.totalDurationMinutes >= 90 || cluster.visitCount >= 3 || cluster.places.length >= 3;
}

function shouldIncludeOnTimelineMap(place: AggregatedPlace): boolean {
  const semanticType = getDominantValue(place.semanticTypeCounts, "");
  return semanticType !== "Home" && semanticType !== "Work";
}

function buildTravelClusters(
  travelPlaces: AggregatedPlace[],
  predicate: (place: AggregatedPlace) => boolean = isLikelyRealVisitPlace
): TravelCluster[] {
  const clusters: TravelCluster[] = [];

  for (const place of travelPlaces.filter(predicate).sort((a, b) => scorePlace(b) - scorePlace(a))) {
    const placeScore = scorePlace(place);
    const existing = clusters.find(
      (cluster) => distanceKm(cluster.lat, cluster.lng, place.lat, place.lng) <= TRAVEL_CLUSTER_RADIUS_KM
    );

    if (!existing) {
      clusters.push({
        lat: place.lat,
        lng: place.lng,
        totalScore: placeScore,
        totalDurationMinutes: place.totalDurationMinutes,
        visitCount: place.visitCount,
        places: [place],
      });
      continue;
    }

    const combinedScore = existing.totalScore + placeScore;
    existing.lat = (existing.lat * existing.totalScore + place.lat * placeScore) / combinedScore;
    existing.lng = (existing.lng * existing.totalScore + place.lng * placeScore) / combinedScore;
    existing.totalScore = combinedScore;
    existing.totalDurationMinutes += place.totalDurationMinutes;
    existing.visitCount += place.visitCount;
    existing.places.push(place);
  }

  return clusters.sort((a, b) => b.totalScore - a.totalScore);
}

async function deriveVisitedDestinations(travelPlaces: AggregatedPlace[]): Promise<string[]> {
  const parkScores = new Map<string, number>();

  for (const place of travelPlaces) {
    const haystack = getPlaceSearchText(place);
    if (!haystack) continue;
    const matchedPark = getParkMatchFromText(haystack);
    if (matchedPark) {
      parkScores.set(matchedPark, (parkScores.get(matchedPark) || 0) + scorePlace(place));
    }
  }

  try {
    const clusters = buildTravelClusters(travelPlaces, isTravelClusterCandidate)
      .filter((cluster) => isSignificantDestinationCluster(cluster) || cluster.totalScore >= 6)
      .slice(0, MAX_DESTINATION_CLUSTERS_TO_LABEL);

    for (const cluster of clusters) {
      const canonical = await inferClusterParkDestination(cluster);
      if (!canonical) continue;
      parkScores.set(canonical, (parkScores.get(canonical) || 0) + cluster.totalScore + cluster.visitCount);
    }
  } catch (error) {
    console.warn("Failed to infer visited parks from nearby searches:", (error as Error).message);
  }

  const visitedParks = [...parkScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  return dedupe(visitedParks, 10);
}

async function deriveVisitedPlaces(travelPlaces: AggregatedPlace[]): Promise<TimelineVisitedPlace[]> {
  const mergedDestinations = new Map<string, TimelineVisitedPlace>();

  for (const cluster of buildTravelClusters(travelPlaces, isTravelClusterCandidate)
    .filter(isSignificantDestinationCluster)
    .slice(0, MAX_DESTINATION_CLUSTERS_TO_LABEL)) {
    const localityLabel = await inferClusterLocalityDestination(cluster);
    const parkLabel = await inferClusterParkDestination(cluster);
    const labels = dedupe([localityLabel || "", parkLabel || ""], 2);

    for (const label of labels) {
      const normalized = normalizeForMatch(label);
      if (!normalized) continue;

      const existing = mergedDestinations.get(normalized);
      if (existing) {
        const combinedVisits = existing.visitCount + cluster.visitCount;
        const combinedDuration = existing.totalDurationMinutes + cluster.totalDurationMinutes;
        existing.lat = (existing.lat * existing.visitCount + cluster.lat * cluster.visitCount) / combinedVisits;
        existing.lng = (existing.lng * existing.visitCount + cluster.lng * cluster.visitCount) / combinedVisits;
        existing.visitCount = combinedVisits;
        existing.totalDurationMinutes = combinedDuration;
        continue;
      }

      mergedDestinations.set(normalized, {
        name: label,
        lat: cluster.lat,
        lng: cluster.lng,
        visitCount: cluster.visitCount,
        totalDurationMinutes: cluster.totalDurationMinutes,
      });
    }
  }

  return [...mergedDestinations.values()].sort((a, b) => {
    if (b.totalDurationMinutes !== a.totalDurationMinutes) {
      return b.totalDurationMinutes - a.totalDurationMinutes;
    }
    return b.visitCount - a.visitCount;
  });
}

function buildMapPoints(places: AggregatedPlace[]): TimelineMapPoint[] {
  const bucketScore = (bucket: AggregatedPlace["bucket"]) => {
    if (bucket === "travel") return 3;
    if (bucket === "regional") return 2;
    if (bucket === "local") return 1;
    return 0;
  };

  return [...places]
    .filter(shouldIncludeOnTimelineMap)
    .sort((a, b) => {
      const bucketDelta = bucketScore(b.bucket) - bucketScore(a.bucket);
      if (bucketDelta !== 0) return bucketDelta;
      const resolvedDelta = Number(hasResolvedPlaceName(b)) - Number(hasResolvedPlaceName(a));
      if (resolvedDelta !== 0) return resolvedDelta;
      return scorePlace(b) - scorePlace(a);
    })
    .map((place) => ({
      id: place.key,
      lat: place.lat,
      lng: place.lng,
      name: getDisplayName(place),
      kind: place.bucket === "travel" ? "travel" : place.bucket === "regional" ? "regional" : "local",
      visitCount: place.visitCount,
      totalDurationMinutes: place.totalDurationMinutes,
      identified: hasResolvedPlaceName(place),
    }));
}

function buildSummary(localSignals: string[], travelSignals: string[], patternSignals: string[]): string {
  const parts: string[] = [];

  if (localSignals[0]) {
    parts.push(`Locally, ${localSignals[0].charAt(0).toLowerCase()}${localSignals[0].slice(1)}`);
  }
  if (travelSignals[0]) {
    parts.push(`When you travel, ${travelSignals[0].charAt(0).toLowerCase()}${travelSignals[0].slice(1)}`);
  }
  if (patternSignals[0]) {
    parts.push(patternSignals[0]);
  }

  if (parts.length === 0) {
    return "The timeline shows enough repeat movement to infer preferences, but not enough place context to make strong category-level calls yet.";
  }

  return parts.join(" ");
}

export async function analyzeTimelineVisits(visits: TimelineVisit[]): Promise<TimelineAnalysisResponse> {
  const normalizedVisits = visits.filter((visit) => Number.isFinite(visit.lat) && Number.isFinite(visit.lng));
  const places = aggregatePlaces(normalizedVisits);

  if (normalizedVisits.length === 0 || places.length === 0) {
    return {
      summary: "No usable visit history was found in the uploaded timeline export.",
      preferences: [],
      foodPreferences: [],
      visitedDestinations: [],
      visitedPlaces: [],
      localSignals: [],
      travelSignals: [],
      mapPoints: [],
      stats: {
        visitCount: 0,
        recurringPlaceCount: 0,
        localPlaceCount: 0,
        travelPlaceCount: 0,
        tripCount: 0,
      },
    };
  }

  const homePlace = chooseHomePlace(places, normalizedVisits);
  if (homePlace) {
    for (const place of places) {
      const semanticType = getDominantValue(place.semanticTypeCounts, "Unknown");
      place.distanceFromHomeKm = distanceKm(homePlace.lat, homePlace.lng, place.lat, place.lng);
      place.bucket = bucketPlace(place.distanceFromHomeKm, semanticType);
    }
  }

  await enrichPlaces(places);

  const sortablePlaces = [...places].sort((a, b) => scorePlace(b) - scorePlace(a));
  const localPlaces = sortablePlaces.filter((place) => place.bucket === "local");
  const travelPlaces = sortablePlaces.filter((place) => place.bucket === "regional" || place.bucket === "travel");
  const recurringPlaces = sortablePlaces.filter((place) => place.visitCount > 1);
  const inferredFoodPreferences = inferFoodPreferences(sortablePlaces);
  const visitedPlaces = await deriveVisitedPlaces(travelPlaces);
  const visitedDestinations = dedupe(
    [...visitedPlaces.map((place) => place.name), ...(await deriveVisitedDestinations(travelPlaces))],
    MAX_VISITED_DESTINATIONS
  );

  const distanceByKey = new Map(places.map((place) => [place.key, place.distanceFromHomeKm]));
  const bucketByKey = new Map(places.map((place) => [place.key, place.bucket]));
  const episodes = detectTravelEpisodes(normalizedVisits, distanceByKey, bucketByKey);

  const localSignalsResult = pickSignals(localPlaces, LOCAL_FOOD_RULES, 2);
  const travelSignalsResult = pickSignals(travelPlaces, TRAVEL_RULES, 3);
  const patternSignalsResult = summarizeEpisodes(episodes);
  const localSignals = [...localSignalsResult.signals];
  const travelSignals = [...travelSignalsResult.signals];
  const localPreferenceHints = [...localSignalsResult.preferences];
  const travelPreferenceHints = [...travelSignalsResult.preferences];

  if (localSignals.length === 0 && localPlaces.length >= 3) {
    localSignals.push(
      "Local behavior clusters around repeat stops, which suggests dependable neighborhoods and easy food access matter more than novelty alone."
    );
    localPreferenceHints.push("Prefers dependable neighborhoods with easy, high-confidence dining options");
  }

  if (travelSignals.length === 0 && travelPlaces.length >= 3) {
    travelSignals.push(
      "Travel history leans toward repeated regional exploration instead of staying anchored to a single resort-style base."
    );
    travelPreferenceHints.push("Likes exploring distinct areas of a destination instead of staying in one bubble");
  }

  const repeatTravelPlaces = travelPlaces.filter((place) => place.visitCount > 1).length;
  const travelRepeatRatio = travelPlaces.length > 0 ? repeatTravelPlaces / travelPlaces.length : 0;

  const patternSignals = [...patternSignalsResult.signals];
  const patternPreferences = [...patternSignalsResult.preferences];
  if (travelRepeatRatio >= 0.35) {
    patternSignals.push("You revisit places you like, which points to valuing proven favorites over novelty for its own sake.");
    patternPreferences.push("Values proven favorites and high-confidence picks over novelty alone");
  }

  const preferences = dedupe(
    [
      ...travelPreferenceHints,
      ...patternPreferences,
      ...localPreferenceHints,
    ],
    6
  );
  const foodPreferenceFallbacks = dedupe(
    [...localPreferenceHints, ...travelPreferenceHints, ...patternPreferences].filter(isFoodPreferenceText),
    3
  );
  const foodPreferences = dedupe(
    [...inferredFoodPreferences, ...foodPreferenceFallbacks],
    4
  );

  return {
    summary: buildSummary(localSignals, travelSignals, patternSignals),
    preferences,
    foodPreferences,
    visitedDestinations,
    visitedPlaces,
    localSignals: dedupe(localSignals, 3),
    travelSignals: dedupe([...travelSignals, ...patternSignals], 4),
    mapPoints: buildMapPoints(sortablePlaces),
    stats: {
      visitCount: normalizedVisits.length,
      recurringPlaceCount: recurringPlaces.length,
      localPlaceCount: localPlaces.length,
      travelPlaceCount: travelPlaces.length,
      tripCount: episodes.length,
    },
  };
}
