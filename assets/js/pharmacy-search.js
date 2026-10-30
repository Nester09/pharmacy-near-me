// Fetching pharmacies from Overpass, cleaning them up, and working out
// distances and opening status.

var DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
var overpassBlockedUntil = 0;   // set after an HTTP 429, so we don't hammer the server
var searchCache = {};           // remembers results for the same place and radius

// ---------- Distance ----------

function calculateDistanceMetres(lat1, lon1, lat2, lon2) {
  var earthRadius = 6371000;
  var toRadians = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRadians;
  var dLon = (lon2 - lon1) * toRadians;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRadians) * Math.cos(lat2 * toRadians) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(metres) {
  if (metres === null) { return ''; }
  if (metres < 1000) { return Math.round(metres / 10) * 10 + ' m'; }
  return (metres / 1000).toFixed(1) + ' km';
}

// ---------- Overpass request ----------

function buildOverpassQuery(centre, radiusMetres) {
  var around = '(around:' + Math.round(radiusMetres) + ',' +
    centre.lat.toFixed(6) + ',' + centre.lon.toFixed(6) + ')';
  return '[out:json][timeout:25];(' +
    'nwr["amenity"="pharmacy"]' + around + ';' +
    'nwr["healthcare"="pharmacy"]' + around + ';' +
    ');out center tags ' + CONFIG.maxResults + ';';
}

async function requestOverpass(endpoint, query) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, CONFIG.requestTimeoutMs);
  var response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw makeError('timeout', 'The pharmacy service took too long to answer.');
    }
    throw makeError('network', 'The pharmacy service could not be reached.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    var seconds = parseInt(response.headers.get('Retry-After'), 10);
    if (!isFinite(seconds) || seconds < 1) { seconds = 30; }
    overpassBlockedUntil = Date.now() + seconds * 1000;
    var limitError = makeError('rate-limit', 'The pharmacy service asked us to slow down.');
    limitError.retryAfterSeconds = seconds;
    throw limitError;
  }
  if (response.status === 504 || response.status === 503 || response.status === 502) {
    throw makeError('busy', 'The pharmacy service is busy right now.');
  }
  if (!response.ok) {
    throw makeError('server', 'The pharmacy service returned an error.');
  }

  var data;
  try {
    data = await response.json();
  } catch (error) {
    throw makeError('bad-data', 'The pharmacy service sent an unreadable reply.');
  }
  if (!data || !Array.isArray(data.elements)) {
    throw makeError('bad-data', 'The pharmacy service sent an unexpected reply.');
  }
  // Overpass sometimes answers 200 but reports that it ran out of time or memory.
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) {
    throw makeError('busy', 'The pharmacy service could not finish the search.');
  }
  return data;
}

// Returns an object: { pharmacies: [...], hitLimit: true/false }
async function fetchPharmacies(centre, radiusMetres) {
  var radius = Math.min(Math.max(radiusMetres, 500), 25000);
  var cacheKey = centre.lat.toFixed(4) + ',' + centre.lon.toFixed(4) + ',' + radius;
  if (searchCache[cacheKey]) { return searchCache[cacheKey]; }

  if (Date.now() < overpassBlockedUntil) {
    var waitError = makeError('rate-limit', 'Please wait before searching again.');
    waitError.retryAfterSeconds = Math.ceil((overpassBlockedUntil - Date.now()) / 1000);
    throw waitError;
  }

  var query = buildOverpassQuery(centre, radius);
  var endpoints = [CONFIG.overpassUrl];
  if (CONFIG.overpassFallbackUrl) { endpoints.push(CONFIG.overpassFallbackUrl); }

  var data = null;
  var lastError = null;
  for (var i = 0; i < endpoints.length && data === null; i++) {
    try {
      data = await requestOverpass(endpoints[i], query);
    } catch (error) {
      lastError = error;
      // Never move on to the fallback after a rate-limit; that would dodge the limit.
      if (error.code === 'rate-limit') { throw error; }
    }
  }
  if (data === null) { throw lastError; }

  var pharmacies = data.elements.map(parsePharmacy).filter(function (p) { return p !== null; });
  pharmacies = removeDuplicates(pharmacies);
  addDistances(pharmacies, centre);

  var result = { pharmacies: pharmacies, hitLimit: data.elements.length >= CONFIG.maxResults };
  searchCache[cacheKey] = result;
  return result;
}

