// Page logic: reads the form, runs searches, and draws the results.

var state = {
  centre: null,          // { lat, lon } of the place being searched (kept in memory only)
  centreLabel: '',
  radius: CONFIG.defaultRadiusMetres,
  pharmacies: [],
  hitLimit: false,
  filter: 'all',         // all | 24h | open
  sort: 'nearest',       // nearest | name
  view: 'list',          // list | map
  busy: false
};

function byId(id) { return document.getElementById(id); }

// Small helper so cards are built with textContent, never innerHTML.
function makeElement(tag, className, text) {
  var node = document.createElement(tag);
  if (className) { node.className = className; }
  if (text) { node.textContent = text; }
  return node;
}

function addIcon(parent, iconName) {
  var icon = makeElement('i', 'bi bi-' + iconName + ' me-1');
  icon.setAttribute('aria-hidden', 'true');
  parent.appendChild(icon);
}

// ---------- Messages and loading ----------

function clearMessage() { byId('message-area').replaceChildren(); }

function showMessage(type, text, actionButton) {
  var alert = makeElement('div', 'alert alert-' + type + ' d-flex flex-wrap align-items-center gap-2 mb-3');
  alert.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  alert.appendChild(makeElement('span', 'flex-grow-1', text));
  if (actionButton) { alert.appendChild(actionButton); }
  byId('message-area').replaceChildren(alert);
}

function setBusy(isBusy, text) {
  state.busy = isBusy;
  byId('loading-box').classList.toggle('d-none', !isBusy);
  if (text) { byId('loading-text').textContent = text; }
  ['search-button', 'location-button', 'clear-button', 'radius-select'].forEach(function (id) {
    byId(id).disabled = isBusy;
  });
}

