(function () {
  'use strict';

  let map = null;
  let infoWindow = null;
  let AdvancedMarkerElement = null;
  let PinElement = null;
  let radiusCircle = null;
  let customerMarker = null;
  let providerMarkers = [];
  let lastPayload = null;

  function finiteCoordinate(value, min, max) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  function positiveRadius(value) {
    const radius = Number(value);
    return Number.isFinite(radius) && radius > 0 ? radius : 20;
  }

  function rootElement() {
    return document.querySelector('[data-nearby-coverage-root]');
  }

  function canvasElement() {
    return document.querySelector('[data-nearby-coverage-canvas]');
  }

  function messageElement() {
    return document.querySelector('[data-nearby-coverage-message]');
  }

  function countElement() {
    return document.querySelector('[data-nearby-coverage-count]');
  }

  function setMessage(message, tone) {
    const element = messageElement();
    if (!element) return;
    const text = String(message || '').trim();
    element.textContent = text;
    element.hidden = !text;
    element.className = 'alert mb-0 rounded-0 border-start-0 border-end-0 ' + (
      tone === 'warning' ? 'alert-warning' : tone === 'danger' ? 'alert-danger' : 'alert-light'
    );
  }

  function setCount(value) {
    const element = countElement();
    if (!element) return;
    const count = Number(value || 0);
    element.textContent = Number.isFinite(count)
      ? Math.max(0, Math.trunc(count)) + ' provider' + (Math.trunc(count) === 1 ? '' : 's') + ' plotted'
      : '';
  }

  function loadGoogleMaps(apiKey) {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    if (window.__findolyGoogleMapsPromise) return window.__findolyGoogleMapsPromise;

    window.__findolyGoogleMapsPromise = new Promise((resolve, reject) => {
      const callbackName = '__findolyNearbyCoverageMapReady';
      window[callbackName] = () => {
        delete window[callbackName];
        resolve();
      };

      const params = new URLSearchParams({
        key: apiKey,
        callback: callbackName,
        v: 'weekly',
        libraries: 'marker',
        loading: 'async',
      });
      const script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?' + params.toString();
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        delete window[callbackName];
        reject(new Error('Google Maps could not be loaded. Check the browser API key and allowed referrers.'));
      };
      document.head.appendChild(script);
    });

    return window.__findolyGoogleMapsPromise;
  }

  function clearMarkers() {
    if (customerMarker) {
      customerMarker.map = null;
      customerMarker = null;
    }
    providerMarkers.forEach((marker) => { marker.map = null; });
    providerMarkers = [];
    if (radiusCircle) {
      radiusCircle.setMap(null);
      radiusCircle = null;
    }
    if (infoWindow) infoWindow.close();
  }

  function makePin(glyphText, scale) {
    if (!PinElement) return null;
    const pin = new PinElement({ glyphText, scale });
    return pin.element || pin;
  }

  function appendLine(wrapper, text, strong) {
    const line = document.createElement('div');
    line.style.fontSize = '12px';
    line.style.marginTop = '3px';
    if (strong) line.style.fontWeight = '600';
    line.textContent = String(text || '');
    wrapper.appendChild(line);
  }

  function providerWhatsappLabel(provider) {
    if (provider.whatsappAlertEligible) {
      return provider.alertAlreadySent ? 'WhatsApp: previously sent' : 'WhatsApp: ready';
    }
    const labels = {
      portal_restricted: 'WhatsApp: portal restricted',
      provider_alerts_disabled: 'WhatsApp: disabled by provider',
      whatsapp_contact_missing: 'WhatsApp: number unavailable',
      subcategory_not_selected: 'WhatsApp: service not selected',
    };
    return labels[String(provider.whatsappAlertReason || '')] || 'WhatsApp: not eligible';
  }

  function openCustomerInfo(payload) {
    if (!infoWindow || !map || !customerMarker) return;
    const wrapper = document.createElement('div');
    wrapper.style.minWidth = '220px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.marginBottom = '5px';
    title.textContent = payload.lead.requirementTitle || 'Customer requirement';
    wrapper.appendChild(title);

    appendLine(wrapper, payload.lead.locationLabel || 'Customer location');
    appendLine(wrapper, positiveRadius(payload.radiusKm) + ' km saved nearby-provider radius', true);
    appendLine(wrapper, 'Distance values use Findoly\'s Haversine calculation.');

    infoWindow.setContent(wrapper);
    infoWindow.open({ map, anchor: customerMarker });
  }

  function openProviderInfo(provider, marker) {
    if (!infoWindow || !map) return;
    const wrapper = document.createElement('div');
    wrapper.style.minWidth = '230px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.marginBottom = '4px';
    title.textContent = provider.businessName || provider.name || 'Provider';
    wrapper.appendChild(title);

    if (provider.businessName && provider.name) appendLine(wrapper, provider.name);
    const distance = Number(provider.distanceKm);
    appendLine(
      wrapper,
      Number.isFinite(distance) ? distance.toFixed(1) + ' km from customer' : 'Distance unavailable',
      true,
    );
    appendLine(wrapper, provider.locationLabel || 'Service location unavailable');
    const credits = Number(provider.walletBalanceCredits || 0);
    appendLine(wrapper, (Number.isFinite(credits) ? credits.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '0') + ' credits');
    appendLine(wrapper, providerWhatsappLabel(provider));

    const providerId = String(provider.providerId || '').trim();
    if (providerId) {
      const link = document.createElement('a');
      link.href = '/providers/' + encodeURIComponent(providerId);
      link.textContent = 'View provider';
      link.style.display = 'inline-block';
      link.style.marginTop = '8px';
      link.style.fontWeight = '600';
      wrapper.appendChild(link);
    }

    infoWindow.setContent(wrapper);
    infoWindow.open({ map, anchor: marker });
  }

  function markerPosition(provider) {
    const lat = finiteCoordinate(provider?.latitude, -90, 90);
    const lng = finiteCoordinate(provider?.longitude, -180, 180);
    return lat === null || lng === null ? null : { lat, lng };
  }

  function customerPosition(lead) {
    const lat = finiteCoordinate(lead?.latitude, -90, 90);
    const lng = finiteCoordinate(lead?.longitude, -180, 180);
    return lat === null || lng === null ? null : { lat, lng };
  }

  function fitMap(customer, radiusKm, providerPositions) {
    if (!map || !window.google?.maps) return;
    if (radiusCircle && typeof radiusCircle.getBounds === 'function') {
      const circleBounds = radiusCircle.getBounds();
      if (circleBounds) {
        map.fitBounds(circleBounds, 40);
        return;
      }
    }
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(customer);
    providerPositions.forEach((position) => bounds.extend(position));
    map.fitBounds(bounds, 40);
    if (!providerPositions.length) map.setZoom(radiusKm <= 5 ? 13 : radiusKm <= 20 ? 11 : 9);
  }

  async function initializeMap() {
    const root = rootElement();
    const canvas = canvasElement();
    if (!root || !canvas) return false;
    if (map) return true;

    const apiKey = String(root.dataset.googleMapsBrowserApiKey || '').trim();
    const mapId = String(root.dataset.googleMapsMapId || '').trim();
    if (!apiKey || !mapId) {
      setMessage('Google Maps is not configured for this CRM environment. The provider table remains fully available.', 'warning');
      canvas.hidden = true;
      return false;
    }

    setMessage('Loading customer and nearby provider locations…');
    try {
      await loadGoogleMaps(apiKey);
      const mapsLibrary = await google.maps.importLibrary('maps');
      const markerLibrary = await google.maps.importLibrary('marker');
      AdvancedMarkerElement = markerLibrary.AdvancedMarkerElement;
      PinElement = markerLibrary.PinElement;
      infoWindow = new mapsLibrary.InfoWindow();
      map = new mapsLibrary.Map(canvas, {
        center: { lat: 20.5937, lng: 78.9629 },
        zoom: 5,
        mapId,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: true,
      });
      canvas.hidden = false;
      setMessage('');
      return true;
    } catch (error) {
      canvas.hidden = true;
      setMessage(error.message || 'Google Maps could not be initialized.', 'warning');
      return false;
    }
  }

  async function renderPayload(payload) {
    lastPayload = payload;
    const lead = payload?.lead || {};
    const providers = Array.isArray(payload?.providers) ? payload.providers : [];
    const customer = customerPosition(lead);
    setCount(providers.length);

    if (!customer) {
      clearMarkers();
      const canvas = canvasElement();
      if (canvas) canvas.hidden = true;
      setMessage('Customer location is unavailable, so the nearby providers cannot be plotted on the map.', 'warning');
      return;
    }

    const ready = await initializeMap();
    if (!ready || !map || !AdvancedMarkerElement) return;
    clearMarkers();

    const radiusKm = positiveRadius(payload.radiusKm || lead.alertDistanceKm);
    const customerContent = makePin('C', 1.2);
    customerMarker = new AdvancedMarkerElement({
      map,
      position: customer,
      title: 'Customer location',
      gmpClickable: true,
      zIndex: 10000,
      ...(customerContent ? { content: customerContent } : {}),
    });
    const openCustomer = () => openCustomerInfo({ lead, radiusKm });
    if (typeof customerMarker.addEventListener === 'function') customerMarker.addEventListener('gmp-click', openCustomer);
    else if (typeof customerMarker.addListener === 'function') customerMarker.addListener('click', openCustomer);

    radiusCircle = new google.maps.Circle({
      map,
      center: customer,
      radius: radiusKm * 1000,
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillOpacity: 0.08,
      clickable: false,
    });

    const positions = [];
    providers.forEach((provider) => {
      const position = markerPosition(provider);
      if (!position) return;
      positions.push(position);
      const providerContent = makePin('P', 1);
      const marker = new AdvancedMarkerElement({
        map,
        position,
        title: provider.businessName || provider.name || 'Provider',
        gmpClickable: true,
        ...(providerContent ? { content: providerContent } : {}),
      });
      const openProvider = () => openProviderInfo(provider, marker);
      if (typeof marker.addEventListener === 'function') marker.addEventListener('gmp-click', openProvider);
      else if (typeof marker.addListener === 'function') marker.addListener('click', openProvider);
      providerMarkers.push(marker);
    });

    setCount(providerMarkers.length);
    setMessage('');
    fitMap(customer, radiusKm, positions);
  }

  window.addEventListener('nearby-providers:loaded', (event) => {
    renderPayload(event.detail || {}).catch((error) => {
      setMessage(error.message || 'The location map could not be updated.', 'warning');
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    const initial = window.__findolyNearbyProviderMapData;
    if (initial) {
      renderPayload(initial).catch((error) => {
        setMessage(error.message || 'The location map could not be updated.', 'warning');
      });
    }
  }, { once: true });
})();
