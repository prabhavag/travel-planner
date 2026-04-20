const fs = require("fs");
const os = require("os");
const path = require("path");
const { Client } = require("@googlemaps/google-maps-services-js");

const TIMELINE_VISIT_PROBABILITY_THRESHOLD = 0.6;
const TIMELINE_TOP_CANDIDATE_PROBABILITY_THRESHOLD = 0.75;
const TRIP_BREAK_GAP_HOURS = 72;
const TRIP_HOME_SETTLE_MINUTES = 240;
const LOCAL_TRAVEL_RADIUS_KM = 80;

const FOOD_TYPES = new Set([
  "bakery",
  "bar",
  "cafe",
  "coffee_shop",
  "food_court",
  "grocery_or_supermarket",
  "ice_cream_shop",
  "liquor_store",
  "meal_delivery",
  "meal_takeaway",
  "restaurant",
  "supermarket",
]);

const SHOPPING_TYPES = new Set([
  "book_store",
  "clothing_store",
  "convenience_store",
  "department_store",
  "electronics_store",
  "furniture_store",
  "home_goods_store",
  "market",
  "shopping_mall",
  "store",
]);

const HOTEL_TYPES = new Set([
  "campground",
  "hostel",
  "hotel",
  "lodging",
  "resort_hotel",
  "rv_park",
]);

const ATTRACTION_TYPES = new Set([
  "amusement_park",
  "aquarium",
  "beach",
  "campground",
  "national_park",
  "natural_feature",
  "park",
  "tourist_attraction",
  "visitor_center",
  "zoo",
]);

const SPORTS_TYPES = new Set([
  "athletic_field",
  "bowling_alley",
  "fitness_center",
  "golf_course",
  "gym",
  "ski_resort",
  "sports_activity_location",
  "sports_club",
  "sports_complex",
  "stadium",
]);

const AIRPORT_TYPES = new Set([
  "airport",
  "bus_station",
  "light_rail_station",
  "subway_station",
  "train_station",
  "transit_station",
]);

const CULTURE_TYPES = new Set([
  "art_gallery",
  "church",
  "cultural_landmark",
  "hindu_temple",
  "library",
  "mosque",
  "museum",
  "performing_arts_theater",
  "synagogue",
]);

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function toIsoString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function parseCoordinatePair(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^geo:([-\d.]+),([-\d.]+)$/i);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parseDurationMinutes(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60));
}

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareTimelineTimes(left, right) {
  const leftTime = left ? new Date(left).getTime() : Number.NaN;
  const rightTime = right ? new Date(right).getTime() : Number.NaN;
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime;
}

