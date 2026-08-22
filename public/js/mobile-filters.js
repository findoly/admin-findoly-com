(function () {
  'use strict';

  const FILTER_FORM_SELECTOR = '.crm-filter-card form, .crm-filter-shell form, form.crm-filter-bar, form.crm-filter-toolbar';
  const FILTER_BAR_SELECTOR = '.crm-filter-bar, .crm-filter-toolbar';
  const FILTER_UI_BREAKPOINT = '(max-width: 991.98px)';
  const filterForms = [];
  const filterMedia = window.matchMedia(FILTER_UI_BREAKPOINT);

  function modelName(control) {
    return control.getAttribute('x-model') || control.getAttribute('x-model.number') || '';
  }

  function controlKey(control) {
    const name = String(control.name || '').trim();
    if (name && !name.startsWith('_')) return name;

    const model = modelName(control).trim();
    if (model.startsWith('filters.')) return model.slice('filters.'.length);
    if (model.startsWith('filter.')) return model.slice('filter.'.length);
    if (model === 'pagination.limit') return 'limit';
    if (/^[A-Za-z_$][\w$]*$/.test(model)) return model;
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

  function filterBar(form) {
    return form.matches(FILTER_BAR_SELECTOR)
      ? form
      : form.querySelector(':scope > .crm-filter-bar, :scope > .crm-filter-toolbar');
  }

  function updateMobileToggle(form) {
    const count = activeFilterCount(form);
    const bar = filterBar(form);
    const toggle = form.querySelector('[data-crm-mobile-filter-toggle]');
    if (toggle) {
      const open = Boolean(bar?.classList.contains('crm-mobile-filters-open'));
      const badge = toggle.querySelector('[data-crm-mobile-filter-count]');
      toggle.classList.toggle('is-active', count > 0 || open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (badge) {
        badge.textContent = String(count);
        badge.hidden = count === 0;
      }
    }

    if (form.dataset.crmNativeMobileFilter === '1') {
      const nativeToggle = form.querySelector('.crm-filter-toggle');
      const open = form.classList.contains('crm-mobile-native-open');
      form.classList.toggle('crm-mobile-native-has-active', count > 0);
      if (nativeToggle) {
        nativeToggle.dataset.crmFilterCount = String(count);
        if (filterMedia.matches) nativeToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
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

  function enhanceNativeFilter(form) {
    const panel = form.querySelector('.crm-filter-drawer, .crm-filter-advanced');
    const toggle = form.querySelector('.crm-filter-toggle');
    if (!panel || !toggle) return false;

    form.dataset.crmMobileFilterReady = 'native';
    form.dataset.crmNativeMobileFilter = '1';
    if (toggle.dataset.crmNativeMobileBound !== '1') {
      toggle.dataset.crmNativeMobileBound = '1';
      toggle.addEventListener('click', () => {
        if (!filterMedia.matches) return;
        form.classList.toggle('crm-mobile-native-open');
        updateMobileToggle(form);
      });
    }
    updateMobileToggle(form);
    return true;
  }

  function enhanceMobileFilterForm(form) {
    if (form.dataset.crmMobileFilterReady) return;
    const bar = filterBar(form);
    if (!bar) return;
    if (enhanceNativeFilter(form)) return;

    // A custom toggle without a known drawer is already page-owned; do not
    // restructure it and risk changing page-specific behavior.
    if (form.querySelector('.crm-filter-toggle')) {
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
      for (const value of controlValues(control)) {
        if (defaultFilterValue(key, value)) continue;
        url.searchParams.append(key, value);
      }
    }

    const next = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
    window.history.replaceState(window.history.state, '', next);
  }

  function alpineData(control) {
    const root = control.closest('[x-data]');
    if (!root || !window.Alpine || typeof window.Alpine.$data !== 'function') return null;
    try {
      return window.Alpine.$data(root);
    } catch (_error) {
      return null;
    }
  }

  function setAlpineModel(control, value) {
    const model = modelName(control).trim();
    if (!model || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(model)) return false;
    const data = alpineData(control);
    if (!data) return false;

    const parts = model.split('.');
    let target = data;
    for (let index = 0; index < parts.length - 1; index += 1) {
      target = target?.[parts[index]];
      if (!target || typeof target !== 'object') return false;
    }

    let nextValue = value;
    if (control.hasAttribute('x-model.number') && value !== '' && !Array.isArray(value)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) nextValue = parsed;
    }
    target[parts[parts.length - 1]] = nextValue;
    return true;
  }

  function restoreControl(control, params) {
    const key = controlKey(control);
    if (!key || !params.has(key)) return false;
    const values = params.getAll(key);
    let changed = false;
    let modelValue;

    if (control.type === 'checkbox' || control.type === 'radio') {
      const checked = values.includes(String(control.value || '1'));
      changed = control.checked !== checked;
      control.checked = checked;
      modelValue = checked;
    } else if (control instanceof HTMLSelectElement && control.multiple) {
      for (const option of control.options) {
        const selected = values.includes(String(option.value));
        if (option.selected !== selected) changed = true;
        option.selected = selected;
      }
      modelValue = values;
    } else {
      const value = values[values.length - 1] || '';
      changed = String(control.value || '') !== value;
      if (changed) control.value = value;
      modelValue = value;
    }

    if (changed && !setAlpineModel(control, modelValue)) {
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return changed;
  }

  function hasAlpineSubmit(form) {
    return Array.from(form.attributes).some((attribute) => {
      const name = String(attribute.name || '').toLowerCase();
      return name.includes('submit') && name.includes('prevent');
    });
  }

  function requestSubmitSafely(form) {
    if (!hasAlpineSubmit(form)) return;
    try {
      form.requestSubmit();
    } catch (_error) {
      // Older WebViews may not support requestSubmit. Keeping restored controls
      // is safer than turning the Alpine form into a normal navigation.
    }
  }

  function refreshWhenReady(form) {
    if (!hasAlpineSubmit(form)) return;
    const root = form.closest('[x-data]');
    const startedAt = Date.now();
    const attempt = () => {
      let data = null;
      if (root && window.Alpine && typeof window.Alpine.$data === 'function') {
        try { data = window.Alpine.$data(root); } catch (_error) { data = null; }
      }
      if (data?.loading === true && Date.now() - startedAt < 4000) {
        window.setTimeout(attempt, 60);
        return;
      }
      requestSubmitSafely(form);
    };
    window.setTimeout(attempt, 0);
  }

  function restoreFormsFromUrl(refreshChanged = false) {
    const params = new URLSearchParams(window.location.search);
    const changedForms = new Set();
    for (const form of filterForms) {
      for (const control of formControls(form)) {
        if (restoreControl(control, params)) changedForms.add(form);
      }
      updateMobileToggle(form);
    }
    if (refreshChanged) changedForms.forEach(refreshWhenReady);
    return changedForms;
  }

  function registerFilterForm(form) {
    if (filterForms.includes(form)) return;
    filterForms.push(form);
    enhanceMobileFilterForm(form);
  }

  function scanFilterForms() {
    document.querySelectorAll(FILTER_FORM_SELECTOR).forEach(registerFilterForm);
  }

  function closeMobileFilters(form) {
    const bar = filterBar(form);
    bar?.classList.remove('crm-mobile-filters-open');
    form.classList.remove('crm-mobile-native-open');
    updateMobileToggle(form);
  }

  function clearTransientShellState() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (_error) {
      // KeyboardEvent is unavailable only in very old embedded browsers.
    }
    document.documentElement.classList.remove('crm-mobile-drawer-open');
    document.body.classList.remove('crm-mobile-drawer-open', 'crm-appearance-open');
    document.querySelectorAll('.crm-sidebar-overlay').forEach((overlay) => {
      overlay.hidden = true;
    });
  }

  function handlePageShow(event) {
    if (!event.persisted) return;
    clearTransientShellState();
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
    restoreFormsFromUrl(false);
    filterForms.forEach(refreshWhenReady);
    document.dispatchEvent(new CustomEvent('crm:page-restored', { detail: { persisted: true } }));
  }

  scanFilterForms();

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !filterForms.includes(form)) return;
    syncFormUrl(form);
    if (filterMedia.matches) closeMobileFilters(form);
  }, true);

  document.addEventListener('change', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return;
    const form = control.closest(FILTER_FORM_SELECTOR);
    if (!form || !filterForms.includes(form)) return;
    const key = controlKey(control);
    if (key === 'limit' || key === 'status' || key === 'enabled' || key === 'dateField' || key === 'sortOrder' || control.type === 'date') {
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
        if (filterMedia.matches) closeMobileFilters(form);
        else updateMobileToggle(form);
      }, 0);
    }
  }, true);

  document.addEventListener('alpine:initialized', () => {
    scanFilterForms();
    restoreFormsFromUrl(true);
    try {
      window.sessionStorage.removeItem('crm-bfcache-reload:' + window.location.pathname + window.location.search);
    } catch (_error) {
      // Storage is optional.
    }
  }, { once: true });

  window.addEventListener('pageshow', handlePageShow);
  filterMedia.addEventListener?.('change', (event) => {
    if (event.matches) {
      for (const form of filterForms) {
        if (form.dataset.crmNativeMobileFilter === '1') form.classList.remove('crm-mobile-native-open');
        updateMobileToggle(form);
      }
    }
  });
})();