function makeActionButton(label, onClick) {
  var button = makeElement('button', 'btn btn-outline-dark btn-sm', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function nextRadius() {
  var options = CONFIG.radiusOptionsMetres;
  for (var i = 0; i < options.length; i++) {
    if (options[i] > state.radius) { return options[i]; }
  }
  return null;
}

function describeSearchError(error) {
  if (error.code === 'rate-limit') {
    return 'The pharmacy service is limiting requests. Please wait about ' +
      (error.retryAfterSeconds || 30) + ' seconds before searching again.';
  }
  if (error.code === 'timeout' || error.code === 'busy') {
    return "The pharmacy service is busy right now. Please try again in a few minutes.";
  }
  return "We couldn't retrieve pharmacy listings right now. Please try again later.";
}

// ---------- Searching ----------

// Fetches pharmacies for the current centre and radius, then shows them.
async function runSearch(loadingText) {
  setBusy(true, loadingText || 'Finding pharmacies near you...');
  clearMessage();
  try {
    var result = await fetchPharmacies(state.centre, state.radius);
    state.pharmacies = result.pharmacies;
    state.hitLimit = result.hitLimit;
    byId('results-section').classList.remove('d-none');
    renderResults();
  } catch (error) {
    // A failed request is not the same as "no pharmacies here", so show an error and no results.
    state.pharmacies = [];
    renderResults(true);
    showMessage('danger', describeSearchError(error));
  } finally {
    setBusy(false);
  }
}

async function handleUseLocation() {
  if (state.busy) { return; }
  setBusy(true, 'Waiting for your location...');
  clearMessage();
  var position;
  try {
    position = await getCurrentLocation();
  } catch (error) {
    setBusy(false);
    var text = "We couldn't access your location. You can search by town or neighbourhood instead.";
    if (error.code === 'denied') {
      text = "Location permission was blocked. You can allow it in your browser settings, or search by town or neighbourhood instead.";
    } else if (error.code === 'insecure') {
      text = "Location only works on a secure (HTTPS) page or on localhost. You can search by town or neighbourhood instead.";
    } else if (error.code === 'unsupported') {
      text = "This browser can't share its location. Please search by town or neighbourhood instead.";
    } else if (error.code === 'timeout') {
      text = "Finding your location took too long. Try again, or search by town or neighbourhood.";
    }
    showMessage('warning', text);
    return;
  }

  state.centre = { lat: position.lat, lon: position.lon };
  state.centreLabel = 'your current location';
  byId('location-input').value = '';
  await runSearch('Location found. Finding pharmacies near you...');
  // Only say the location was detected after results (or a clear error) came back.
}

async function handleManualSearch(event) {
  event.preventDefault();
  if (state.busy) { return; }
  var text = byId('location-input').value.trim();
  if (text.length < 2) {
    showMessage('warning', 'Please type a town or neighbourhood, or use your location.');
    return;
  }
  if (text.length > 100) { text = text.slice(0, 100); }

  setBusy(true, 'Looking up "' + text + '"...');
  clearMessage();
  try {
    var place = await geocodePlace(text);
    state.centre = { lat: place.lat, lon: place.lon };
    state.centreLabel = place.label;
  } catch (error) {
    setBusy(false);
    if (error.code === 'not-found') {
      showMessage('warning', "We couldn't find that place. Check the spelling or try a nearby town or neighbourhood.");
    } else if (error.code === 'geocoder-busy') {
      showMessage('danger', 'The place search service is busy. Please wait a minute and try again.');
    } else {
      showMessage('danger', "We couldn't look up that place right now. Please try again later.");
    }
    return;
  }
  await runSearch('Finding pharmacies near ' + text + '...');
}

function handleClear() {
  byId('location-input').value = '';
  state.centre = null;
  state.pharmacies = [];
  state.filter = 'all';
  state.sort = 'nearest';
  byId('sort-select').value = 'nearest';
  byId('filter-all').checked = true;
  clearMessage();
  byId('results-section').classList.add('d-none');
  byId('results-list').replaceChildren();
  resetMap();
  setView('list');
}

// ---------- Filtering and drawing results ----------

function getVisiblePharmacies() {
  var now = new Date();
  var items = state.pharmacies.map(function (p) {
    return { pharmacy: p, hours: getHoursStatus(p.openingHours, now) };
  });

  items = items.filter(function (item) {
    if (state.filter === '24h') { return item.hours.kind === '24h'; }
    if (state.filter === 'open') { return item.hours.kind === 'open' || item.hours.kind === '24h'; }
    return true;
  });

  if (state.sort === 'name') {
    items.sort(function (a, b) {
      if (!a.pharmacy.name && !b.pharmacy.name) { return 0; }
      if (!a.pharmacy.name) { return 1; }   // unnamed pharmacies go last
      if (!b.pharmacy.name) { return -1; }
      return a.pharmacy.name.localeCompare(b.pharmacy.name);
    });
  } else {
    var order = sortByDistance(items.map(function (item) { return item.pharmacy; }));
    items.sort(function (a, b) { return order.indexOf(a.pharmacy) - order.indexOf(b.pharmacy); });
  }
  return items;
}

function hoursLabel(kind) {
  if (kind === '24h') { return { text: 'Reported open 24 hours', css: 'text-bg-success' }; }
  if (kind === 'open') { return { text: 'Open according to listed hours', css: 'text-bg-success' }; }
  if (kind === 'closed') { return { text: 'Closed according to listed hours', css: 'text-bg-secondary' }; }
  if (kind === 'unclear') { return { text: 'Hours need confirmation', css: 'text-bg-warning' }; }
  return { text: 'Hours not available', css: 'text-bg-light border' };
}

function makeSafeWebsiteUrl(text) {
  var candidate = /^https?:\/\//i.test(text) ? text : 'https://' + text;
  try {
    var url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') { return url.href; }
  } catch (error) { /* not a usable web address */ }
  return null;
}

function buildDirectionsUrl(centre, pharmacy) {
  if (pharmacy.lat === null) { return pharmacy.osmUrl; }
  var to = pharmacy.lat + ',' + pharmacy.lon;
  if (!centre) {
    return 'https://www.openstreetmap.org/?mlat=' + pharmacy.lat + '&mlon=' + pharmacy.lon +
      '#map=18/' + to;
  }
  return 'https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=' +
    encodeURIComponent(centre.lat + ',' + centre.lon + ';' + to);
}

function makeLink(href, text, iconName, extraClass) {
  var link = makeElement('a', extraClass || '');
  link.href = href;
  if (href.indexOf('http') === 0) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  addIcon(link, iconName);
  link.appendChild(document.createTextNode(text));
  return link;
}

function makeInfoRow(iconName) {
  var row = makeElement('div', 'small mb-1');
  addIcon(row, iconName);
  return row;
}

function createCard(item) {
  var p = item.pharmacy;
  var column = makeElement('div', 'col');
  var card = makeElement('article', 'card h-100 pharmacy-card');
  card.id = 'card-' + p.id.replace('/', '-');
  var body = makeElement('div', 'card-body d-flex flex-column');

  var top = makeElement('div', 'd-flex justify-content-between align-items-start gap-2 mb-2');
  top.appendChild(makeElement('h3', 'h6 mb-0 text-navy', p.name || 'Unnamed pharmacy'));
  if (p.distanceMetres !== null) {
    top.appendChild(makeElement('span', 'badge text-bg-light border text-nowrap', formatDistance(p.distanceMetres)));
  }
  body.appendChild(top);

  if (p.operator && p.operator !== p.name) {
    body.appendChild(makeElement('div', 'small text-muted mb-1', p.operator));
  }

  var addressRow = makeInfoRow('geo-alt');
  addressRow.appendChild(document.createTextNode(p.address || 'Address not listed'));
  if (!p.address) { addressRow.classList.add('text-muted'); }
  body.appendChild(addressRow);

  var label = hoursLabel(item.hours.kind);
  var hoursRow = makeInfoRow('clock');
  hoursRow.appendChild(makeElement('span', 'badge ' + label.css, label.text));
  body.appendChild(hoursRow);
  if (p.openingHours && item.hours.kind !== '24h') {
    body.appendChild(makeElement('div', 'small text-muted mb-1 ps-4', 'Listed as: ' + p.openingHours));
  }

  var phones = p.phone ? p.phone.split(';').slice(0, 2) : [];
  var callTarget = null;
  phones.forEach(function (phone) {
    var digits = phone.replace(/[^\d+]/g, '');
    if (digits.length < 5) { return; }
    var row = makeInfoRow('telephone');
    var link = makeElement('a', '', phone.trim());
    link.href = 'tel:' + digits;
    row.appendChild(link);
    body.appendChild(row);
    if (!callTarget) { callTarget = digits; }
  });
  if (!callTarget) {
    var noPhone = makeInfoRow('telephone');
    noPhone.classList.add('text-muted');
    noPhone.appendChild(document.createTextNode('Phone not listed'));
    body.appendChild(noPhone);
  }

  var websiteUrl = p.website ? makeSafeWebsiteUrl(p.website) : null;
  if (websiteUrl) {
    var webRow = makeInfoRow('globe');
    var webLink = makeElement('a', 'text-break', p.website);
    webLink.href = websiteUrl; webLink.target = '_blank'; webLink.rel = 'noopener noreferrer';
    webRow.appendChild(webLink);
    body.appendChild(webRow);
  }
  if (p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    var mailRow = makeInfoRow('envelope');
    var mailLink = makeElement('a', 'text-break', p.email);
    mailLink.href = 'mailto:' + p.email;
    mailRow.appendChild(mailLink);
    body.appendChild(mailRow);
  }

  var actions = makeElement('div', 'd-flex flex-wrap gap-2 mt-auto pt-3');
  actions.appendChild(makeLink(buildDirectionsUrl(state.centre, p), 'Directions', 'signpost-split', 'btn btn-primary'));
  if (callTarget) {
    actions.appendChild(makeLink('tel:' + callTarget, 'Call', 'telephone', 'btn btn-outline-primary'));
  }
  if (p.lat !== null && mapIsAvailable()) {
    var mapButton = makeElement('button', 'btn btn-outline-secondary');
    mapButton.type = 'button';
    addIcon(mapButton, 'map');
    mapButton.appendChild(document.createTextNode('Show on map'));
    mapButton.addEventListener('click', function () { showOnMap(p.id); });
    actions.appendChild(mapButton);
  }
  body.appendChild(actions);

  var footer = makeElement('div', 'small text-muted pt-2');
  footer.appendChild(document.createTextNode('From OpenStreetMap, not verified. '));
  var osmLink = makeElement('a', '', 'View record');
  osmLink.href = p.osmUrl; osmLink.target = '_blank'; osmLink.rel = 'noopener noreferrer';
  footer.appendChild(osmLink);
  body.appendChild(footer);

  card.appendChild(body);
  column.appendChild(card);
  return column;
}

function renderResults(skipEmptyMessage) {
  var list = byId('results-list');
  list.replaceChildren();
  byId('radius-select').value = String(state.radius);

  var total = state.pharmacies.length;
  var items = getVisiblePharmacies();
  var radiusText = (state.radius / 1000) + ' km';

  if (total === 0) {
    byId('results-summary').textContent = '';
    byId('results-tools').classList.add('d-none');
    byId('map-wrapper').classList.add('d-none');
    if (state.centre && !skipEmptyMessage && !byId('message-area').hasChildNodes()) {
      // The search worked, there is simply nothing mapped here.
      var bigger = nextRadius();
      var button = bigger ? makeActionButton('Search within ' + (bigger / 1000) + ' km', function () {
        state.radius = bigger; runSearch();
      }) : null;
      showMessage('info', "We couldn't find any mapped pharmacies within " + radiusText +
        ' of ' + state.centreLabel + (bigger ? '. Try expanding the search radius.' : '. Try a different area.'), button);
    }
    return;
  }

  byId('results-tools').classList.remove('d-none');
  var summary = total + ' mapped pharmacies within ' + radiusText + ' of ' + state.centreLabel;
  if (total === 1) { summary = '1 mapped pharmacy within ' + radiusText + ' of ' + state.centreLabel; }
  if (items.length !== total) { summary = 'Showing ' + items.length + ' of ' + summary; }
  byId('results-summary').textContent = summary;

  if (state.hitLimit) {
    showMessage('warning', 'This area has a lot of pharmacies, so only the first ' + CONFIG.maxResults +
      ' found are shown. Try a smaller radius for a complete list.');
  } else if (!byId('message-area').hasChildNodes() && nextRadius() && total < 3) {
    showMessage('info', 'Only a few pharmacies are mapped here.',
      makeActionButton('Search within ' + (nextRadius() / 1000) + ' km', function () {
        state.radius = nextRadius(); runSearch();
      }));
  }

  if (items.length === 0) {
    var empty = makeElement('div', 'col-12');
    var filterName = state.filter === '24h' ? 'reported as open 24 hours' : 'open according to their listed hours';
    empty.appendChild(makeElement('div', 'alert alert-info mb-0',
      'None of the ' + total + ' pharmacies found are ' + filterName +
      '. Many pharmacies have no hours listed, so try "All pharmacies" and call ahead.'));
    list.appendChild(empty);
  }
  items.forEach(function (item) { list.appendChild(createCard(item)); });

  if (state.view === 'map') { refreshMap(items); }
}

// ---------- Map / list toggle ----------

function refreshMap(items) {
  updateMap(state.centre, (items || getVisiblePharmacies()).map(function (item) {
    return { pharmacy: item.pharmacy, statusText: hoursLabel(item.hours.kind).text };
  }));
}

function setView(view) {
  state.view = view;
  var showMap = view === 'map';
  byId('results-list').classList.toggle('d-none', showMap);
  byId('map-wrapper').classList.toggle('d-none', !showMap);
  byId('view-list').classList.toggle('active', !showMap);
  byId('view-map').classList.toggle('active', showMap);
  byId('view-list').setAttribute('aria-pressed', String(!showMap));
  byId('view-map').setAttribute('aria-pressed', String(showMap));
  if (showMap && state.centre) { refreshMap(); }
}

function showOnMap(pharmacyId) {
  setView('map');
  if (!focusPharmacyOnMap(pharmacyId)) {
    showMessage('warning', "The map couldn't load, but you can still use the pharmacy list.");
  }
  byId('map-wrapper').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- Start-up ----------

document.addEventListener('DOMContentLoaded', function () {
  if (!byId('search-form')) { return; }   // other pages (About) don't need any of this

  var radiusSelect = byId('radius-select');
  CONFIG.radiusOptionsMetres.forEach(function (metres) {
    var option = makeElement('option', '', (metres / 1000) + ' km');
    option.value = String(metres);
    radiusSelect.appendChild(option);
  });
  radiusSelect.value = String(state.radius);

  byId('search-form').addEventListener('submit', handleManualSearch);
  byId('location-button').addEventListener('click', handleUseLocation);
  byId('clear-button').addEventListener('click', handleClear);

  radiusSelect.addEventListener('change', function () {
    state.radius = parseInt(radiusSelect.value, 10);
    if (state.centre) { runSearch(); }
  });
  ['all', '24h', 'open'].forEach(function (name) {
    byId('filter-' + name).addEventListener('change', function () {
      state.filter = name;
      renderResults();
    });
  });
  byId('sort-select').addEventListener('change', function (event) {
    state.sort = event.target.value;
    renderResults();
  });
  byId('view-list').addEventListener('click', function () { setView('list'); });
  byId('view-map').addEventListener('click', function () { setView('map'); });

  if (!mapIsAvailable()) {
    byId('view-map').classList.add('d-none');
  }
});
