# Pharmacy Near Me

Pharmacy Near Me is a website I built to help people in Kenya find nearby pharmacies. It uses live data from OpenStreetMap to display pharmacy locations, distances, available contact details, and opening hours where provided.

The website supports searches using your current location or a town or neighbourhood name. It is built with HTML, CSS, and JavaScript, without a custom backend or database.

**Live Demo:** [Open Pharmacy Near Me](https://nester09.github.io/pharmacy-near-me/)

## Features

- **Location search:** Find pharmacies near your current location or search by town or neighbourhood.
- **Live pharmacy listings:** Retrieve pharmacy information from OpenStreetMap using the Overpass API.
- **Distance calculation:** Calculate straight-line distances using the Haversine formula and display the nearest pharmacies first.
- **Search radius:** Choose 2, 5, 10, or 20 km, with an option to expand the search when few results are available.
- **Pharmacy filters:** View all pharmacies, those reported as operating 24 hours, or those currently open according to their listed opening hours.
- **Pharmacy details:** View available addresses, opening hours, phone numbers, and website links.
- **Directions:** Open directions to a pharmacy and access its OpenStreetMap record.
- **Map and list views:** Switch between pharmacy listings and an interactive Leaflet map. The list remains available if the map fails to load.
- **Responsive design:** Use the website on desktop and mobile devices.

The website does not require user accounts, a database, or a custom backend. It does not request location access automatically when the page loads.

## Technologies Used

- HTML5
- CSS3
- Vanilla JavaScript
- Bootstrap 5.3.8
- Bootstrap Icons 1.13.2
- Leaflet 1.9.4
- Browser Geolocation API
- OpenStreetMap and the Overpass API
- Nominatim for place-name searches

Bootstrap, Bootstrap Icons, and Leaflet are stored locally in the `vendor/` directory, so the website does not depend on CDNs to load these libraries. Their respective MIT, MIT, and BSD-2-Clause licences are included in their folders.

The external APIs still require an internet connection to retrieve pharmacy information, search for places, and load map tiles.

## Project Structure

```text
pharmacy-near-me/
├── index.html
├── about.html
├── README.md
├── .gitignore
├── assets/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── config.js
│   │   ├── location.js
│   │   ├── pharmacy-search.js
│   │   ├── map.js
│   │   └── app.js
│   └── images/
└── vendor/
    ├── bootstrap/
    ├── bootstrap-icons/
    └── leaflet/
```

The JavaScript files are loaded in order in `index.html`:

1. `config.js` contains service URLs and configuration settings.
2. `location.js` handles browser geolocation and place-name searches.
3. `pharmacy-search.js` retrieves and processes pharmacy data, calculates distances, and handles opening hours.
4. `map.js` manages the interactive map.
5. `app.js` handles the interface, filters, messages, and pharmacy cards.

Each file has a specific responsibility, making the code easier to understand and maintain.

## Running the Website Locally

You can run the project using Visual Studio Code and the Live Server extension.

1. Install [Visual Studio Code](https://code.visualstudio.com/).
2. Install the Live Server extension.
3. Open the `pharmacy-near-me` project folder in Visual Studio Code.
4. Right-click `index.html` and select **Open with Live Server**.
5. The website should open in your browser at `http://127.0.0.1:5500`.

Alternatively, if Python is installed, open a terminal in the project folder and run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

Running the website through a local server is recommended because browser geolocation generally requires HTTPS or localhost. Opening `index.html` directly using `file://` may prevent some features from working correctly.

## How It Works

### 1. Location Search

The website uses the browser's Geolocation API when the user selects **Use my location**. The browser requests permission before providing the coordinates.

The location is used for the search and is kept in memory while the page is running. The website does not request location access automatically when the page loads.

Geolocation requires HTTPS or localhost in supported browsers.

### 2. Finding Pharmacies

The Overpass API retrieves OpenStreetMap elements tagged with `amenity=pharmacy` or `healthcare=pharmacy`. The query includes nodes, ways, and relations within the selected radius.

The returned data is processed to handle missing information, obtain coordinates, remove likely duplicates based on pharmacy names and proximity, and calculate distances from the searched location.

Results are displayed from nearest to farthest. Searches for the same location and radius are cached in memory to reduce unnecessary requests.

The website also handles HTTP 429 rate-limit responses by pausing further requests until the specified `Retry-After` period has passed. It does not continuously retry requests.

### 3. Searching by Town or Neighbourhood

Users can enter a place name instead of sharing their current location.

When **Search pharmacies** is selected, the website sends the place name to Nominatim, with searches restricted to Kenya. The first matching result is used as the search location.

The matched place name is displayed above the results. If no matching location is found, the website displays a message instead of searching using an invalid location.

The search is manual, with no autocomplete feature.

### 4. Opening Hours

The website interprets supported OpenStreetMap opening-hours formats, including common weekly schedules, split shifts, overnight hours, and `24/7`.

Opening times are interpreted using the `Africa/Nairobi` time zone.

When opening hours are missing or cannot be interpreted reliably, the website displays an appropriate message rather than claiming that the pharmacy is open or closed. Special schedules, such as public holidays and sunrise-based opening times, may require confirmation.

### 5. Map and Directions

Leaflet displays pharmacy locations on an interactive map. Users can switch between the map and list views and select a pharmacy to view it on the map.

Directions open through OpenStreetMap. Distances displayed by the website are straight-line distances, not actual road or travel distances.

## External Services and Data Policies

The website relies on publicly available services. Their availability, usage limits, and policies may change.

### OpenStreetMap

Pharmacy information comes from OpenStreetMap and is subject to its Open Database License (ODbL). Attribution to OpenStreetMap contributors is displayed in the website footer and on the map.

Visit the [OpenStreetMap website](https://www.openstreetmap.org/) to learn more about the project.

### Overpass API

The Overpass API is used to retrieve pharmacy data. Public instances are shared by multiple users, so requests should be kept reasonable.

See the [Overpass API documentation and public instances](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances) for more information.

An optional fallback server can be configured through `overpassFallbackUrl` in `config.js`. It is empty by default and is used only when the primary server is unavailable, not when a rate limit has been reached.

### Nominatim

Nominatim converts manually entered place names into geographic coordinates.

Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) requires responsible use. The website sends one request for each deliberate search, does not use autocomplete, and waits at least 1.1 seconds between requests.

### OpenStreetMap Map Tiles

The map uses the standard OpenStreetMap tile service, which is intended for appropriate, reasonable use.

See the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/) for details.

If the website attracts more traffic, an appropriate tile provider should be selected according to its terms and usage limits.

### API Keys and Privacy

The current implementation does not use API keys or require a private backend service.

If a future version uses a service that requires a private API key, the key should not be placed in frontend JavaScript because visitors can inspect the code. A backend or serverless function would be needed to protect it.

## Limitations

- The website can only display pharmacies that have been mapped in OpenStreetMap.
- Pharmacy details may be incomplete, inaccurate, or outdated.
- Opening hours depend on the information available and the formats the website can interpret.
- The website cannot confirm whether a pharmacy is currently staffed, has medicines in stock, or is accepting customers.
- Distances are calculated in a straight line and may differ significantly from actual travel distances.
- The public APIs and map services may be slow, temporarily unavailable, or subject to usage limits.
- Searching for a place depends on Nominatim finding a suitable match.

The results should therefore be used as a starting point for finding pharmacies. Where necessary, contact the pharmacy directly to confirm its location, opening hours, and availability.

## Testing

The following checks can be performed in a browser using localhost:

1. Select **Use my location**, allow location access, and check whether pharmacies appear in distance order.
2. Block location access and confirm that the website displays an appropriate message.
3. Search for locations such as Thika and Westlands, then try an invalid name to check the no-results message.
4. Change the search radius and confirm that the displayed results update.
5. Switch between the pharmacy filters and check that filtering does not trigger another network request.
6. Open the map view and use **Show on map** on a pharmacy card.
7. Disconnect from the internet and check how the website handles failed requests.
8. Inspect the browser's developer console for JavaScript errors.

## Future Improvements

Possible improvements include:

- More reliable opening-hours interpretation.
- Road-distance and travel-time estimates.
- A way for users to report incorrect pharmacy information.
- Swahili language support.
- A caching service or suitable backend if usage grows beyond what public APIs can reasonably support.

These are possible future improvements rather than features currently provided by the website.