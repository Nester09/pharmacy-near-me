// The Leaflet map. If Leaflet or the map tiles fail, the list keeps working.

var mapState = { map: null, layer: null, markers: {}, tileErrors: 0 };

function mapIsAvailable() {
  return typeof L !== 'undefined';
}

function showMapMessage(text) {
  var box = document.getElementById('map-message');
  box.textContent = text;
  box.classList.toggle('d-none', text === '');
}

function ensureMap() {
  if (mapState.map || !mapIsAvailable()) { return; }
  L.Icon.Default.imagePath = 'vendor/leaflet/images/';
  mapState.map = L.map('map').setView(CONFIG.fallbackMapCentre, 12);

  var tiles = L.tileLayer(CONFIG.tileUrl, { maxZoom: 19, attribution: CONFIG.tileAttribution });
  tiles.on('tileerror', function () {
    mapState.tileErrors++;
    if (mapState.tileErrors === 3) {
      showMapMessage("The map couldn't load, but you can still use the pharmacy list.");
    }
  });
  tiles.on('tileload', function () {
    if (mapState.tileErrors >= 3) { showMapMessage(''); }
    mapState.tileErrors = 0;
  });
  tiles.addTo(mapState.map);
  mapState.layer = L.layerGroup().addTo(mapState.map);
}

function buildPopup(pharmacy, centre, statusText) {
  var box = document.createElement('div');
  var title = document.createElement('strong');
  title.textContent = pharmacy.name || 'Unnamed pharmacy';
  box.appendChild(title);

  [formatDistance(pharmacy.distanceMetres) && formatDistance(pharmacy.distanceMetres) + ' away (straight line)',
    pharmacy.address, statusText, pharmacy.phone].forEach(function (line) {
    if (!line) { return; }
    var row = document.createElement('div');
    row.textContent = line;
    box.appendChild(row);
  });

  var link = document.createElement('a');
  link.href = buildDirectionsUrl(centre, pharmacy);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Directions';
  box.appendChild(link);
  return box;
}

// pharmacies: [{ pharmacy, statusText }]. Pharmacies without coordinates get no marker.
function updateMap(centre, items) {
  ensureMap();
  if (!mapState.map) { return; }
  mapState.layer.clearLayers();
  mapState.markers = {};

  var points = [];
  if (centre) {
    L.circleMarker([centre.lat, centre.lon], { radius: 8, color: '#12294a', fillColor: '#12294a', fillOpacity: 0.8 })
      .bindTooltip('Search centre').addTo(mapState.layer);
    points.push([centre.lat, centre.lon]);
  }
  items.forEach(function (item) {
    var p = item.pharmacy;
    if (p.lat === null) { return; }
    var marker = L.marker([p.lat, p.lon], { title: p.name || 'Unnamed pharmacy' })
      .bindPopup(buildPopup(p, centre, item.statusText))
      .addTo(mapState.layer);
    mapState.markers[p.id] = marker;
    points.push([p.lat, p.lon]);
  });

  mapState.map.invalidateSize();
  if (points.length > 1) {
    mapState.map.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
  } else if (points.length === 1) {
    mapState.map.setView(points[0], 15);
  }
}

function focusPharmacyOnMap(pharmacyId) {
  var marker = mapState.markers[pharmacyId];
  if (!mapState.map || !marker) { return false; }
  mapState.map.setView(marker.getLatLng(), Math.max(mapState.map.getZoom(), 16));
  marker.openPopup();
  return true;
}

function resetMap() {
  if (mapState.layer) { mapState.layer.clearLayers(); }
  mapState.markers = {};
}