// ---------- Turning raw OpenStreetMap elements into simple objects ----------

function cleanText(value) {
  if (typeof value !== 'string') { return ''; }
  return value.replace(/\s+/g, ' ').trim();
}

function parsePharmacy(element) {
  if (!element || !element.type || !element.id) { return null; }
  var tags = element.tags || {};

  var lat = null;
  var lon = null;
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    lat = element.lat; lon = element.lon;
  } else if (element.center && typeof element.center.lat === 'number') {
    lat = element.center.lat; lon = element.center.lon;
  }
  if (!isValidCoordinate(lat, lon)) { lat = null; lon = null; }

  var addressParts = [];
  var fullAddress = cleanText(tags['addr:full']);
  if (fullAddress) {
    addressParts.push(fullAddress);
  } else {
    var street = [cleanText(tags['addr:housenumber']), cleanText(tags['addr:street'])].join(' ').trim();
    [street, cleanText(tags['addr:place']), cleanText(tags['addr:suburb']),
      cleanText(tags['addr:city'] || tags['addr:town'])].forEach(function (part) {
      if (part) { addressParts.push(part); }
    });
  }

  return {
    id: element.type + '/' + element.id,
    osmUrl: 'https://www.openstreetmap.org/' + element.type + '/' + element.id,
    name: cleanText(tags.name) || '',
    operator: cleanText(tags.operator || tags.brand),
    address: addressParts.join(', '),
    openingHours: cleanText(tags.opening_hours),
    phone: cleanText(tags.phone || tags['contact:phone'] || tags.mobile || tags['contact:mobile']),
    website: cleanText(tags.website || tags['contact:website']),
    email: cleanText(tags.email || tags['contact:email']),
    lat: lat,
    lon: lon,
    distanceMetres: null
  };
}

// The same shop is sometimes mapped twice (a point and a building outline).
function removeDuplicates(pharmacies) {
  var kept = [];
  pharmacies.forEach(function (candidate) {
    var isDuplicate = kept.some(function (existing) {
      if (existing.id === candidate.id) { return true; }
      if (!existing.name || existing.name !== candidate.name) { return false; }
      if (existing.lat === null || candidate.lat === null) { return false; }
      return calculateDistanceMetres(existing.lat, existing.lon, candidate.lat, candidate.lon) < 30;
    });
    if (!isDuplicate) { kept.push(candidate); }
  });
  return kept;
}

function addDistances(pharmacies, centre) {
  pharmacies.forEach(function (p) {
    p.distanceMetres = (p.lat === null) ? null :
      calculateDistanceMetres(centre.lat, centre.lon, p.lat, p.lon);
  });
}

function sortByDistance(pharmacies) {
  return pharmacies.slice().sort(function (a, b) {
    if (a.distanceMetres === null && b.distanceMetres === null) { return 0; }
    if (a.distanceMetres === null) { return 1; }
    if (b.distanceMetres === null) { return -1; }
    return a.distanceMetres - b.distanceMetres;
  });
}

// ---------- Opening hours ----------
// Understands common OpenStreetMap patterns such as "Mo-Sa 08:00-20:00; Su off".
// Anything more complicated (public holidays, sunrise, week numbers...) returns
// null, and the interface then says "Hours need confirmation".