function dedupe(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    const normalized = normalizeLabel(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cityDisplayLabel(place) {
  if (!place.city) return null;
  if (place.region) return `${place.city}, ${place.region}`;
  if (place.country) return `${place.city}, ${place.country}`;
  return place.city;
}

function buildCityId(city, region, countryCode, country) {
  if (!city) return null;
  return [normalizeLabel(city), normalizeLabel(region || ""), normalizeLabel(countryCode || country || "")].join("|");
}

function buildCountryId(countryCode, country) {
  if (!country && !countryCode) return null;
  return normalizeLabel(countryCode || country || "");
}

function categorizePlaceTypes(types) {
  const normalized = Array.isArray(types) ? types.filter((v) => typeof v === "string" && v.trim()) : [];
  const hasAny = (expected) => normalized.some((type) => expected.has(type));
  if (hasAny(AIRPORT_TYPES)) return "Airports";
  if (hasAny(HOTEL_TYPES)) return "Hotels";
  if (hasAny(FOOD_TYPES) || normalized.some((type) => type.endsWith("_restaurant"))) return "Food & Drink";
  if (hasAny(CULTURE_TYPES)) return "Culture";
  if (hasAny(SPORTS_TYPES)) return "Sports";
  if (hasAny(SHOPPING_TYPES) || normalized.some((type) => type.endsWith("_store"))) return "Shopping";
  if (hasAny(ATTRACTION_TYPES)) return "Attractions";
  return "Other";
}

function extractLatLngFromGeometry(geometry, fallback) {
  const lat = geometry && geometry.location && geometry.location.lat;
  const lng = geometry && geometry.location && geometry.location.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return fallback;
}

function getAddressComponent(details, type, variant = "long_name") {
  const component = (details.address_components || []).find((item) => Array.isArray(item.types) && item.types.includes(type));
  const value = component && component[variant];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function durationHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round(((end - start) / (1000 * 60 * 60)) * 10) / 10;
}

function monthLabel(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

function findTripMatch(trips, placeName, year, monthIndex) {
  const target = normalizeLabel(placeName);
  return trips.some((trip) => {
    const labels = [trip.label, trip.city || "", ...(trip.topPlaces || [])].map(normalizeLabel).join(" ");
    if (!labels.includes(target)) return false;
    const startValue = trip.startTime || trip.endTime;
    const endValue = trip.endTime || trip.startTime;
    if (!startValue || !endValue) return false;
    const start = new Date(startValue);
    const end = new Date(endValue);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
    return start.getTime() < monthEnd.getTime() && end.getTime() >= monthStart.getTime();
  });
}

function extractVisits(raw) {
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  const visits = [];
  for (const entry of entries) {
    const visit = entry && entry.visit;
    const candidate = visit && visit.topCandidate;
    if (!visit || !candidate) continue;
    const visitProbability = Number(visit.probability);
    const candidateProbability = Number(candidate.probability);
    const placeId = typeof candidate.placeID === "string" && candidate.placeID.trim() ? candidate.placeID.trim() : null;
    const coordinates = parseCoordinatePair(candidate.placeLocation);
    if (
      !Number.isFinite(visitProbability) ||
      visitProbability <= TIMELINE_VISIT_PROBABILITY_THRESHOLD ||
      !Number.isFinite(candidateProbability) ||
      candidateProbability <= TIMELINE_TOP_CANDIDATE_PROBABILITY_THRESHOLD ||
      !placeId ||
      !coordinates
    ) {
      continue;
    }
    const startTime = toIsoString(entry.startTime) || toIsoString(visit.startTime);
    const endTime = toIsoString(entry.endTime) || toIsoString(visit.endTime);
    visits.push({
      id: `${placeId}:${startTime || endTime || "unknown"}`,
      key: placeId,
      placeId,
      semanticType: typeof candidate.semanticType === "string" ? candidate.semanticType.trim() || null : null,
      lat: coordinates.lat,
      lng: coordinates.lng,
      startTime,
      endTime,
      durationMinutes: parseDurationMinutes(startTime, endTime),
      visitProbability,
      candidateProbability,
    });
  }
  visits.sort((a, b) => compareTimelineTimes(a.startTime || a.endTime, b.startTime || b.endTime));
  return visits;
}

function getCachePaths() {
  const basePath =
    process.env.PLACES_CACHE_PATH || path.join(os.tmpdir(), "travel-planner-place-details-cache.json");
  return {
    timeline: basePath.replace(/\.json$/i, ".timeline-place-info.json"),
  };
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function resolvePlaceInfo(uniquePlaces) {
  loadDotEnv(path.join(process.cwd(), ".env"));
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY or GOOGLE_GEOCODING_API_KEY is missing.");
  }

  const client = new Client({});
  const paths = getCachePaths();
  const timelineCache = loadJson(paths.timeline);
  const geocodeCache = new Map();
  const results = new Map();
  let fetchedDetails = 0;
  let fetchedGeocodes = 0;

  const fetchReverseGeocode = async (coords) => {
    const cacheKey = JSON.stringify({
      version: 1,
      lat: Number(coords.lat.toFixed(3)),
      lng: Number(coords.lng.toFixed(3)),
    });
    const cached = geocodeCache.get(cacheKey);
    if (cached) return cached;

    const response = await client.reverseGeocode({
      params: {
        latlng: { lat: coords.lat, lng: coords.lng },
        key: apiKey,
        result_type: [
          "locality",
          "postal_town",
          "administrative_area_level_2",
          "administrative_area_level_1",
          "country",
        ],
      },
    });
    fetchedGeocodes += 1;
    const result = Array.isArray(response.data.results) ? response.data.results[0] : null;
    if (!result) return null;
    const getComponent = (type, variant = "long_name") => {
      const component = (result.address_components || []).find((item) => Array.isArray(item.types) && item.types.includes(type));
      const value = component && component[variant];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    const value = {
      formattedAddress: result.formatted_address || "",
      locality: getComponent("locality") || getComponent("postal_town") || getComponent("administrative_area_level_2"),
      adminAreaLevel1: getComponent("administrative_area_level_1", "short_name") || getComponent("administrative_area_level_1"),
      country: getComponent("country"),
      countryCode: getComponent("country", "short_name"),
    };
    geocodeCache.set(cacheKey, value);
    return value;
  };

  for (let index = 0; index < uniquePlaces.length; index += 8) {
    const batch = uniquePlaces.slice(index, index + 8);
    const resolved = await Promise.all(
      batch.map(async (place) => {
        const cached = timelineCache[place.placeId];
        if (cached && cached.info) {
          return [place.placeId, cached.info];
        }

        try {
          const response = await client.placeDetails({
            params: {
              place_id: place.placeId,
              key: apiKey,
              fields: [
                "name",
                "formatted_address",
                "address_components",
                "types",
                "geometry",
              ],
            },
          });
          fetchedDetails += 1;
          const details = response.data.result;
          if (!details) {
            const geocoded = await fetchReverseGeocode({ lat: place.lat, lng: place.lng }).catch(() => null);
            if (!geocoded) {
              timelineCache[place.placeId] = { cachedAt: Date.now(), info: null };
              return [place.placeId, null];
            }
            const info = {
              placeId: place.placeId,
              name: geocoded.locality || geocoded.adminAreaLevel1 || geocoded.country || place.placeId,
              formattedAddress: null,
              city: geocoded.locality || null,
              region: geocoded.adminAreaLevel1 || null,
              country: geocoded.country || null,
              countryCode: geocoded.countryCode || null,
              lat: place.lat,
              lng: place.lng,
              types: [],
              category: "Other",
              vicinity: null,
              rating: null,
              userRatingsTotal: null,
              priceLevel: null,
              formattedPhoneNumber: null,
              website: null,
              openingHoursText: null,
              editorialSummary: null,
              addressComponents: [],
              photos: [],
              hasDetails: false,
              hasGeocode: true,
            };
            timelineCache[place.placeId] = { cachedAt: Date.now(), info };
            return [place.placeId, info];
          }

          const coords = extractLatLngFromGeometry(details.geometry, { lat: place.lat, lng: place.lng });
          let city =
            getAddressComponent(details, "locality") ||
            getAddressComponent(details, "postal_town") ||
            getAddressComponent(details, "administrative_area_level_3") ||
            getAddressComponent(details, "administrative_area_level_2");
          let region =
            getAddressComponent(details, "administrative_area_level_1", "short_name") ||
            getAddressComponent(details, "administrative_area_level_1");
          let country = getAddressComponent(details, "country");
          let countryCode = getAddressComponent(details, "country", "short_name");

          if ((!city || !country) && coords) {
            try {
              const geocoded = await fetchReverseGeocode(coords);
              city = city || (geocoded && geocoded.locality) || null;
              region = region || (geocoded && geocoded.adminAreaLevel1) || null;
              country = country || (geocoded && geocoded.country) || null;
              countryCode = countryCode || (geocoded && geocoded.countryCode) || null;
            } catch (_) {}
          }

          const info = {
            placeId: place.placeId,
            name: details.name || place.placeId,
            formattedAddress: details.formatted_address || null,
            city: city || null,
            region: region || null,
            country: country || null,
            countryCode: countryCode || null,
            lat: coords.lat,
            lng: coords.lng,
            types: Array.isArray(details.types) ? details.types.filter((v) => typeof v === "string") : [],
            category: categorizePlaceTypes(details.types),
            vicinity: null,
            rating: null,
            userRatingsTotal: null,
            priceLevel: null,
            formattedPhoneNumber: null,
            website: null,
            openingHoursText: null,
            editorialSummary: null,
            addressComponents: Array.isArray(details.address_components)
              ? details.address_components.map((component) => ({
                long_name: component.long_name,
                short_name: component.short_name,
                types: Array.isArray(component.types) ? component.types : [],
              }))
              : [],
            photos: [],
            hasDetails: true,
            hasGeocode: !(!city || !country),
          };
          timelineCache[place.placeId] = { cachedAt: Date.now(), info };
          return [place.placeId, info];
        } catch (error) {
          const geocoded = await fetchReverseGeocode({ lat: place.lat, lng: place.lng }).catch(() => null);
          if (!geocoded) {
            timelineCache[place.placeId] = { cachedAt: Date.now(), info: null };
            return [place.placeId, null];
          }
          const info = {
            placeId: place.placeId,
            name: geocoded.locality || geocoded.adminAreaLevel1 || geocoded.country || place.placeId,
            formattedAddress: null,
            city: geocoded.locality || null,
            region: geocoded.adminAreaLevel1 || null,
            country: geocoded.country || null,
            countryCode: geocoded.countryCode || null,
            lat: place.lat,
            lng: place.lng,
            types: [],
            category: "Other",
            vicinity: null,
            rating: null,
            userRatingsTotal: null,
            priceLevel: null,
            formattedPhoneNumber: null,
            website: null,
            openingHoursText: null,
            editorialSummary: null,
            addressComponents: [],
            photos: [],
            hasDetails: false,
            hasGeocode: true,
          };
          timelineCache[place.placeId] = { cachedAt: Date.now(), info };
          return [place.placeId, info];
        }
      })
    );

    resolved.forEach(([placeId, info]) => {
      results.set(placeId, info);
    });
    saveJson(paths.timeline, timelineCache);
  }

  return { results, fetchedDetails, fetchedGeocodes, paths };
}

function buildPlaceSummaries(visits, placeInfoById) {
  const places = new Map();
  for (const visit of visits) {
    const info = placeInfoById.get(visit.placeId);
    const existing = places.get(visit.placeId);
    const base = info || {
      placeId: visit.placeId,
      name: visit.semanticType || visit.placeId,
      category: "Other",
      city: null,
      region: null,
      country: null,
      countryCode: null,
      formattedAddress: null,
      lat: visit.lat,
      lng: visit.lng,
      types: [],
    };
    if (existing) {
      existing.visitCount += 1;
      existing.totalDurationMinutes += visit.durationMinutes;
      if (visit.startTime && (!existing.firstVisitedAt || compareTimelineTimes(visit.startTime, existing.firstVisitedAt) < 0)) {
        existing.firstVisitedAt = visit.startTime;
      }
      if (visit.endTime && (!existing.lastVisitedAt || compareTimelineTimes(visit.endTime, existing.lastVisitedAt) > 0)) {
        existing.lastVisitedAt = visit.endTime;
      }
      continue;
    }
    places.set(visit.placeId, {
      ...base,
      visitCount: 1,
      totalDurationMinutes: visit.durationMinutes,
      firstVisitedAt: visit.startTime,
      lastVisitedAt: visit.endTime,
    });
  }
  return [...places.values()].sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes || b.visitCount - a.visitCount);
}

function buildCitySummaries(places) {
  const cities = new Map();
  for (const place of places) {
    const cityId = buildCityId(place.city, place.region, place.countryCode, place.country);
    if (!cityId || !place.city) continue;
    const existing = cities.get(cityId);
    const weight = Math.max(place.totalDurationMinutes, 30);
    if (existing) {
      const combinedWeight = existing.weight + weight;
      existing.lat = (existing.lat * existing.weight + place.lat * weight) / combinedWeight;
      existing.lng = (existing.lng * existing.weight + place.lng * weight) / combinedWeight;
      existing.weight = combinedWeight;
      existing.visitCount += place.visitCount;
      existing.totalDurationMinutes += place.totalDurationMinutes;
      existing.placeCount += 1;
      if (place.firstVisitedAt && (!existing.firstVisitedAt || compareTimelineTimes(place.firstVisitedAt, existing.firstVisitedAt) < 0)) {
        existing.firstVisitedAt = place.firstVisitedAt;
      }
      if (place.lastVisitedAt && (!existing.lastVisitedAt || compareTimelineTimes(place.lastVisitedAt, existing.lastVisitedAt) > 0)) {
        existing.lastVisitedAt = place.lastVisitedAt;
      }
      existing.categories.add(place.category);
      continue;
    }
    cities.set(cityId, {
      id: cityId,
      city: place.city,
      region: place.region,
      country: place.country,
      countryCode: place.countryCode,
      lat: place.lat,
      lng: place.lng,
      visitCount: place.visitCount,
      totalDurationMinutes: place.totalDurationMinutes,
      placeCount: 1,
      tripCount: 0,
      firstVisitedAt: place.firstVisitedAt,
      lastVisitedAt: place.lastVisitedAt,
      categories: new Set([place.category]),
      weight,
    });
  }
  return [...cities.values()].map((city) => ({
    ...city,
    categories: [...city.categories],
  })).sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes || b.visitCount - a.visitCount);
}

function buildCountrySummaries(places) {
  const countries = new Map();
  for (const place of places) {
    const countryId = buildCountryId(place.countryCode, place.country);
    if (!countryId || !place.country) continue;
    const existing = countries.get(countryId);
    const weight = Math.max(place.totalDurationMinutes, 30);
    if (existing) {
      const combinedWeight = existing.weight + weight;
      existing.lat = (existing.lat * existing.weight + place.lat * weight) / combinedWeight;
      existing.lng = (existing.lng * existing.weight + place.lng * weight) / combinedWeight;
      existing.weight = combinedWeight;
      existing.visitCount += place.visitCount;
      existing.totalDurationMinutes += place.totalDurationMinutes;
      existing.placeCount += 1;
      if (place.firstVisitedAt && (!existing.firstVisitedAt || compareTimelineTimes(place.firstVisitedAt, existing.firstVisitedAt) < 0)) {
        existing.firstVisitedAt = place.firstVisitedAt;
      }
      if (place.lastVisitedAt && (!existing.lastVisitedAt || compareTimelineTimes(place.lastVisitedAt, existing.lastVisitedAt) > 0)) {
        existing.lastVisitedAt = place.lastVisitedAt;
      }
      continue;
    }
    countries.set(countryId, {
      id: countryId,
      country: place.country,
      countryCode: place.countryCode,
      lat: place.lat,
      lng: place.lng,
      visitCount: place.visitCount,
      totalDurationMinutes: place.totalDurationMinutes,
      cityCount: 0,
      placeCount: 1,
      tripCount: 0,
      firstVisitedAt: place.firstVisitedAt,
      lastVisitedAt: place.lastVisitedAt,
      weight,
    });
  }
  return [...countries.values()].sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes || b.visitCount - a.visitCount);
}

function buildResolvedVisits(visits, places) {
  const placeById = new Map(places.map((place) => [place.placeId, place]));
  return visits.map((visit) => {
    const place = placeById.get(visit.placeId);
    return {
      visit,
      place,
      cityId: buildCityId(place.city, place.region, place.countryCode, place.country),
      countryId: buildCountryId(place.countryCode, place.country),
    };
  });
}

function detectHomeContext(cities, countries) {
  const homeCity = [...cities].sort((a, b) => (b.visitCount * 4 + b.totalDurationMinutes / 60) - (a.visitCount * 4 + a.totalDurationMinutes / 60))[0] || null;
  const homeCountry = homeCity && homeCity.countryCode
    ? homeCity.countryCode
    : ([...countries].sort((a, b) => (b.visitCount * 4 + b.totalDurationMinutes / 60) - (a.visitCount * 4 + a.totalDurationMinutes / 60))[0] || {}).countryCode || null;
  return {
    homeCityId: homeCity ? homeCity.id : null,
    homeCountryCode: homeCountry,
    homeLat: homeCity ? homeCity.lat : null,
    homeLng: homeCity ? homeCity.lng : null,
  };
}

function isAwayVisit(event, context) {
  if (context.homeCityId && event.cityId === context.homeCityId) return false;
  if (
    context.homeLat != null &&
    context.homeLng != null &&
    distanceKm(context.homeLat, context.homeLng, event.place.lat, event.place.lng) <= LOCAL_TRAVEL_RADIUS_KM
  ) {
    return false;
  }
  if (
    event.place.category === "Airports" &&
    context.homeCountryCode &&
    event.place.countryCode === context.homeCountryCode &&
    context.homeLat != null &&
    context.homeLng != null &&
    distanceKm(context.homeLat, context.homeLng, event.place.lat, event.place.lng) < LOCAL_TRAVEL_RADIUS_KM
  ) {
    return false;
  }
  if (context.homeCountryCode && event.place.countryCode && event.place.countryCode !== context.homeCountryCode) return true;
  if (context.homeCityId && event.cityId && event.cityId !== context.homeCityId) return true;
  if (!context.homeCityId && event.cityId) return true;
  return false;
}

function shouldSplitTrip(previous, next) {
  const previousTime = new Date(previous.visit.endTime || previous.visit.startTime || "").getTime();
  const nextTime = new Date(next.visit.startTime || next.visit.endTime || "").getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) return false;
  const gapHours = (nextTime - previousTime) / (1000 * 60 * 60);
  if (gapHours > TRIP_BREAK_GAP_HOURS) return true;
  if (gapHours > 36 && previous.cityId && next.cityId && previous.cityId !== next.cityId) return true;
  return false;
}

