(function () {
  'use strict';

  const PROVIDER_PAGE_SIZE = 100;
  const MAX_PROVIDER_PAGES = 100;
  const DEFAULT_RADIUS_KM = 20;
  const MIN_RADIUS_KM = 1;
  const MAX_RADIUS_KM = 100;
  const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

  function finiteCoordinate(value, min, max) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  function providerPosition(provider) {
    const lat = finiteCoordinate(provider?.serviceLatitude, -90, 90);
    const lng = finiteCoordinate(provider?.serviceLongitude, -180, 180);
    return lat === null || lng === null ? null : { lat, lng };
  }

  function radiusValue(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return DEFAULT_RADIUS_KM;
    return Math.min(Math.max(number, MIN_RADIUS_KM), MAX_RADIUS_KM);
  }

  function radians(value) {
    return (value * Math.PI) / 180;
  }

  function distanceKm(from, to) {
    if (!from || !to) return null;
    const earthRadiusKm = 6371.0088;
    const latDelta = radians(to.lat - from.lat);
    const lngDelta = radians(to.lng - from.lng);
    const fromLat = radians(from.lat);
    const toLat = radians(to.lat);
    const haversine = (
      Math.sin(latDelta / 2) ** 2
      + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lngDelta / 2) ** 2
    );
    return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
  }

  function humanize(value) {
    return String(value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .trim();
  }

  function loadGoogleMaps(apiKey) {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    if (window.__findolyGoogleMapsPromise) return window.__findolyGoogleMapsPromise;

    window.__findolyGoogleMapsPromise = new Promise((resolve, reject) => {
      const callbackName = '__findolyProviderMapReady';
      window[callbackName] = () => {
        delete window[callbackName];
        resolve();
      };

      const script = document.createElement('script');
      const params = new URLSearchParams({
        key: apiKey,
        callback: callbackName,
        v: 'weekly',
        libraries: 'marker',
        loading: 'async',
      });
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

  function providerMap() {
    let map = null;
    let infoWindow = null;
    let AdvancedMarkerElement = null;
    let PinElement = null;
    let providerMarkers = [];
    let centerMarker = null;
    let radiusCircle = null;

    return {
      providers: [],
      categories: [],
      filters: { categorySlug: '', status: '' },
      radiusKm: DEFAULT_RADIUS_KM,
      selectedCenter: null,
      totalFiltered: 0,
      providersOnMap: 0,
      missingLocationCount: 0,
      loading: false,
      mapLoading: false,
      mapReady: false,
      error: '',
      configError: '',
      truncated: false,

      async init() {
        this.radiusKm = DEFAULT_RADIUS_KM;
        await Promise.all([
          this.loadProviders(),
          this.initializeMap(),
        ]);
        if (this.mapReady) this.rebuildProviderMarkers(true);
      },

      async initializeMap() {
        const root = document.querySelector('[data-provider-map-root]');
        const apiKey = String(root?.dataset.googleMapsBrowserApiKey || '').trim();
        const mapId = String(root?.dataset.googleMapsMapId || '').trim();
        if (!apiKey || !mapId) {
          this.configError = 'Provider map is not configured. Set GOOGLE_MAPS_BROWSER_API_KEY and GOOGLE_MAPS_MAP_ID for this CRM environment.';
          return;
        }

        this.mapLoading = true;
        try {
          await loadGoogleMaps(apiKey);
          const mapsLibrary = await google.maps.importLibrary('maps');
          const markerLibrary = await google.maps.importLibrary('marker');
          AdvancedMarkerElement = markerLibrary.AdvancedMarkerElement;
          PinElement = markerLibrary.PinElement;
          infoWindow = new mapsLibrary.InfoWindow();
          map = new mapsLibrary.Map(this.$refs.mapCanvas, {
            center: INDIA_CENTER,
            zoom: 5,
            mapId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          map.addListener('click', (event) => {
            if (!event?.latLng) return;
            this.selectCenter({
              lat: event.latLng.lat(),
              lng: event.latLng.lng(),
            });
          });
          this.mapReady = true;
        } catch (error) {
          this.configError = error.message || 'Google Maps could not be initialized.';
        } finally {
          this.mapLoading = false;
        }
      },

      async loadProviders() {
        this.loading = true;
        this.error = '';
        this.truncated = false;
        try {
          const providers = [];
          let cursor = '';
          let pages = 0;
          do {
            const query = new URLSearchParams({ limit: String(PROVIDER_PAGE_SIZE) });
            if (cursor) query.set('cursor', cursor);
            const body = await apiFetch('/api/provider?' + query.toString());
            providers.push(...(Array.isArray(body.data) ? body.data : []));
            cursor = String(body.pagination?.nextCursor || '');
            pages += 1;
            if (cursor && pages >= MAX_PROVIDER_PAGES) {
              this.truncated = true;
              break;
            }
          } while (cursor);

          this.providers = providers;
          this.categories = [...new Set(
            providers.flatMap((provider) => Array.isArray(provider.categorySlugs) ? provider.categorySlugs : []),
          )]
            .filter(Boolean)
            .sort((left, right) => humanize(left).localeCompare(humanize(right)));
          this.refreshSummary();
        } catch (error) {
          this.error = error.message;
        } finally {
          this.loading = false;
        }
      },

      providerMatchesFilters(provider) {
        if (this.filters.status && provider.status !== this.filters.status) return false;
        if (
          this.filters.categorySlug
          && !(Array.isArray(provider.categorySlugs) && provider.categorySlugs.includes(this.filters.categorySlug))
        ) return false;
        return true;
      },

      refreshSummary() {
        const filtered = this.providers.filter((provider) => this.providerMatchesFilters(provider));
        this.totalFiltered = filtered.length;
        this.missingLocationCount = filtered.filter((provider) => !providerPosition(provider)).length;
      },

      applyDirectoryFilters() {
        this.refreshSummary();
        if (this.mapReady) this.applyMarkerVisibility(true);
      },

      clearDirectoryFilters() {
        this.filters = { categorySlug: '', status: '' };
        this.applyDirectoryFilters();
      },

      setRadius(value) {
        this.radiusKm = radiusValue(value);
        if (this.selectedCenter && this.mapReady) {
          this.updateRadiusCircle();
          this.applyMarkerVisibility(false);
          this.fitRadius();
        }
      },

      normalizeRadius() {
        this.setRadius(this.radiusKm);
      },

      selectCenter(center) {
        if (!map || !AdvancedMarkerElement || !center) return;
        this.selectedCenter = {
          lat: Number(center.lat),
          lng: Number(center.lng),
        };

        if (centerMarker) centerMarker.map = null;
        let content;
        if (PinElement) {
          const pin = new PinElement({ glyphText: 'C', scale: 1.15 });
          content = pin.element || pin;
        }
        centerMarker = new AdvancedMarkerElement({
          map,
          position: this.selectedCenter,
          title: 'Selected search center',
          ...(content ? { content } : {}),
          zIndex: 10000,
        });

        this.updateRadiusCircle();
        this.applyMarkerVisibility(false);
        this.fitRadius();
      },

      clearCenter() {
        this.selectedCenter = null;
        if (centerMarker) {
          centerMarker.map = null;
          centerMarker = null;
        }
        if (radiusCircle) {
          radiusCircle.setMap(null);
          radiusCircle = null;
        }
        if (infoWindow) infoWindow.close();
        this.applyMarkerVisibility(true);
      },

      updateRadiusCircle() {
        if (!map || !this.selectedCenter) return;
        const options = {
          map,
          center: this.selectedCenter,
          radius: radiusValue(this.radiusKm) * 1000,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillOpacity: 0.12,
          clickable: false,
        };
        if (!radiusCircle) radiusCircle = new google.maps.Circle(options);
        else radiusCircle.setOptions(options);
      },

      fitRadius() {
        if (!map || !radiusCircle || typeof radiusCircle.getBounds !== 'function') return;
        const bounds = radiusCircle.getBounds();
        if (bounds) map.fitBounds(bounds, 48);
      },

      rebuildProviderMarkers(fit) {
        if (!map || !AdvancedMarkerElement) return;
        providerMarkers.forEach((entry) => { entry.marker.map = null; });
        providerMarkers = [];
        if (infoWindow) infoWindow.close();

        for (const provider of this.providers) {
          const position = providerPosition(provider);
          if (!position) continue;
          const marker = new AdvancedMarkerElement({
            map,
            position,
            title: provider.name || provider.businessName || 'Provider',
            gmpClickable: true,
          });
          const openInfo = () => this.openProviderInfo(provider, marker, position);
          if (typeof marker.addEventListener === 'function') marker.addEventListener('gmp-click', openInfo);
          else if (typeof marker.addListener === 'function') marker.addListener('click', openInfo);
          providerMarkers.push({ provider, position, marker });
        }

        this.applyMarkerVisibility(fit);
      },

      applyMarkerVisibility(fit) {
        if (!map) return;
        let visible = 0;
        const bounds = new google.maps.LatLngBounds();
        for (const entry of providerMarkers) {
          const { provider, position, marker } = entry;
          const directoryMatch = this.providerMatchesFilters(provider);
          const distance = this.selectedCenter ? distanceKm(this.selectedCenter, position) : null;
          const radiusMatch = distance === null || distance <= radiusValue(this.radiusKm);
          const show = directoryMatch && radiusMatch;
          marker.map = show ? map : null;
          entry.distanceKm = distance;
          if (show) {
            visible += 1;
            bounds.extend(position);
          }
        }
        this.providersOnMap = visible;
        this.refreshSummary();

        if (fit && !this.selectedCenter && visible > 0) {
          map.fitBounds(bounds, 48);
        }
      },

      openProviderInfo(provider, marker, position) {
        if (!infoWindow || !map) return;
        const distance = this.selectedCenter ? distanceKm(this.selectedCenter, position) : null;
        const wrapper = document.createElement('div');
        wrapper.style.minWidth = '220px';

        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.style.marginBottom = '4px';
        title.textContent = provider.name || 'Unnamed provider';
        wrapper.appendChild(title);

        if (provider.businessName) {
          const business = document.createElement('div');
          business.style.marginBottom = '6px';
          business.textContent = provider.businessName;
          wrapper.appendChild(business);
        }

        const details = [
          humanize(provider.status || 'unknown'),
          (provider.categorySlugs || []).map(humanize).join(', ') || 'No category',
          [provider.city, provider.state, provider.servicePincode].filter(Boolean).join(', ') || 'No service area',
          distance === null ? '' : `${distance.toFixed(1)} km from selected point`,
        ].filter(Boolean);
        details.forEach((text) => {
          const line = document.createElement('div');
          line.style.fontSize = '12px';
          line.style.marginTop = '3px';
          line.textContent = text;
          wrapper.appendChild(line);
        });

        const providerId = String(provider.providerId || provider.id || '').trim();
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
      },

      categoryLabel(value) {
        return humanize(value);
      },

      selectedPointLabel() {
        if (!this.selectedCenter) return 'Click anywhere on the map to choose a search center.';
        return `Selected point: ${this.selectedCenter.lat.toFixed(5)}, ${this.selectedCenter.lng.toFixed(5)} · ${radiusValue(this.radiusKm)} km radius`;
      },
    };
  }

  window.providerMap = providerMap;
})();
