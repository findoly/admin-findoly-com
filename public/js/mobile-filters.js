(function () {
  'use strict';

  const FILTER_FORM_SELECTOR = '.crm-filter-card form, .crm-filter-shell form';
  const FILTER_BAR_SELECTOR = '.crm-filter-bar, .crm-filter-toolbar';
  const FILTER_UI_BREAKPOINT = '(max-width: 991.98px)';
  const filterForms = [];
  const filterKeys = new Set();

  function modelName(control) {
    return control.getAttribute('x-model') || control.getAttribute('x-model.number') || '';
  }

  function controlKey(control) {
    const name = String(control.name || '').trim();
    if (name && !name.startsWith('_')) return name;
    const model = modelName(control);
    if (model.startsWith('filters.')) return model.slice('filters.'.length);
    if (model === 'pagination.limit') return 'limit';
    return '';
  }

  function controlValues(control) {
    if (!control || control.disabled) return [];
    if (control.type === 'checkbox' || control.type === 'radio') {
      return control.checked ? [String(control.value || '1')] : [];
    }
    if (control instanceof HTMLSelectElement && control.multiple) {
      return Array.from(control.selectedOptions).map((option) => String(option.value || '')).filter(Boolean);
    }
    const value = String(control.value || '').trim();
    return value ? [value] : [];
  }

  function defaultFilterValue(key, value) {
    if (!value) return true;
    if (key === 'sortOrder' && value === 'newest') return true;
    if (key === 'dateField' && value === 'createdAt') return true;
    if (key === 'limit' && value === '20') return true;
    return false;
  }

  function formControls(form) {
    return Array.from(form.querySelectorAll('input, select, textarea')).filter((control) => Boolean(controlKey(control)));
  }

  function activeFilterCount(form) {
    return formControls(form).reduce((count, control) => {
      const key = controlKey(control);
      if (!key || key === 'q' || key === 'limit') return count;
      const values = controlValues(control);
      return count + (values.some((value) => !defaultFilterValue(key, value)) ? 1 : 0);
    }, 0);
  }

  function updateMobileToggle(form) {
    const toggle = form.querySelector('[data-crm-mobile-filter-toggle]');
    if (!toggle) return;
    const count = activeFilterCount(form);
    const badge = toggle.querySelector('[data-crm-mobile-filter-count]');
    toggle.classList.toggle('is-active', count > 0 || form.classList.contains('crm-mobile-filters-open'));
    toggle.setAttribute('aria-expanded', form.classList.contains('crm-mobile-filters-open') ? 'true' : 'false');
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
  }

  function filterIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 6h16M7 12h10M10 18h4');
    svg.appendChild(path);
    return svg;
  }

  function enhanceMobileFilterForm(form) {
    if (form.dataset.crmMobileFilterReady === '1') return;

    let bar = form.matches(FILTER_BAR_SELECTOR) ? form : form.querySelector(':scope > .crm-filter-bar, :scope > .crm-filter-toolbar');
    if (!bar) return;

    // Drawer/advanced implementations already have their own collapse control.
    if (form.querySelector('.crm-filter-drawer, .crm-filter-advanced, .crm-filter-toggle')) {
      form.dataset.crmMobileFilterReady = 'native';
      return;
    }

    const children = Array.from(bar.children);
    if (!children.length) return;
    const search = children.find((child) => child.matches('.crm-search-control, .crm-filter-search')) || null;
    const panel = document.createElement('div');
    panel.className = 'crm-mobile-filter-panel';
    panel.setAttribute('data-crm-mobile-filter-panel', '');

    for (const child of children) {
      if (child === search) continue;
      panel.appendChild(child);
    }

    if (search) {
      const searchButton = document.createElement('button');
      searchButton.type = 'submit';
      searchButton.className = 'btn btn-primary crm-mobile-search-submit';
      searchButton.textContent = 'Search';
      searchButton.setAttribute('data-crm-mobile-search-submit', '');
      bar.appendChild(searchButton);
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-light crm-mobile-filter-toggle';
    toggle.setAttribute('data-crm-mobile-filter-toggle', '');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.appendChild(filterIcon());
    toggle.appendChild(document.createTextNode(' Filters'));
    const badge = document.createElement('span');
    badge.className = 'crm-mobile-filter-count';
    badge.setAttribute('data-crm-mobile-filter-count', '');
    badge.hidden = true;
    toggle.appendChild(badge);
    toggle.addEventListener('click', () => {
      bar.classList.toggle('crm-mobile-filters-open');
      updateMobileToggle(form);
    });
    bar.appendChild(toggle);
    bar.appendChild(panel);

    bar.setAttribute('data-crm-mobile-filter-bar', '1');
    form.dataset.crmMobileFilterReady = '1';
    updateMobileToggle(form);
  }

  function syncFormUrl(form) {
    const url = new URL(window.location.href);
    const controls = formControls(form);
    const keys = new Set(controls.map(controlKey).filter(Boolean));
    keys.forEach((key) => url.searchParams.delete(key));
    url.searchParams.delete('cursor');

    for (const control of controls) {
      const key = controlKey(control);
      if (!key) continue;
      const values = controlValues(control);
      for (const value of values) {
        if (defaultFilterValue(key, value)) continue;
        url.searchParams.append(key, value);
      }
    }

    const next = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
    window.history.replaceState(window.history.state, '', next);
  }

  function restoreControl(control, params) {
    const key = controlKey(control);
    if (!key || !params.has(key)) return false;
    const values = params.getAll(key);
    let changed = false;

    if (control.type === 'checkbox' || control.type === 'radio') {
      const checked = values.includes(String(control.value || '1'));
      changed = control.checked !== checked;
      control.checked = checked;
    } else if (control instanceof HTMLSelectElement && control.multiple) {
      for (const option of control.options) {
        const selected = values.includes(String(option.value));
        if (option.selected !== selected) changed = true;
        option.selected = selected;
      }
    } else {
      const value = values[values.length - 1] || '';
      changed = String(control.value || '') !== value;
      if (changed) control.value = value;
    }

    if (changed) {
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return changed;
  }

  function restoreFormsFromUrl() {
    const params = new URLSearchParams(window.location.search);
    for (const form of filterForms) {
      for (const control of formControls(form)) restoreControl(control, params);
      updateMobileToggle(form);
    }
  }

  function registerFilterForm(form) {
    if (filterForms.includes(form)) return;
    filterForms.push(form);
    for (const control of formControls(form)) {
      const key = controlKey(control);
      if (key) filterKeys.add(key);
    }
    enhanceMobileFilterForm(form);
  }

  function scanFilterForms() {
    document.querySelectorAll(FILTER_FORM_SELECTOR).forEach(registerFilterForm);
  }

  function mergePageFiltersIntoApiUrl(rawUrl, options) {
    if (typeof rawUrl !== 'string') return rawUrl;
    const method = String(options?.method || 'GET').toUpperCase();
    if (method !== 'GET') return rawUrl;

    let target;
    try {
      target = new URL(rawUrl, window.location.origin);
    } catch (_error) {
      return rawUrl;
    }
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/')) return rawUrl;

    // Paginated list requests carry limit/cursor. Avoid leaking list filters into
    // auxiliary API calls (for example category dropdown loading).
    if (!target.searchParams.has('limit') && !target.searchParams.has('cursor')) return rawUrl;

    const pageParams = new URLSearchParams(window.location.search);
    for (const key of filterKeys) {
      if (!pageParams.has(key)) continue;
      target.searchParams.delete(key);
      for (const value of pageParams.getAll(key)) target.searchParams.append(key, value);
    }
    target.searchParams.delete('cursor');

    return target.pathname + (target.searchParams.toString() ? '?' + target.searchParams.toString() : '') + target.hash;
  }

  function wrapApiFetch() {
    if (typeof window.apiFetch !== 'function' || window.apiFetch.__crmFilterWrapped) return;
    const original = window.apiFetch;
    const wrapped = function (url, options) {
      return original(mergePageFiltersIntoApiUrl(url, options), options);
    };
    wrapped.__crmFilterWrapped = true;
    window.apiFetch = wrapped;
  }

  function clearTransientShellState() {
    document.documentElement.classList.remove('crm-mobile-drawer-open');
    document.body.classList.remove('crm-mobile-drawer-open', 'crm-appearance-open');
    document.querySelectorAll('.crm-sidebar-overlay').forEach((overlay) => {
      overlay.hidden = true;
    });
  }

  function hasAlpineSubmit(form) {
    return Array.from(form.attributes).some((attribute) => {
      const name = String(attribute.name || '').toLowerCase();
      return name.includes('submit') && name.includes('prevent');
    });
  }

  function refreshRestoredLists() {
    for (const form of filterForms) {
      if (!hasAlpineSubmit(form)) continue;
      try {
        form.requestSubmit();
      } catch (_error) {
        // Older WebViews may not support requestSubmit; preserving the restored
        // Alpine state is safer than forcing navigation.
      }
    }
  }

  function handlePageShow(event) {
    if (!event.persisted) return;
    clearTransientShellState();
    restoreFormsFromUrl();
    if (!window.Alpine) {
      const key = 'crm-bfcache-reload:' + window.location.pathname + window.location.search;
      try {
        if (window.sessionStorage.getItem(key) !== '1') {
          window.sessionStorage.setItem(key, '1');
          window.location.reload();
          return;
        }
      } catch (_error) {
        window.location.reload();
        return;
      }
    }
    window.setTimeout(refreshRestoredLists, 0);
    document.dispatchEvent(new CustomEvent('crm:page-restored', { detail: { persisted: true } }));
  }

  scanFilterForms();
  wrapApiFetch();

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !filterForms.includes(form)) return;
    syncFormUrl(form);
    updateMobileToggle(form);
  }, true);

  document.addEventListener('change', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return;
    const form = control.closest(FILTER_FORM_SELECTOR);
    if (!form || !filterForms.includes(form)) return;
    const key = controlKey(control);
    if (key === 'limit' || key === 'status' || key === 'dateField' || key === 'sortOrder' || control.type === 'date') {
      syncFormUrl(form);
    }
    updateMobileToggle(form);
  }, true);

  document.addEventListener('input', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return;
    const form = control.closest(FILTER_FORM_SELECTOR);
    if (form && filterForms.includes(form)) updateMobileToggle(form);
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button, a.btn');
    if (!button) return;
    const form = button.closest(FILTER_FORM_SELECTOR);
    if (!form || !filterForms.includes(form)) return;
    const label = String(button.textContent || '').trim().toLowerCase();
    if (label === 'clear' || label === 'reset') {
      window.setTimeout(() => {
        syncFormUrl(form);
        updateMobileToggle(form);
      }, 0);
    }
  }, true);

  document.addEventListener('alpine:initialized', () => {
    scanFilterForms();
    wrapApiFetch();
    restoreFormsFromUrl();
  }, { once: true });

  window.addEventListener('pageshow', handlePageShow);
  window.matchMedia(FILTER_UI_BREAKPOINT).addEventListener?.('change', () => {
    for (const form of filterForms) updateMobileToggle(form);
  });
})();
