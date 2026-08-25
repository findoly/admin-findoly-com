const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

function loadWithStubs(relativePath, stubs = {}) {
  const absolute = require.resolve(path.join(__dirname, "..", relativePath));
  delete require.cache[absolute];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(absolute);
  } finally {
    Module._load = originalLoad;
  }
}

function fakeGoogleResponse(status, body, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() { return body; },
  };
}

function googleOkBody(overrides = {}) {
  return {
    status: "OK",
    results: [{
      address_components: [
        { long_name: "400095", short_name: "400095", types: ["postal_code"] },
        { long_name: "Mumbai", short_name: "Mumbai", types: ["locality", "political"] },
        { long_name: "Konkan Division", short_name: "Konkan Division", types: ["administrative_area_level_2", "political"] },
        { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1", "political"] },
        { long_name: "India", short_name: "IN", types: ["country", "political"] },
      ],
      formatted_address: "Mumbai, Maharashtra 400095, India",
      postcode_localities: ["Gorai", "Madh", "gorai", "", "Malad West"],
      geometry: { location: { lat: 19.1888023, lng: 72.8197043 } },
      ...overrides,
    }],
  };
}

async function withGoogleEnvironment(work) {
  const previousFetch = global.fetch;
  const previousKey = process.env.GOOGLE_MAPS_API_KEY;
  try {
    process.env.GOOGLE_MAPS_API_KEY = "AIzaUltraDeepTestKey_12345678901234567890";
    await work();
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previousKey;
  }
}

test("geocoder parses rich Google metadata, deduplicates localities and tolerates cache-write failure", async () => {
  await withGoogleEnvironment(async () => {
    let cacheWriteAttempted = false;
    const PincodeLocation = {
      findOne() { return { lean: async () => null }; },
      async updateOne() {
        cacheWriteAttempted = true;
        throw new Error("cache temporarily unavailable");
      },
    };
    const geocoder = loadWithStubs("services/location/geocoding-service.js", {
      "../../models/PincodeLocation": PincodeLocation,
    });
    global.fetch = async () => fakeGoogleResponse(200, googleOkBody(), "OK");

    const previousWarn = console.warn;
    console.warn = () => {};
    try {
      const location = await geocoder.geocodePincode("400095");
      assert.equal(location.city, "Mumbai");
      assert.equal(location.state, "Maharashtra");
      assert.equal(location.formattedAddress, "Mumbai, Maharashtra 400095, India");
      assert.deepEqual(location.postcodeLocalities, ["Gorai", "Madh", "Malad West"]);
      assert.equal(location.latitude, 19.1888023);
      assert.equal(location.longitude, 72.8197043);
      assert.equal(cacheWriteAttempted, true);
    } finally {
      console.warn = previousWarn;
    }
  });
});

test("geocoder exposes Google denial diagnostics without leaking the API key", async () => {
  await withGoogleEnvironment(async () => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const PincodeLocation = {
      findOne() { return { lean: async () => null }; },
      async updateOne() { return { matchedCount: 1 }; },
    };
    const geocoder = loadWithStubs("services/location/geocoding-service.js", {
      "../../models/PincodeLocation": PincodeLocation,
    });
    global.fetch = async () => fakeGoogleResponse(403, {
      status: "REQUEST_DENIED",
      error_message: `The provided API key ${key} is not authorised for this request`,
    }, "Forbidden");

    const warnings = [];
    const previousWarn = console.warn;
    console.warn = (value) => warnings.push(value);
    try {
      await assert.rejects(
        geocoder.geocodePincode("400095"),
        (error) => error.status === 503 && error.code === "GEOCODING_UNAVAILABLE",
      );
    } finally {
      console.warn = previousWarn;
    }

    const serialized = JSON.stringify(warnings);
    assert.match(serialized, /REQUEST_DENIED/);
    assert.match(serialized, /"httpStatus":403/);
    assert.doesNotMatch(serialized, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(serialized, /redacted-google-api-key/);
  });
});

test("geocoder uses valid legacy cache when Google is unavailable", async () => {
  await withGoogleEnvironment(async () => {
    const cached = {
      pincode: "400095",
      latitude: 19.1888,
      longitude: 72.8197,
      city: "Mumbai",
      state: "Maharashtra",
      country: "India",
      enrichmentVersion: 0,
    };
    const PincodeLocation = {
      findOne() { return { lean: async () => cached }; },
      async updateOne() { return { matchedCount: 1 }; },
    };
    const geocoder = loadWithStubs("services/location/geocoding-service.js", {
      "../../models/PincodeLocation": PincodeLocation,
    });
    global.fetch = async () => { throw new Error("network down"); };

    const previousWarn = console.warn;
    console.warn = () => {};
    try {
      const location = await geocoder.geocodePincode("400095");
      assert.equal(location.latitude, 19.1888);
      assert.equal(location.longitude, 72.8197);
      assert.equal(location.city, "Mumbai");
      assert.deepEqual(location.postcodeLocalities, []);
    } finally {
      console.warn = previousWarn;
    }
  });
});

test("ZERO_RESULTS remains non-blocking-classified for provider save fallbacks", async () => {
  await withGoogleEnvironment(async () => {
    const PincodeLocation = {
      findOne() { return { lean: async () => null }; },
      async updateOne() { return { matchedCount: 1 }; },
    };
    const geocoder = loadWithStubs("services/location/geocoding-service.js", {
      "../../models/PincodeLocation": PincodeLocation,
    });
    global.fetch = async () => fakeGoogleResponse(200, { status: "ZERO_RESULTS", results: [] }, "OK");

    const previousWarn = console.warn;
    console.warn = () => {};
    try {
      await assert.rejects(
        geocoder.geocodePincode("400095"),
        (error) => error.status === 503 && error.code === "PINCODE_NOT_FOUND",
      );
    } finally {
      console.warn = previousWarn;
    }
  });
});

test("provider enrichment fills blank create address/areas but preserves deliberate changed-PIN edits", async () => {
  const writes = [];
  const Provider = {
    async updateOne(_query, update) {
      writes.push(update.$set);
      return { matchedCount: 1 };
    },
  };
  const googleLocation = {
    latitude: 19.1888023,
    longitude: 72.8197043,
    city: "Mumbai",
    state: "Maharashtra",
    locality: "Mumbai",
    district: "Konkan Division",
    country: "India",
    formattedAddress: "Mumbai, Maharashtra 400095, India",
    postcodeLocalities: ["Gorai", "Madh", "Malad West"],
    source: "google_geocoding",
    verifiedAt: new Date("2026-08-26T00:00:00.000Z"),
  };
  let geocodeCalls = 0;
  const enrichment = loadWithStubs("services/provider/provider-location-enrichment-service.js", {
    "../../models/Provider": Provider,
    "../location/geocoding-service": {
      geocodePincode: async () => { geocodeCalls += 1; return googleLocation; },
    },
  });

  const created = await enrichment.enrichProviderLocation({
    providerId: "provider-create-1",
    city: "Mumbai",
    state: "Maharashtra",
    servicePincode: "400095",
    serviceAddress: "",
    serviceAreas: [],
    serviceLatitude: 19.1888023,
    serviceLongitude: 72.8197043,
    serviceLocationSource: "google_geocoding",
  }, {
    pincodeChanged: true,
    submittedProvider: {
      city: "Mumbai",
      state: "Maharashtra",
      serviceAddress: "",
      serviceAreas: [],
    },
  });
  assert.equal(created.serviceAddress, "Mumbai, Maharashtra 400095, India");
  assert.deepEqual(created.serviceAreas, ["Gorai", "Madh", "Malad West"]);

  const edited = await enrichment.enrichProviderLocation({
    providerId: "provider-edit-1",
    city: "My Service City",
    state: "My State",
    servicePincode: "400095",
    serviceAddress: "Customer-facing landmark address",
    serviceAreas: ["Custom Area"],
    serviceLatitude: 19.1888023,
    serviceLongitude: 72.8197043,
    serviceLocationSource: "google_geocoding",
  }, {
    pincodeChanged: true,
    previousProvider: {
      providerId: "provider-edit-1",
      city: "Old City",
      state: "Old State",
      servicePincode: "400022",
      serviceAddress: "Old address",
      serviceAreas: ["Old Area"],
    },
    submittedProvider: {
      city: "My Service City",
      state: "My State",
      serviceAddress: "Customer-facing landmark address",
      serviceAreas: ["Custom Area"],
    },
  });
  assert.equal(edited.city, "My Service City");
  assert.equal(edited.state, "My State");
  assert.equal(edited.serviceAddress, "Customer-facing landmark address");
  assert.deepEqual(edited.serviceAreas, ["Custom Area"]);
  assert.equal(geocodeCalls, 2);
  assert.ok(writes.length >= 2);
});

test("provider enrichment does not repeat Google after lower-level changed-PIN fallback", async () => {
  let geocodeCalls = 0;
  let saved = null;
  const enrichment = loadWithStubs("services/provider/provider-location-enrichment-service.js", {
    "../../models/Provider": {
      async updateOne(_query, update) {
        saved = update.$set;
        return { matchedCount: 1 };
      },
    },
    "../location/geocoding-service": {
      geocodePincode: async () => { geocodeCalls += 1; throw new Error("must not be called"); },
    },
  });

  const result = await enrichment.enrichProviderLocation({
    providerId: "provider-manual-1",
    city: "Mumbai",
    state: "Maharashtra",
    servicePincode: "400095",
    serviceLatitude: null,
    serviceLongitude: null,
    serviceLocality: "Old locality",
    serviceDistrict: "Old district",
    serviceLocationSource: "manual_pincode",
  }, { pincodeChanged: true });

  assert.equal(geocodeCalls, 0);
  assert.equal(result.serviceLocationSource, "manual_pincode");
  assert.equal(result.serviceLocality, "");
  assert.equal(result.serviceDistrict, "");
  assert.equal(saved.serviceLatitude, null);
  assert.equal(saved.serviceLongitude, null);
});

test("requirement sync preserves deliberate edits and coordinate-only self-repair does not mutate descriptive fields", async () => {
  const writes = [];
  const Enquiry = {
    async updateOne(_query, update) {
      writes.push(update.$set);
      return { matchedCount: 1 };
    },
  };
  const googleLocation = {
    latitude: 19.1888023,
    longitude: 72.8197043,
    city: "Mumbai",
    state: "Maharashtra",
    locality: "Mumbai",
    district: "Konkan Division",
    country: "India",
    formattedAddress: "Mumbai, Maharashtra 400095, India",
    source: "google_geocoding",
    verifiedAt: new Date("2026-08-26T00:00:00.000Z"),
  };
  const sync = loadWithStubs("services/location/enquiry-location-service.js", {
    "../../models/Enquiry": Enquiry,
    "./geocoding-service": { geocodePincode: async () => googleLocation },
  });

  const result = await sync.syncLeadLocation({
    enquiryId: "requirement-1",
    pincode: "400095",
    city: "Customer City Label",
    state: "Customer State Label",
    addressLine: "Near custom landmark",
    locationPincode: "400022",
    locationLatitude: 19.04,
    locationLongitude: 72.86,
    locationSource: "google_geocoding",
  }, {
    previousLead: {
      enquiryId: "requirement-1",
      pincode: "400022",
      city: "Old City",
      state: "Old State",
      addressLine: "Old address",
    },
  });
  assert.equal(result.city, "Customer City Label");
  assert.equal(result.state, "Customer State Label");
  assert.equal(result.addressLine, "Near custom landmark");
  assert.equal(result.locationPincode, "400095");

  await sync.syncLeadLocation({
    enquiryId: "requirement-2",
    pincode: "400095",
    city: "Do not change",
    state: "Do not change",
    addressLine: "Do not change",
    locationPincode: "400095",
    locationLatitude: null,
    locationLongitude: null,
    locationSource: "manual_pincode",
  }, { fillMissingDescriptive: false });
  const coordinateOnlyWrite = writes[writes.length - 1];
  assert.equal(Object.prototype.hasOwnProperty.call(coordinateOnlyWrite, "city"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(coordinateOnlyWrite, "state"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(coordinateOnlyWrite, "addressLine"), false);
  assert.equal(coordinateOnlyWrite.locationPincode, "400095");
});

test("manual provider coordinates are rejected by both proximity matching helpers", () => {
  const nearby = loadWithStubs("services/enquiry/nearby-provider-service.js", {
    "../../models/Enquiry": {},
    "../../models/Provider": {},
    "../communication/nearby-lead-alert-service": { distanceKmExact: () => 1 },
    "../location/enquiry-location-service": {},
    "../../utils/validation": {
      identifierValue: (value) => value,
      numberValue: (value, options) => value ?? options.fallback,
    },
  });
  const alerts = loadWithStubs("services/communication/nearby-lead-alert-service.js", {
    "../../models/Provider": {},
    "./notification-service": {},
  });

  const manual = {
    serviceLatitude: 19.18,
    serviceLongitude: 72.81,
    serviceLocationSource: "manual_pincode",
  };
  const verified = {
    serviceLatitude: 19.18,
    serviceLongitude: 72.81,
    serviceLocationSource: "google_geocoding",
  };
  assert.equal(nearby.providerHasVerifiedCoordinates(manual), false);
  assert.equal(nearby.providerHasVerifiedCoordinates(verified), true);
  assert.equal(alerts.hasVerifiedProviderCoordinates(manual), false);
  assert.equal(alerts.hasVerifiedProviderCoordinates(verified), true);
});

test("approval verification preparation is persisted before side effects and rollback is status/timestamp guarded", async () => {
  const calls = [];
  const verification = loadWithStubs("services/enquiry/customer-verification-service.js", {
    "../../models/Enquiry": {
      async updateOne(query, update) {
        calls.push({ query, update });
        return { matchedCount: 1 };
      },
    },
  });

  const preparation = await verification.prepareApprovalCustomerMobileVerification({
    enquiryId: "requirement-approval-1",
    status: "verification",
    customerMobileVerified: false,
    customerMobileVerifiedAt: null,
  });
  assert.equal(preparation.changed, true);
  assert.equal(calls[0].update.$set.customerMobileVerified, true);
  assert.ok(calls[0].update.$set.customerMobileVerifiedAt instanceof Date);

  await verification.rollbackPreparedApprovalCustomerMobileVerification(preparation);
  const rollback = calls[1];
  const serializedQuery = JSON.stringify(rollback.query);
  assert.match(serializedQuery, /"status":\{"\$ne":"approved"\}/);
  assert.equal(rollback.update.$set.customerMobileVerified, false);
  assert.equal(rollback.update.$set.customerMobileVerifiedAt, null);
});
