const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('provider map route is provider-view protected and precedes provider id route', () => {
  const routes = source('routes/frontend.js');
  const mapRoute = 'router.get("/providers/map", ...protectedPage("providers.view"), page.providerMap);';
  const providerRoute = 'router.get("/providers/:providerId", ...protectedPage("providers.view"), page.providerShow);';

  assert.ok(routes.includes(mapRoute));
  assert.ok(routes.indexOf(mapRoute) < routes.indexOf(providerRoute));
});

test('provider map only exposes the dedicated browser Maps configuration', () => {
  const controller = source('controllers/frontendController.js');

  assert.match(controller, /GOOGLE_MAPS_BROWSER_API_KEY/);
  assert.match(controller, /GOOGLE_MAPS_MAP_ID/);
  assert.doesNotMatch(controller, /GOOGLE_MAPS_API_KEY/);
});

test('provider directory links to the internal map overview', () => {
  const view = source('views/provider/index.ejs');

  assert.match(view, /href="\/providers\/map"/);
  assert.match(view, />Provider map</);
});

test('provider map supports category, status and 1 to 100 km radius controls', () => {
  const view = source('views/provider/map.ejs');

  assert.match(view, /id="provider-map-category"/);
  assert.match(view, /x-model="filters\.categorySlug"/);
  assert.match(view, /id="provider-map-status"/);
  assert.match(view, /x-model="filters\.status"/);
  assert.match(view, /id="provider-map-radius"[\s\S]*min="1"[\s\S]*max="100"/);
  for (const radius of [5, 10, 20, 50, 100]) {
    assert.match(view, new RegExp(`setRadius\\(${radius}\\)`));
  }
  assert.match(view, /does not change provider alert settings/);
});

test('provider map loads all provider pages and uses saved coordinates', () => {
  const script = source('public/js/provider-map.js');

  assert.match(script, /PROVIDER_PAGE_SIZE\s*=\s*100/);
  assert.match(script, /body\.pagination\?\.nextCursor/);
  assert.match(script, /serviceLatitude/);
  assert.match(script, /serviceLongitude/);
  assert.match(script, /MAX_PROVIDER_PAGES\s*=\s*100/);
});

test('provider map applies click-center radius filtering with Haversine distance', () => {
  const script = source('public/js/provider-map.js');

  assert.match(script, /map\.addListener\('click'/);
  assert.match(script, /earthRadiusKm\s*=\s*6371\.0088/);
  assert.match(script, /distanceKm\(this\.selectedCenter, position\)/);
  assert.match(script, /new google\.maps\.Circle/);
  assert.match(script, /radius:\s*radiusValue\(this\.radiusKm\) \* 1000/);
});

test('provider map uses Google advanced markers and provider detail links', () => {
  const script = source('public/js/provider-map.js');

  assert.match(script, /google\.maps\.importLibrary\('marker'\)/);
  assert.match(script, /AdvancedMarkerElement/);
  assert.match(script, /gmpClickable:\s*true/);
  assert.match(script, /View provider/);
  assert.match(script, /'\/providers\/' \+ encodeURIComponent\(providerId\)/);
});
