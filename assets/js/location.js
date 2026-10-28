// Finding where to search: the browser's location, or a typed place name.

function makeError(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function isValidCoordinate(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number' &&
    isFinite(lat) && isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// One-time request. We never use watchPosition, so nothing is tracked.
function getCurrentLocation() {
  return new Promise(function (resolve, reject) {
    if (!('geolocation' in navigator)) {
      reject(makeError('unsupported', 'This browser does not support location.'));
      return;
    }
    if (window.isSecureContext === false) {
      reject(makeError('insecure', 'Location only works on a secure (HTTPS) page.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) {
        var lat = position.coords.latitude;
        var lon = position.coords.longitude;
        if (!isValidCoordinate(lat, lon)) {
          reject(makeError('unavailable', 'The browser returned an invalid location.'));
          return;
        }
        resolve({ lat: lat, lon: lon, accuracyMetres: position.coords.accuracy });
      },
      function (error) {
        if (error.code === 1) {
          reject(makeError('denied', 'Location permission was denied.'));
        } else if (error.code === 3) {
          reject(makeError('timeout', 'Finding your location took too long.'));
        } else {
          reject(makeError('unavailable', 'Your location is not available right now.'));
        }
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  });
}

var lastGeocodeTime = 0;

// Only called when the user presses "Search pharmacies". No autocomplete.
async function geocodePlace(placeName) {
  var wait = CONFIG.geocoderMinGapMs - (Date.now() - lastGeocodeTime);
  if (wait > 0) {
    await new Promise(function (done) { setTimeout(done, wait); });
  }
  lastGeocodeTime = Date.now();

  var url = CONFIG.geocoderUrl +
    '?format=jsonv2&limit=1&q=' + encodeURIComponent(placeName) +
    '&countrycodes=' + encodeURIComponent(CONFIG.geocoderCountryCodes);

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 15000);
  var response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } catch (error) {
    throw makeError('geocoder-unavailable', 'The place search service could not be reached.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw makeError('geocoder-busy', 'The place search service is busy.');
  }
  if (!response.ok) {
    throw makeError('geocoder-unavailable', 'The place search service returned an error.');
  }

  var results;
  try {
    results = await response.json();
  } catch (error) {
    throw makeError('geocoder-unavailable', 'The place search service sent an unreadable reply.');
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw makeError('not-found', 'That place could not be found.');
  }
  var lat = parseFloat(results[0].lat);
  var lon = parseFloat(results[0].lon);
  if (!isValidCoordinate(lat, lon)) {
    throw makeError('not-found', 'That place could not be found.');
  }
  return { lat: lat, lon: lon, label: String(results[0].display_name || placeName) };
}
