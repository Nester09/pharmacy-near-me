// All external services and limits live here so they are easy to change later.
var CONFIG = {
  // Overpass API: returns pharmacies mapped in OpenStreetMap.
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  // Optional second server, used only if the first is down (not when rate limited).
  // Leave empty to disable. Check the provider's usage policy before adding one.
  overpassFallbackUrl: '',

  // Geocoder: turns a typed place name into coordinates. Nominatim format.
  geocoderUrl: 'https://nominatim.openstreetmap.org/search',
  geocoderCountryCodes: 'ke',
  geocoderMinGapMs: 1100, // Nominatim allows at most 1 request per second

  // Map tiles. The standard OpenStreetMap tile server is meant for light use.
  // For a busy site, switch to a provider whose terms allow your traffic.
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  // Search limits
  defaultRadiusMetres: 5000,
  radiusOptionsMetres: [2000, 5000, 10000, 20000],
  maxResults: 500,
  requestTimeoutMs: 30000,

  // Opening hours are compared against the time in this zone.
  timeZone: 'Africa/Nairobi',
  fallbackMapCentre: [-1.2921, 36.8219]
};
