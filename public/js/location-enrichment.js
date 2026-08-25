(function locationEnrichmentRuntime() {
  "use strict";

  const PINCODE_PATTERN = /^[1-9]\d{5}$/;
  const PINCODE_API_PATTERN = /^\/api\/location\/pincode\/([1-9]\d{5})(?:[?#].*)?$/;

  function modelInput(model) {
    return document.querySelector(`[x-model="${model}"]`);
  }

  function cleanText(value, maxLength = 500) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function cleanLocalities(value) {
    if (!Array.isArray(value)) return [];
    const output = [];
    const seen = new Set();
    for (const item of value) {
      const text = cleanText(item, 120);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(text);
      if (output.length >= 100) break;
    }
    return output;
  }

  function setModelValue(input, value, { onlyIfEmpty = false } = {}) {
    if (!input) return false;
    const nextValue = cleanText(value, Number(input.maxLength) > 0 ? Number(input.maxLength) : 5000);
    if (!nextValue) return false;
    if (onlyIfEmpty && cleanText(input.value, 5000)) return false;
    if (String(input.value || "") === nextValue) return false;
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  function currentContext() {
    const path = String(window.location.pathname || "");
    if (path === "/providers/new" || /^\/providers\/[^/]+\/edit$/.test(path)) {
      return {
        type: "provider",
        isCreate: path === "/providers/new",
        pincodeInput: modelInput("form.servicePincode"),
      };
    }
    if (
      path === "/enquiries/new"
      || path === "/requirements/new"
      || /^\/(?:enquiries|requirements)\/[^/]+\/edit$/.test(path)
    ) {
      return {
        type: "requirement",
        isCreate: path.endsWith("/new"),
        pincodeInput: modelInput("form.pincode"),
      };
    }
    return null;
  }

  function rememberOriginalPincode(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const model = String(input.getAttribute("x-model") || "");
    if (!["form.servicePincode", "form.pincode"].includes(model)) return;
    if (Object.prototype.hasOwnProperty.call(input.dataset, "crmOriginalPincode")) return;
    input.dataset.crmOriginalPincode = cleanText(input.value, 6);
  }

  function applyProviderLocation(location, context) {
    const city = modelInput("form.city");
    const state = modelInput("form.state");
    const address = modelInput("form.serviceAddress");
    const areas = modelInput("areaText");
    const currentPincode = cleanText(context.pincodeInput?.value, 6);
    const originalPincode = cleanText(context.pincodeInput?.dataset.crmOriginalPincode, 6);
    const pincodeChanged = context.isCreate || (originalPincode && originalPincode !== currentPincode);

    setModelValue(city, location?.city || location?.locality || location?.district, { onlyIfEmpty: !pincodeChanged });
    setModelValue(state, location?.state, { onlyIfEmpty: !pincodeChanged });

    if (pincodeChanged || !cleanText(address?.value, 500)) {
      setModelValue(address, location?.formattedAddress);
    }

    const postcodeLocalities = cleanLocalities(location?.postcodeLocalities);
    if (postcodeLocalities.length && (pincodeChanged || !cleanText(areas?.value, 5000))) {
      setModelValue(areas, postcodeLocalities.join(", "));
    }

    if (context.pincodeInput && PINCODE_PATTERN.test(currentPincode)) {
      context.pincodeInput.dataset.crmOriginalPincode = currentPincode;
    }
    return pincodeChanged;
  }

  function applyRequirementLocation(location, context) {
    const city = modelInput("form.city");
    const state = modelInput("form.state");
    const address = modelInput("form.addressLine");
    const currentPincode = cleanText(context.pincodeInput?.value, 6);
    const originalPincode = cleanText(context.pincodeInput?.dataset.crmOriginalPincode, 6);
    const pincodeChanged = context.isCreate || (originalPincode && originalPincode !== currentPincode);

    setModelValue(city, location?.city || location?.locality || location?.district, { onlyIfEmpty: !pincodeChanged });
    setModelValue(state, location?.state, { onlyIfEmpty: !pincodeChanged });
    if (pincodeChanged || !cleanText(address?.value, 500)) {
      setModelValue(address, location?.formattedAddress);
    }

    if (context.pincodeInput && PINCODE_PATTERN.test(currentPincode)) {
      context.pincodeInput.dataset.crmOriginalPincode = currentPincode;
    }
    return pincodeChanged;
  }

  function applyLocation(location, requestedPincode) {
    try {
      const context = currentContext();
      if (!context?.pincodeInput || !location || typeof location !== "object") return null;
      const currentPincode = cleanText(context.pincodeInput.value, 6);
      if (!PINCODE_PATTERN.test(currentPincode) || currentPincode !== requestedPincode) return null;
      const pincodeChanged = context.type === "provider"
        ? applyProviderLocation(location, context)
        : context.type === "requirement"
          ? applyRequirementLocation(location, context)
          : false;
      return { context, pincodeChanged: Boolean(pincodeChanged) };
    } catch (_error) {
      // Location enrichment is optional and must never block CRM form usage.
      return null;
    }
  }

  function installApiFetchObserver() {
    const originalApiFetch = window.apiFetch;
    if (typeof originalApiFetch !== "function" || originalApiFetch.__crmLocationEnrichmentWrapped) return;

    async function observedApiFetch(url, options) {
      const body = await originalApiFetch(url, options);
      try {
        const match = String(url || "").match(PINCODE_API_PATTERN);
        if (match) {
          const applied = applyLocation(body?.data, match[1]);
          if (applied && !applied.pincodeChanged && body?.data && typeof body.data === "object") {
            // The legacy form lookup assigns city/state again after apiFetch resolves.
            // Return empty suggestions on an unchanged PIN so those assignments preserve
            // manually customized values that the runtime intentionally left untouched.
            return {
              ...body,
              data: {
                ...body.data,
                city: "",
                state: "",
              },
            };
          }
        }
      } catch (_error) {
        // Optional UI enrichment must not alter the API call result.
      }
      return body;
    }
    observedApiFetch.__crmLocationEnrichmentWrapped = true;
    window.apiFetch = observedApiFetch;
  }

  document.addEventListener("focusin", rememberOriginalPincode);
  installApiFetchObserver();
})();