function summarizeTrip(events, tripIndex) {
  if (events.length === 0) return null;
  const nonAirportEvents = events.filter((event) => event.place.category !== "Airports");
  const anchorEvents = nonAirportEvents.length > 0 ? nonAirportEvents : events;
  const cityScores = new Map();
  const countryScores = new Map();
  const placeScores = new Map();
  let totalLat = 0;
  let totalLng = 0;
  let totalWeight = 0;
  for (const event of anchorEvents) {
    const weight = Math.max(event.visit.durationMinutes, 45);
    totalLat += event.place.lat * weight;
    totalLng += event.place.lng * weight;
    totalWeight += weight;
    if (event.cityId) cityScores.set(event.cityId, (cityScores.get(event.cityId) || 0) + weight);
    if (event.countryId) countryScores.set(event.countryId, (countryScores.get(event.countryId) || 0) + weight);
    placeScores.set(event.place.name, (placeScores.get(event.place.name) || 0) + weight);
  }
  const dominantCityId = [...cityScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const dominantCountryId = [...countryScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const dominantEvent = anchorEvents.find((event) => event.cityId === dominantCityId) || anchorEvents[0];
  const dominantCountryEvent = anchorEvents.find((event) => event.countryId === dominantCountryId) || dominantEvent;
  const topPlaces = [...placeScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const cities = dedupe(anchorEvents.map((event) => cityDisplayLabel(event.place)).filter(Boolean));
  const startTime = events[0].visit.startTime || events[0].visit.endTime;
  const endTime = events[events.length - 1].visit.endTime || events[events.length - 1].visit.startTime;
  const totalDurationMinutes = events.reduce((sum, event) => sum + event.visit.durationMinutes, 0);
  const labelBase = cityDisplayLabel(dominantEvent.place) || dominantCountryEvent.place.country || topPlaces[0] || `Trip ${tripIndex + 1}`;
  const tripMonthLabel = monthLabel(startTime || endTime);
  return {
    id: `trip-${tripIndex + 1}`,
    label: tripMonthLabel ? `${labelBase} · ${tripMonthLabel}` : labelBase,
    startTime,
    endTime,
    monthLabel: tripMonthLabel,
    city: dominantEvent.place.city || null,
    region: dominantEvent.place.region || null,
    country: dominantCountryEvent.place.country || dominantEvent.place.country || null,
    countryCode: dominantCountryEvent.place.countryCode || dominantEvent.place.countryCode || null,
    lat: totalWeight > 0 ? totalLat / totalWeight : dominantEvent.place.lat,
    lng: totalWeight > 0 ? totalLng / totalWeight : dominantEvent.place.lng,
    visitCount: events.length,
    placeCount: dedupe(anchorEvents.map((event) => event.place.name)).length,
    totalDurationMinutes,
    durationHours: durationHours(startTime, endTime),
    cities,
    topPlaces,
  };
}

function buildTrips(resolvedVisits, context) {
  const trips = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    const summary = summarizeTrip(current, trips.length);
    const uniqueCityCount = new Set(current.map((event) => event.cityId).filter(Boolean)).size;
    const totalDurationMinutes = current.reduce((sum, event) => sum + event.visit.durationMinutes, 0);
    const tripDistanceKm =
      summary && context.homeLat != null && context.homeLng != null
        ? distanceKm(context.homeLat, context.homeLng, summary.lat, summary.lng)
        : null;
    if (
      summary &&
      (
        summary.countryCode !== context.homeCountryCode ||
        uniqueCityCount >= 2 ||
        totalDurationMinutes >= 6 * 60 ||
        summary.placeCount >= 2 ||
        (tripDistanceKm != null && tripDistanceKm > LOCAL_TRAVEL_RADIUS_KM)
      )
    ) {
      trips.push(summary);
    }
    current = [];
  };
  for (const event of resolvedVisits) {
    const away = isAwayVisit(event, context);
    if (!away) {
      if (current.length > 0) {
        const homeDuration = event.visit.durationMinutes;
        if (homeDuration >= TRIP_HOME_SETTLE_MINUTES || event.place.category !== "Airports") {
          flush();
        }
      }
      continue;
    }
    if (current.length === 0) {
      current.push(event);
      continue;
    }
    if (shouldSplitTrip(current[current.length - 1], event)) {
      flush();
    }
    current.push(event);
  }
  flush();
  return trips;
}

function applyTripCounts(cities, countries, trips) {
  const cityTripCounts = new Map();
  const countryTripCounts = new Map();
  for (const trip of trips) {
    const cityId = buildCityId(trip.city, trip.region, trip.countryCode, trip.country);
    const countryId = buildCountryId(trip.countryCode, trip.country);
    if (cityId) cityTripCounts.set(cityId, (cityTripCounts.get(cityId) || 0) + 1);
    if (countryId) countryTripCounts.set(countryId, (countryTripCounts.get(countryId) || 0) + 1);
  }
  const countryCityCounts = new Map();
  const cityResults = cities.map((city) => {
    const countryId = buildCountryId(city.countryCode, city.country);
    if (countryId) {
      const set = countryCityCounts.get(countryId) || new Set();
      set.add(city.id);
      countryCityCounts.set(countryId, set);
    }
    return {
      ...city,
      tripCount: cityTripCounts.get(city.id) || 0,
    };
  });
  const countryResults = countries.map((country) => ({
    ...country,
    cityCount: (countryCityCounts.get(country.id) || new Set()).size,
    tripCount: countryTripCounts.get(country.id) || 0,
  }));
  return { cities: cityResults, countries: countryResults };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/verify-timeline-file.js <timeline-file>");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const visits = extractVisits(raw);
  const uniquePlaces = [...new Map(visits.map((visit) => [visit.placeId, { placeId: visit.placeId, lat: visit.lat, lng: visit.lng }])).values()];
  const { results: placeInfoById, fetchedDetails, fetchedGeocodes, paths } = await resolvePlaceInfo(uniquePlaces);
  const places = buildPlaceSummaries(visits, placeInfoById);
  const citySummaries = buildCitySummaries(places);
  const countrySummaries = buildCountrySummaries(places);
  const resolvedVisits = buildResolvedVisits(visits, places);
  const homeContext = detectHomeContext(citySummaries, countrySummaries);
  const trips = buildTrips(resolvedVisits, homeContext);
  const { cities, countries } = applyTripCounts(citySummaries, countrySummaries, trips);

  const usCityCount = cities.filter((city) => city.countryCode === "US" || normalizeLabel(city.country) === "united states").length;
  const indiaCityCount = cities.filter((city) => city.countryCode === "IN" || normalizeLabel(city.country) === "india").length;
  const verification = {
    usCities: usCityCount,
    indiaCities: indiaCityCount,
    countries: countries.length,
    trips: trips.length,
    atlanticCityNov2024: findTripMatch(trips, "Atlantic City", 2024, 10),
    philadelphiaAug2024: findTripMatch(trips, "Philadelphia", 2024, 7),
    seoulApr2024: findTripMatch(trips, "Seoul", 2024, 3),
  };

  const output = {
    filePath,
    stats: {
      qualifyingVisits: visits.length,
      uniquePlaceIds: uniquePlaces.length,
      resolvedPlaces: places.filter((place) => place.city || place.country).length,
      cityCount: cities.length,
      countryCount: countries.length,
      tripCount: trips.length,
    },
    verification,
    topCountries: countries.slice(0, 20).map((country) => ({
      country: country.country,
      cityCount: country.cityCount,
      placeCount: country.placeCount,
      tripCount: country.tripCount,
      totalDurationMinutes: country.totalDurationMinutes,
    })),
    topCities: cities.slice(0, 30).map((city) => ({
      city: city.region ? `${city.city}, ${city.region}` : city.city,
      country: city.country,
      placeCount: city.placeCount,
      tripCount: city.tripCount,
      totalDurationMinutes: city.totalDurationMinutes,
    })),
    matchedTrips: trips
      .filter((trip) => {
        const labels = [trip.label, trip.city || "", ...(trip.topPlaces || [])].map(normalizeLabel).join(" ");
        return labels.includes("atlantic city") || labels.includes("philadelphia") || labels.includes("seoul");
      })
      .slice(0, 20),
    api: {
      fetchedDetails,
      fetchedGeocodes,
      timelineCachePath: paths.timeline,
      geocodeCachePath: paths.geocode,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
