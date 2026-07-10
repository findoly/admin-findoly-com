(function () {
  'use strict';

  const root = document.documentElement;
  const userIdentity = String(root.dataset.crmUser || 'guest').trim().toLowerCase() || 'guest';
  const STORAGE_KEY = `leadops.crm.appearance.v2:${userIdentity}`;

  const defaults = {
    accent: '#356ae6',
    headerBg: '#e9eef5',
    headerText: '#1f2937',
    sidebarBg: '#dde6f0',
    sidebarText: '#344054',
    sidebarActiveBg: '#cbdcf8',
    sidebarActiveText: '#174ea6',
    pageBg: '#eef2f6',
    mainText: '#172033',
    mutedText: '#667085',
    cardBg: '#fdfefe',
    cardHeaderBg: '#f5f8fb',
    cardBorder: '#cdd7e3',
    inputBg: '#ffffff',
    inputBorder: '#bdc9d8',
    tableHeadBg: '#e8eef5',
    tableHeadText: '#344054',
    tableBorder: '#d4dde8',
    tableRowBg: '#ffffff',
    tableAltBg: '#f7f9fc',
    tableHover: '#e7f0ff',
    cardRadius: 8,
    tableRadius: 8,
    buttonRadius: 6,
    navRadius: 6,
    cardBorderWidth: 1,
    tableBorderWidth: 1,
    sidebarWidth: 284,
    fontScale: 100,
    shadow: 'subtle',
    density: 'comfortable',
    tableStyle: 'striped'
  };

  const presets = {
    slate: { ...defaults },
    ocean: {
      ...defaults,
      accent: '#1677c8',
      headerBg: '#dfeef7',
      sidebarBg: '#d5e6f2',
      sidebarActiveBg: '#b8dbf1',
      sidebarActiveText: '#075985',
      pageBg: '#eaf2f7',
      cardHeaderBg: '#eff7fb',
      tableHeadBg: '#dcecf5',
      tableHover: '#dceeff'
    },
    sage: {
      ...defaults,
      accent: '#397a5a',
      headerBg: '#e4eee8',
      sidebarBg: '#dbe8df',
      sidebarActiveBg: '#c6dece',
      sidebarActiveText: '#24563d',
      pageBg: '#edf3ef',
      cardHeaderBg: '#f1f6f3',
      tableHeadBg: '#e2ece6',
      tableHover: '#e3f2e9'
    },
    sand: {
      ...defaults,
      accent: '#a35f1f',
      headerBg: '#f0e8dc',
      sidebarBg: '#e9dfd0',
      sidebarActiveBg: '#ead2b5',
      sidebarActiveText: '#7a4316',
      pageBg: '#f3eee7',
      cardHeaderBg: '#faf6f0',
      tableHeadBg: '#eee5d8',
      tableHover: '#f8ead8'
    },
    lavender: {
      ...defaults,
      accent: '#6b55b5',
      headerBg: '#ebe7f4',
      sidebarBg: '#e2ddef',
      sidebarActiveBg: '#d4c9ed',
      sidebarActiveText: '#4c3992',
      pageBg: '#f0edf6',
      cardHeaderBg: '#f7f5fb',
      tableHeadBg: '#e9e4f2',
      tableHover: '#eee8ff'
    },
    graphite: {
      ...defaults,
      accent: '#4b6478',
      headerBg: '#dfe5ea',
      sidebarBg: '#d4dce3',
      sidebarActiveBg: '#c1d0dc',
      sidebarActiveText: '#263f52',
      pageBg: '#e8edf1',
      cardHeaderBg: '#f1f4f6',
      tableHeadBg: '#dfe6eb',
      tableHover: '#e0ebf2'
    }
  };

  const variableMap = {
    accent: '--crm-user-accent',
    headerBg: '--crm-user-header-bg',
    headerText: '--crm-user-header-text',
    sidebarBg: '--crm-user-sidebar-bg',
    sidebarText: '--crm-user-sidebar-text',
    sidebarActiveBg: '--crm-user-sidebar-active-bg',
    sidebarActiveText: '--crm-user-sidebar-active-text',
    pageBg: '--crm-user-page-bg',
    mainText: '--crm-user-main-text',
    mutedText: '--crm-user-muted-text',
    cardBg: '--crm-user-card-bg',
    cardHeaderBg: '--crm-user-card-header-bg',
    cardBorder: '--crm-user-card-border',
    inputBg: '--crm-user-input-bg',
    inputBorder: '--crm-user-input-border',
    tableHeadBg: '--crm-user-table-head-bg',
    tableHeadText: '--crm-user-table-head-text',
    tableBorder: '--crm-user-table-border',
    tableRowBg: '--crm-user-table-row-bg',
    tableAltBg: '--crm-user-table-alt-bg',
    tableHover: '--crm-user-table-hover'
  };

  const numericVariableMap = {
    cardRadius: ['--crm-user-card-radius', 'px'],
    tableRadius: ['--crm-user-table-radius', 'px'],
    buttonRadius: ['--crm-user-button-radius', 'px'],
    navRadius: ['--crm-user-nav-radius', 'px'],
    cardBorderWidth: ['--crm-user-card-border-width', 'px'],
    tableBorderWidth: ['--crm-user-table-border-width', 'px'],
    sidebarWidth: ['--crm-user-sidebar-width', 'px'],
    fontScale: ['--crm-user-font-scale', '%']
  };

  const shadowValues = {
    none: 'none',
    subtle: '0 1px 3px rgba(15, 23, 42, .06)',
    soft: '0 6px 18px rgba(15, 23, 42, .09)',
    strong: '0 12px 30px rgba(15, 23, 42, .14)'
  };

  function validHex(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ''));
  }

  function hexToRgb(value) {
    if (!validHex(value)) return [53, 106, 230];
    const hex = value.slice(1);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  function shadeHex(value, amount) {
    const [r, g, b] = hexToRgb(value);
    const clamp = (number) => Math.max(0, Math.min(255, Math.round(number)));
    const factor = amount / 100;
    const adjust = (channel) => factor < 0 ? channel * (1 + factor) : channel + (255 - channel) * factor;
    return `#${[adjust(r), adjust(g), adjust(b)].map((channel) => clamp(channel).toString(16).padStart(2, '0')).join('')}`;
  }

  function rgba(value, alpha) {
    const [r, g, b] = hexToRgb(value);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function readSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      return { ...defaults, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (error) {
      return { ...defaults };
    }
  }

  function saveSettings(settings) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch (error) {
      return false;
    }
  }

  function sanitize(settings) {
    const next = { ...defaults, ...(settings || {}) };
    Object.keys(variableMap).forEach((key) => {
      if (!validHex(next[key])) next[key] = defaults[key];
    });
    Object.keys(numericVariableMap).forEach((key) => {
      const [min, max] = {
        cardRadius: [0, 24], tableRadius: [0, 24], buttonRadius: [0, 20], navRadius: [0, 20],
        cardBorderWidth: [0, 3], tableBorderWidth: [0, 3], sidebarWidth: [230, 360], fontScale: [90, 112]
      }[key];
      const value = Number(next[key]);
      next[key] = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : defaults[key];
    });
    if (!shadowValues[next.shadow]) next.shadow = defaults.shadow;
    if (!['compact', 'comfortable', 'spacious'].includes(next.density)) next.density = defaults.density;
    if (!['plain', 'striped'].includes(next.tableStyle)) next.tableStyle = defaults.tableStyle;
    return next;
  }

  function applySettings(rawSettings) {
    const settings = sanitize(rawSettings);
    Object.entries(variableMap).forEach(([key, variable]) => root.style.setProperty(variable, settings[key]));
    Object.entries(numericVariableMap).forEach(([key, [variable, unit]]) => root.style.setProperty(variable, `${settings[key]}${unit}`));

    root.style.setProperty('--crm-user-accent-hover', shadeHex(settings.accent, -12));
    root.style.setProperty('--crm-user-accent-soft', rgba(settings.accent, .12));
    root.style.setProperty('--crm-user-accent-softer', rgba(settings.accent, .07));
    root.style.setProperty('--crm-user-accent-rgb', hexToRgb(settings.accent).join(', '));
    root.style.setProperty('--crm-user-card-shadow', shadowValues[settings.shadow]);
    root.style.setProperty('--primary', settings.accent);
    root.style.setProperty('--primary-rgb', hexToRgb(settings.accent).join(','));

    root.dataset.crmDensity = settings.density;
    root.dataset.crmTableStyle = settings.tableStyle;
    root.dataset.crmShadow = settings.shadow;
    window.__crmAppearanceSettings = settings;
    return settings;
  }

  let currentSettings = applySettings(readSettings());

  function emitChanged(settings) {
    document.dispatchEvent(new CustomEvent('crm:appearance-changed', { detail: settings }));
  }

  function updateSettings(patch, persist = true) {
    currentSettings = applySettings({ ...currentSettings, ...patch });
    if (persist) saveSettings(currentSettings);
    emitChanged(currentSettings);
    return currentSettings;
  }

  function initPanel() {
    const panel = document.querySelector('[data-crm-appearance-panel]');
    const backdrop = document.querySelector('[data-crm-appearance-backdrop]');
    const openButtons = document.querySelectorAll('[data-crm-appearance-open]');
    if (!panel || !backdrop || !openButtons.length) return;

    const controls = Array.from(panel.querySelectorAll('[data-appearance-key]'));
    const status = panel.querySelector('[data-appearance-status]');
    let statusTimer;

    const showStatus = (message) => {
      if (!status) return;
      status.textContent = message;
      status.classList.add('is-visible');
      window.clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => status.classList.remove('is-visible'), 1600);
    };

    const syncControls = () => {
      controls.forEach((control) => {
        const key = control.dataset.appearanceKey;
        if (!(key in currentSettings)) return;
        control.value = currentSettings[key];
        const output = panel.querySelector(`[data-appearance-output="${key}"]`);
        if (output) output.textContent = `${currentSettings[key]}${control.type === 'range' && key !== 'fontScale' ? 'px' : (key === 'fontScale' ? '%' : '')}`;
      });
    };

    const open = () => {
      syncControls();
      panel.classList.add('is-open');
      backdrop.hidden = false;
      window.requestAnimationFrame(() => backdrop.classList.add('is-open'));
      panel.setAttribute('aria-hidden', 'false');
      document.body.classList.add('crm-appearance-open');
      panel.querySelector('input, select, button')?.focus();
    };

    const close = () => {
      panel.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('crm-appearance-open');
      window.setTimeout(() => { backdrop.hidden = true; }, 180);
    };

    openButtons.forEach((button) => button.addEventListener('click', open));
    panel.querySelectorAll('[data-crm-appearance-close]').forEach((button) => button.addEventListener('click', close));
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panel.classList.contains('is-open')) close();
    });

    controls.forEach((control) => {
      const eventName = control.type === 'range' || control.type === 'color' ? 'input' : 'change';
      control.addEventListener(eventName, () => {
        const key = control.dataset.appearanceKey;
        const value = control.type === 'range' ? Number(control.value) : control.value;
        updateSettings({ [key]: value });
        const output = panel.querySelector(`[data-appearance-output="${key}"]`);
        if (output) output.textContent = `${value}${control.type === 'range' && key !== 'fontScale' ? 'px' : (key === 'fontScale' ? '%' : '')}`;
        showStatus('Saved in this browser');
      });
    });

    panel.querySelectorAll('[data-appearance-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = presets[button.dataset.appearancePreset];
        if (!preset) return;
        currentSettings = applySettings(preset);
        saveSettings(currentSettings);
        syncControls();
        emitChanged(currentSettings);
        showStatus(`${button.textContent.trim()} applied`);
      });
    });

    panel.querySelector('[data-appearance-reset]')?.addEventListener('click', () => {
      currentSettings = applySettings(defaults);
      saveSettings(currentSettings);
      syncControls();
      emitChanged(currentSettings);
      showStatus('Default appearance restored');
    });

    syncControls();
  }

  window.CrmAppearance = {
    get: () => ({ ...currentSettings }),
    set: (patch) => updateSettings(patch),
    reset: () => updateSettings(defaults)
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPanel);
  else initPanel();
})();