function readDayList(text) {
  var days = [];
  var pieces = text.split(',');
  for (var i = 0; i < pieces.length; i++) {
    var range = pieces[i].trim().split('-');
    var first = DAY_CODES.indexOf(range[0].trim());
    var last = range.length > 1 ? DAY_CODES.indexOf(range[1].trim()) : first;
    if (range.length > 2 || first === -1 || last === -1) { return null; }
    var day = first;
    days.push(day);
    while (day !== last) {   // handles ranges that wrap, like Sa-Mo
      day = (day + 1) % 7;
      days.push(day);
    }
  }
  return days;
}

function readTimeList(text) {
  var lower = text.trim().toLowerCase();
  if (lower === 'off' || lower === 'closed') { return []; }

  var intervals = [];
  var pieces = text.split(',');

  for (var i = 0; i < pieces.length; i++) {
    var match = pieces[i].trim().match(
      /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/
    );

    if (!match) { return null; }

    var startHour = parseInt(match[1], 10);
    var startMinute = parseInt(match[2], 10);
    var endHour = parseInt(match[3], 10);
    var endMinute = parseInt(match[4], 10);

    if (
      startHour > 23 || startMinute > 59 ||
      endHour > 24 || endMinute > 59 ||
      (endHour === 24 && endMinute !== 0)
    ) {
      return null;
    }

    var start = startHour * 60 + startMinute;
    var end = endHour * 60 + endMinute;

    if (start === end) { return null; }

    intervals.push({ start: start, end: end });
  }

  return intervals;
}

// Returns an array of 7 lists of time intervals (Monday first), or null.
function parseOpeningHours(text) {
  var week = [[], [], [], [], [], [], []];
  if (text.trim() === '24/7') {
    return week.map(function () { return [{ start: 0, end: 1440 }]; });
  }
  var rules = text.split(';');
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i].trim();
    if (rule === '') { continue; }
    var match = rule.match(/^(?:([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+)?(.+)$/);
    if (!match) { return null; }
    var days = match[1] ? readDayList(match[1]) : [0, 1, 2, 3, 4, 5, 6];
    var intervals = readTimeList(match[2]);
    if (days === null || intervals === null) { return null; }
    // A later rule replaces earlier ones for the same day.
    days.forEach(function (day) { week[day] = intervals; });
  }
  return week;
}

function getTimeInZone(now) {
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  var weekday = '';
  var hour = 0;
  var minute = 0;
  parts.forEach(function (part) {
    if (part.type === 'weekday') { weekday = part.value; }
    if (part.type === 'hour') { hour = parseInt(part.value, 10); }
    if (part.type === 'minute') { minute = parseInt(part.value, 10); }
  });
  var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return { day: dayNames.indexOf(weekday), minutes: hour * 60 + minute };
}

// Returns { kind, text } where kind is one of:
// 'none' (no hours listed), 'unclear', '24h', 'open', 'closed'
function getHoursStatus(openingHoursText, now) {
  if (!openingHoursText) { return { kind: 'none' }; }
  var week = parseOpeningHours(openingHoursText);
  if (week === null) { return { kind: 'unclear' }; }

  var is24Hours = week.every(function (intervals) {
    return intervals.length === 1 && intervals[0].start === 0 && intervals[0].end === 1440;
  });
  if (is24Hours) { return { kind: '24h' }; }

  var current = getTimeInZone(now || new Date());
  if (current.day === -1) { return { kind: 'unclear' }; }
  var yesterday = (current.day + 6) % 7;

  var isOpen = week[current.day].some(function (interval) {
    if (interval.end > interval.start) {
      return current.minutes >= interval.start && current.minutes < interval.end;
    }
    return current.minutes >= interval.start;   // overnight: open until midnight today
  });
  if (!isOpen) {
    // Overnight hours that started yesterday and run into this morning.
    isOpen = week[yesterday].some(function (interval) {
      return interval.end < interval.start && current.minutes < interval.end;
    });
  }
  return { kind: isOpen ? 'open' : 'closed' };
}
