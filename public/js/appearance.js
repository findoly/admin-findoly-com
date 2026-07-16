(function () {
  'use strict';

  const root = document.documentElement;
  const userIdentity = String(root.dataset.crmUser || 'guest').trim().toLowerCase() || 'guest';
  const STORAGE_KEY = `leadops.crm.appearance.v6:${userIdentity}`;

  const defaults = {
    presetName: 'facebookLight',
    accent: '#1877f2',
    accentText: '#ffffff',
    headerBg: '#ffffff',
    headerBg2: '#ffffff',
    headerText: '#1c1e21',
    headerStyle: 'solid',
    sidebarBg: '#ffffff',
    sidebarBg2: '#ffffff',
    sidebarText: '#1c1e21',
    sidebarActiveBg: '#e7f3ff',
    sidebarActiveText: '#1877f2',
    sidebarStyle: 'solid',
    pageBg: '#f0f2f5',
    pageBg2: '#ffffff',
    backgroundStyle: 'solid',
    mainText: '#1c1e21',
    mutedText: '#65676b',
    cardBg: '#ffffff',
    cardHeaderBg: '#ffffff',
    cardBorder: '#d8dde5',
    inputBg: '#ffffff',
    inputBorder: '#ccd0d5',
    tableHeadBg: '#f0f2f5',
    tableHeadText: '#1c1e21',
    tableBorder: '#d8dde5',
    tableRowBg: '#ffffff',
    tableAltBg: '#f7f9fc',
    tableHover: '#e7f3ff',
    cardRadius: 8,
    tableRadius: 8,
    buttonRadius: 6,
    navRadius: 6,
    cardBorderWidth: 1,
    tableBorderWidth: 1,
    sidebarWidth: 276,
    shadow: 'subtle',
    density: 'comfortable',
    tableStyle: 'plain'
  };

  const presets = {
    facebookLight: { ...defaults },
    whiteBlack: {
      ...defaults,
      presetName: 'whiteBlack',
      accent: '#111827',
      accentText: '#ffffff',
      headerBg: '#ffffff',
      headerBg2: '#ffffff',
      headerText: '#111827',
      sidebarBg: '#f8fafc',
      sidebarBg2: '#f8fafc',
      sidebarText: '#374151',
      sidebarActiveBg: '#111827',
      sidebarActiveText: '#ffffff',
      pageBg: '#f4f5f7',
      pageBg2: '#ffffff',
      mainText: '#111827',
      mutedText: '#6b7280',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#dfe3e8',
      inputBg: '#ffffff',
      inputBorder: '#cfd5dc',
      tableHeadBg: '#f3f4f6',
      tableHeadText: '#111827',
      tableBorder: '#e2e5e9',
      tableRowBg: '#ffffff',
      tableAltBg: '#fafafa',
      tableHover: '#f3f4f6',
      cardRadius: 6,
      tableRadius: 6,
      buttonRadius: 5,
      navRadius: 5,
      shadow: 'none'
    },
    linkedin: {
      ...defaults,
      presetName: 'linkedin',
      accent: '#0a66c2',
      accentText: '#ffffff',
      headerBg: '#ffffff',
      headerBg2: '#ffffff',
      headerText: '#191919',
      sidebarBg: '#ffffff',
      sidebarBg2: '#ffffff',
      sidebarText: '#404040',
      sidebarActiveBg: '#e8f3ff',
      sidebarActiveText: '#0a66c2',
      pageBg: '#f3f2ef',
      pageBg2: '#ffffff',
      mainText: '#191919',
      mutedText: '#666666',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#d6d6d6',
      inputBg: '#ffffff',
      inputBorder: '#b9b9b9',
      tableHeadBg: '#eef3f8',
      tableHeadText: '#191919',
      tableBorder: '#d6d6d6',
      tableRowBg: '#ffffff',
      tableAltBg: '#fafafa',
      tableHover: '#edf5fc',
      cardRadius: 7,
      tableRadius: 7,
      buttonRadius: 18,
      navRadius: 7,
      shadow: 'subtle'
    },
    tealProfessional: {
      ...defaults,
      presetName: 'tealProfessional',
      accent: '#0f766e',
      accentText: '#ffffff',
      headerBg: '#ffffff',
      headerBg2: '#ffffff',
      headerText: '#17332f',
      sidebarBg: '#f0fdfa',
      sidebarBg2: '#f0fdfa',
      sidebarText: '#214e49',
      sidebarActiveBg: '#ccfbf1',
      sidebarActiveText: '#0f766e',
      pageBg: '#f7faf9',
      pageBg2: '#ffffff',
      mainText: '#17332f',
      mutedText: '#64748b',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#d7e4e1',
      inputBg: '#ffffff',
      inputBorder: '#b9d0cb',
      tableHeadBg: '#e7f7f3',
      tableHeadText: '#17332f',
      tableBorder: '#d7e4e1',
      tableRowBg: '#ffffff',
      tableAltBg: '#f8fbfa',
      tableHover: '#e6f7f3',
      cardRadius: 7,
      tableRadius: 7,
      buttonRadius: 6,
      navRadius: 6,
      shadow: 'subtle'
    },
    whatsapp: {
      ...defaults,
      presetName: 'whatsapp',
      accent: '#128c7e',
      accentText: '#ffffff',
      headerBg: '#ffffff',
      headerBg2: '#ffffff',
      headerText: '#111b21',
      sidebarBg: '#075e54',
      sidebarBg2: '#075e54',
      sidebarText: '#d9fdd3',
      sidebarActiveBg: '#25d366',
      sidebarActiveText: '#063b32',
      pageBg: '#f0f2f5',
      pageBg2: '#ffffff',
      mainText: '#111b21',
      mutedText: '#667781',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#d9e1e5',
      inputBg: '#ffffff',
      inputBorder: '#c5d0d5',
      tableHeadBg: '#e7f7f1',
      tableHeadText: '#111b21',
      tableBorder: '#d9e1e5',
      tableRowBg: '#ffffff',
      tableAltBg: '#f7faf9',
      tableHover: '#d9fdd3',
      cardRadius: 8,
      tableRadius: 8,
      buttonRadius: 8,
      navRadius: 8,
      shadow: 'subtle'
    },
    practo: {
      ...defaults,
      presetName: 'practo',
      accent: '#0b8fb3',
      accentText: '#ffffff',
      headerBg: '#ffffff',
      headerBg2: '#ffffff',
      headerText: '#2d2d32',
      sidebarBg: '#28328c',
      sidebarBg2: '#28328c',
      sidebarText: '#f2f4ff',
      sidebarActiveBg: '#14bef0',
      sidebarActiveText: '#17255a',
      pageBg: '#f4f8fb',
      pageBg2: '#ffffff',
      mainText: '#2d2d32',
      mutedText: '#6f7075',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#d9e6ec',
      inputBg: '#ffffff',
      inputBorder: '#bdd5df',
      tableHeadBg: '#e6f7fc',
      tableHeadText: '#28328c',
      tableBorder: '#d9e6ec',
      tableRowBg: '#ffffff',
      tableAltBg: '#f8fbfc',
      tableHover: '#e5f8fd',
      cardRadius: 8,
      tableRadius: 8,
      buttonRadius: 6,
      navRadius: 6,
      shadow: 'subtle'
    },
    slack: {
      ...defaults,
      presetName: 'slack',
      accent: '#611f69',
      accentText: '#ffffff',
      headerBg: '#4a154b',
      headerBg2: '#4a154b',
      headerText: '#ffffff',
      sidebarBg: '#4a154b',
      sidebarBg2: '#4a154b',
      sidebarText: '#f8f4f9',
      sidebarActiveBg: '#ffffff',
      sidebarActiveText: '#4a154b',
      pageBg: '#f8f6f8',
      pageBg2: '#ffffff',
      mainText: '#1d1c1d',
      mutedText: '#616061',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#ddd7de',
      inputBg: '#ffffff',
      inputBorder: '#c9c1ca',
      tableHeadBg: '#f1eaf2',
      tableHeadText: '#4a154b',
      tableBorder: '#ddd7de',
      tableRowBg: '#ffffff',
      tableAltBg: '#fbf9fb',
      tableHover: '#e8f5fa',
      cardRadius: 8,
      tableRadius: 8,
      buttonRadius: 6,
      navRadius: 6,
      shadow: 'subtle'
    },
    fiverr: {
      ...defaults,
      presetName: 'fiverr',
      accent: '#1dbf73',
      accentText: '#0b3d2a',
      headerBg: '#ffffff',
      headerBg2: '#ffffff',
      headerText: '#222325',
      sidebarBg: '#003912',
      sidebarBg2: '#003912',
      sidebarText: '#e8f7ee',
      sidebarActiveBg: '#1dbf73',
      sidebarActiveText: '#0b3d2a',
      pageBg: '#f5f5f5',
      pageBg2: '#ffffff',
      mainText: '#222325',
      mutedText: '#62646a',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#dadbdd',
      inputBg: '#ffffff',
      inputBorder: '#b5b6ba',
      tableHeadBg: '#edf8f1',
      tableHeadText: '#222325',
      tableBorder: '#dadbdd',
      tableRowBg: '#ffffff',
      tableAltBg: '#fafafa',
      tableHover: '#e5f8ed',
      cardRadius: 6,
      tableRadius: 6,
      buttonRadius: 4,
      navRadius: 4,
      shadow: 'subtle'
    },
    amazon: {
      ...defaults,
      presetName: 'amazon',
      accent: '#ff9900',
      accentText: '#131921',
      headerBg: '#131921',
      headerBg2: '#131921',
      headerText: '#ffffff',
      sidebarBg: '#232f3e',
      sidebarBg2: '#232f3e',
      sidebarText: '#f3f4f6',
      sidebarActiveBg: '#ff9900',
      sidebarActiveText: '#131921',
      pageBg: '#eaeded',
      pageBg2: '#ffffff',
      mainText: '#0f1111',
      mutedText: '#565959',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#d5d9d9',
      inputBg: '#ffffff',
      inputBorder: '#888c8c',
      tableHeadBg: '#f3f4f6',
      tableHeadText: '#0f1111',
      tableBorder: '#d5d9d9',
      tableRowBg: '#ffffff',
      tableAltBg: '#f7f8f8',
      tableHover: '#fff3df',
      cardRadius: 4,
      tableRadius: 4,
      buttonRadius: 18,
      navRadius: 4,
      shadow: 'subtle'
    },
    flipkart: {
      ...defaults,
      presetName: 'flipkart',
      accent: '#2874f0',
      accentText: '#ffffff',
      headerBg: '#2874f0',
      headerBg2: '#2874f0',
      headerText: '#ffffff',
      sidebarBg: '#ffffff',
      sidebarBg2: '#ffffff',
      sidebarText: '#172337',
      sidebarActiveBg: '#eaf2ff',
      sidebarActiveText: '#2874f0',
      pageBg: '#f1f3f6',
      pageBg2: '#ffffff',
      mainText: '#172337',
      mutedText: '#6b7280',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#dfe3e8',
      inputBg: '#ffffff',
      inputBorder: '#c5cbd3',
      tableHeadBg: '#eaf2ff',
      tableHeadText: '#172337',
      tableBorder: '#dfe3e8',
      tableRowBg: '#ffffff',
      tableAltBg: '#fafbfc',
      tableHover: '#eef4ff',
      cardRadius: 4,
      tableRadius: 4,
      buttonRadius: 3,
      navRadius: 3,
      shadow: 'subtle'
    },
    google: {
      ...defaults,
      presetName: 'google',
      accent: '#1a73e8',
      accentText: '#ffffff',
      headerBg: '#ffffff',
      headerBg2: '#ffffff',
      headerText: '#202124',
      sidebarBg: '#ffffff',
      sidebarBg2: '#ffffff',
      sidebarText: '#3c4043',
      sidebarActiveBg: '#e8f0fe',
      sidebarActiveText: '#1967d2',
      pageBg: '#f8f9fa',
      pageBg2: '#ffffff',
      mainText: '#202124',
      mutedText: '#5f6368',
      cardBg: '#ffffff',
      cardHeaderBg: '#ffffff',
      cardBorder: '#dadce0',
      inputBg: '#ffffff',
      inputBorder: '#bdc1c6',
      tableHeadBg: '#f1f3f4',
      tableHeadText: '#202124',
      tableBorder: '#dadce0',
      tableRowBg: '#ffffff',
      tableAltBg: '#fafafa',
      tableHover: '#e8f0fe',
      cardRadius: 8,
      tableRadius: 8,
      buttonRadius: 4,
      navRadius: 8,
      shadow: 'subtle'
    },
    softBlue: {
      ...defaults,
      presetName: 'softBlue',
      accent: '#5b7fb5',
      headerText: '#26364d',
      sidebarBg: '#f2f6fc',
      sidebarBg2: '#f2f6fc',
      sidebarText: '#42536a',
      sidebarActiveBg: '#dfeaf8',
      sidebarActiveText: '#456b9f',
      pageBg: '#f6f9fd',
      pageBg2: '#ffffff',
      mainText: '#26364d',
      mutedText: '#6d7d91',
      cardBorder: '#dce5f0',
      inputBorder: '#c8d5e5',
      tableHeadBg: '#edf3fa',
      tableHeadText: '#30445f',
      tableBorder: '#dce5f0',
      tableAltBg: '#fafcff',
      tableHover: '#e8f0fa'
    },
    softGreen: {
      ...defaults,
      presetName: 'softGreen',
      accent: '#4f8f70',
      headerText: '#294439',
      sidebarBg: '#f0f8f4',
      sidebarBg2: '#f0f8f4',
      sidebarText: '#3f6253',
      sidebarActiveBg: '#dcefe5',
      sidebarActiveText: '#3e7a5d',
      pageBg: '#f6faf8',
      pageBg2: '#ffffff',
      mainText: '#294439',
      mutedText: '#6f8278',
      cardBorder: '#dce9e2',
      inputBorder: '#c7d9cf',
      tableHeadBg: '#eaf4ef',
      tableHeadText: '#315442',
      tableBorder: '#dce9e2',
      tableAltBg: '#fafcfb',
      tableHover: '#e5f2eb'
    },
    softPurple: {
      ...defaults,
      presetName: 'softPurple',
      accent: '#8069ad',
      headerText: '#403552',
      sidebarBg: '#f6f2fb',
      sidebarBg2: '#f6f2fb',
      sidebarText: '#5d506f',
      sidebarActiveBg: '#e9e0f5',
      sidebarActiveText: '#70579e',
      pageBg: '#faf8fc',
      pageBg2: '#ffffff',
      mainText: '#403552',
      mutedText: '#7d728a',
      cardBorder: '#e5dfee',
      inputBorder: '#d2c7df',
      tableHeadBg: '#f1ebf7',
      tableHeadText: '#4f4164',
      tableBorder: '#e5dfee',
      tableAltBg: '#fcfbfd',
      tableHover: '#eee7f7'
    },
    softPeach: {
      ...defaults,
      presetName: 'softPeach',
      accent: '#bd775e',
      headerText: '#543a31',
      sidebarBg: '#fff5f0',
      sidebarBg2: '#fff5f0',
      sidebarText: '#735548',
      sidebarActiveBg: '#f9e3d9',
      sidebarActiveText: '#a45f49',
      pageBg: '#fff9f6',
      pageBg2: '#ffffff',
      mainText: '#543a31',
      mutedText: '#8a756c',
      cardBorder: '#eddcd4',
      inputBorder: '#ddc5ba',
      tableHeadBg: '#f9ece6',
      tableHeadText: '#67483c',
      tableBorder: '#eddcd4',
      tableAltBg: '#fffcfa',
      tableHover: '#fae9e1'
    },
    softGrey: {
      ...defaults,
      presetName: 'softGrey',
      accent: '#667085',
      headerText: '#344054',
      sidebarBg: '#f5f6f8',
      sidebarBg2: '#f5f6f8',
      sidebarText: '#586174',
      sidebarActiveBg: '#e4e7ec',
      sidebarActiveText: '#475467',
      pageBg: '#f7f8fa',
      pageBg2: '#ffffff',
      mainText: '#344054',
      mutedText: '#7b8494',
      cardBorder: '#e1e4e9',
      inputBorder: '#cfd4dc',
      tableHeadBg: '#f0f2f5',
      tableHeadText: '#475467',
      tableBorder: '#e1e4e9',
      tableAltBg: '#fafbfc',
      tableHover: '#eceff3'
    },
    softOrange: {
      ...defaults,
      presetName: 'softOrange',
      accent: '#c97932',
      headerText: '#513b27',
      sidebarBg: '#fff7ed',
      sidebarBg2: '#fff7ed',
      sidebarText: '#71543a',
      sidebarActiveBg: '#fde7cb',
      sidebarActiveText: '#a85f22',
      pageBg: '#fffbf6',
      pageBg2: '#ffffff',
      mainText: '#513b27',
      mutedText: '#897563',
      cardBorder: '#eee0d0',
      inputBorder: '#ddc9b2',
      tableHeadBg: '#faefe1',
      tableHeadText: '#65482f',
      tableBorder: '#eee0d0',
      tableAltBg: '#fffdf9',
      tableHover: '#fcebd7'
    }
  };

  const REMOVED_PRESETS = new Set(['blackWhite', 'facebook', 'blueBlackWhite']);

  const variableMap = {
    accent: '--crm-user-accent', accentText: '--crm-user-accent-text',
    headerBg: '--crm-user-header-bg', headerBg2: '--crm-user-header-bg2', headerText: '--crm-user-header-text',
    sidebarBg: '--crm-user-sidebar-bg', sidebarBg2: '--crm-user-sidebar-bg2', sidebarText: '--crm-user-sidebar-text',
    sidebarActiveBg: '--crm-user-sidebar-active-bg', sidebarActiveText: '--crm-user-sidebar-active-text',
    pageBg: '--crm-user-page-bg', pageBg2: '--crm-user-page-bg2',
    mainText: '--crm-user-main-text', mutedText: '--crm-user-muted-text',
    cardBg: '--crm-user-card-bg', cardHeaderBg: '--crm-user-card-header-bg', cardBorder: '--crm-user-card-border',
    inputBg: '--crm-user-input-bg', inputBorder: '--crm-user-input-border',
    tableHeadBg: '--crm-user-table-head-bg', tableHeadText: '--crm-user-table-head-text', tableBorder: '--crm-user-table-border',
    tableRowBg: '--crm-user-table-row-bg', tableAltBg: '--crm-user-table-alt-bg', tableHover: '--crm-user-table-hover'
  };

  const numericVariableMap = {
    cardRadius: ['--crm-user-card-radius', 'px'], tableRadius: ['--crm-user-table-radius', 'px'],
    buttonRadius: ['--crm-user-button-radius', 'px'], navRadius: ['--crm-user-nav-radius', 'px'],
    cardBorderWidth: ['--crm-user-card-border-width', 'px'], tableBorderWidth: ['--crm-user-table-border-width', 'px'],
    sidebarWidth: ['--crm-user-sidebar-width', 'px']
  };

  const shadowValues = {
    none: 'none',
    subtle: '0 1px 3px rgba(15, 23, 42, .06)',
    soft: '0 6px 18px rgba(15, 23, 42, .09)',
    strong: '0 12px 30px rgba(15, 23, 42, .14)'
  };

  function validHex(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')); }
  function hexToRgb(value) {
    if (!validHex(value)) return [17, 24, 39];
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
  function relativeLuminance(value) {
    const channels = hexToRgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  }
  function isDark(value) { return relativeLuminance(value) < 0.42; }
  function readSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { ...defaults };
      if (REMOVED_PRESETS.has(parsed.presetName)) return { ...defaults };
      return { ...defaults, ...parsed };
    } catch (error) { return { ...defaults }; }
  }
  function saveSettings(settings) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); return true; }
    catch (error) { return false; }
  }
  function sanitize(settings) {
    const next = { ...defaults, ...(settings || {}) };
    Object.keys(variableMap).forEach((key) => { if (!validHex(next[key])) next[key] = defaults[key]; });
    Object.keys(numericVariableMap).forEach((key) => {
      const limits = {
        cardRadius: [0, 24], tableRadius: [0, 24], buttonRadius: [0, 20], navRadius: [0, 20],
        cardBorderWidth: [0, 3], tableBorderWidth: [0, 3], sidebarWidth: [230, 360]
      }[key];
      const value = Number(next[key]);
      next[key] = Number.isFinite(value) ? Math.max(limits[0], Math.min(limits[1], value)) : defaults[key];
    });
    if (!shadowValues[next.shadow]) next.shadow = defaults.shadow;
    if (!['compact', 'comfortable', 'spacious'].includes(next.density)) next.density = defaults.density;
    if (!['plain', 'striped'].includes(next.tableStyle)) next.tableStyle = defaults.tableStyle;
    if (!['solid', 'soft-gradient', 'gradient', 'radial', 'dots', 'grid', 'paper'].includes(next.backgroundStyle)) next.backgroundStyle = defaults.backgroundStyle;
    if (!['solid', 'gradient'].includes(next.headerStyle)) next.headerStyle = defaults.headerStyle;
    if (!['solid', 'gradient'].includes(next.sidebarStyle)) next.sidebarStyle = defaults.sidebarStyle;
    if (next.presetName && !presets[next.presetName]) return { ...defaults };
    return next;
  }
  function pageBackground(settings) {
    const ink = rgba(settings.mainText, .08);
    const inkSoft = rgba(settings.mainText, .045);
    switch (settings.backgroundStyle) {
      case 'gradient': return `linear-gradient(135deg, ${settings.pageBg} 0%, ${settings.pageBg2} 100%)`;
      case 'radial': return `radial-gradient(circle at 10% 10%, ${settings.pageBg2} 0, transparent 42%), radial-gradient(circle at 90% 0%, ${rgba(settings.accent, .12)} 0, transparent 36%), ${settings.pageBg}`;
      case 'dots': return `radial-gradient(${ink} 1px, transparent 1px), ${settings.pageBg}`;
      case 'grid': return `linear-gradient(${inkSoft} 1px, transparent 1px), linear-gradient(90deg, ${inkSoft} 1px, transparent 1px), ${settings.pageBg}`;
      case 'paper': return `repeating-linear-gradient(0deg, transparent 0 27px, ${inkSoft} 27px 28px), linear-gradient(135deg, ${settings.pageBg}, ${settings.pageBg2})`;
      case 'soft-gradient': return `linear-gradient(145deg, ${settings.pageBg} 0%, ${settings.pageBg2} 72%, ${rgba(settings.accent, .07)} 100%)`;
      default: return settings.pageBg;
    }
  }
  function shellBackground(primary, secondary, style, direction) {
    return style === 'gradient' ? `linear-gradient(${direction}, ${primary}, ${secondary})` : primary;
  }
  function applySettings(rawSettings) {
    const settings = sanitize(rawSettings);
    Object.entries(variableMap).forEach(([key, variable]) => root.style.setProperty(variable, settings[key]));
    Object.entries(numericVariableMap).forEach(([key, [variable, unit]]) => root.style.setProperty(variable, `${settings[key]}${unit}`));
    root.style.setProperty('--crm-user-accent-hover', shadeHex(settings.accent, -12));
    root.style.setProperty('--crm-user-accent-soft', rgba(settings.accent, .12));
    root.style.setProperty('--crm-user-accent-softer', rgba(settings.accent, .07));
    root.style.setProperty('--crm-user-accent-rgb', hexToRgb(settings.accent).join(', '));
    const headerDark = isDark(settings.headerBg);
    const sidebarDark = isDark(settings.sidebarBg);
    root.style.setProperty('--crm-user-header-hover-bg', headerDark ? 'rgba(255, 255, 255, .16)' : rgba(settings.accent, .10));
    root.style.setProperty('--crm-user-header-hover-text', headerDark ? '#ffffff' : shadeHex(settings.accent, -14));
    root.style.setProperty('--crm-user-sidebar-hover-bg', sidebarDark ? 'rgba(255, 255, 255, .12)' : rgba(settings.accent, .10));
    root.style.setProperty('--crm-user-sidebar-hover-text', sidebarDark ? '#ffffff' : shadeHex(settings.accent, -14));
    root.style.setProperty('--crm-user-card-shadow', shadowValues[settings.shadow]);
    root.style.setProperty('--crm-user-page-background', pageBackground(settings));
    root.style.setProperty('--crm-user-header-background', shellBackground(settings.headerBg, settings.headerBg2, settings.headerStyle, '90deg'));
    root.style.setProperty('--crm-user-sidebar-background', shellBackground(settings.sidebarBg, settings.sidebarBg2, settings.sidebarStyle, '180deg'));
    root.style.setProperty('--primary', settings.accent);
    root.style.setProperty('--primary-rgb', hexToRgb(settings.accent).join(','));
    root.dataset.crmDensity = settings.density;
    root.dataset.crmTableStyle = settings.tableStyle;
    root.dataset.crmShadow = settings.shadow;
    root.dataset.crmBackgroundStyle = settings.backgroundStyle;
    window.__crmAppearanceSettings = settings;
    return settings;
  }

  let currentSettings = applySettings(readSettings());
  function emitChanged(settings) { document.dispatchEvent(new CustomEvent('crm:appearance-changed', { detail: settings })); }
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
        if (output) output.textContent = `${currentSettings[key]}${control.type === 'range' ? 'px' : ''}`;
      });
      panel.querySelectorAll('[data-appearance-preset]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.appearancePreset === currentSettings.presetName);
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
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.classList.contains('is-open')) close(); });
    controls.forEach((control) => {
      const eventName = control.type === 'range' || control.type === 'color' ? 'input' : 'change';
      control.addEventListener(eventName, () => {
        const key = control.dataset.appearanceKey;
        const value = control.type === 'range' ? Number(control.value) : control.value;
        updateSettings({ [key]: value, presetName: '' });
        const output = panel.querySelector(`[data-appearance-output="${key}"]`);
        if (output) output.textContent = `${value}${control.type === 'range' ? 'px' : ''}`;
        showStatus('Saved in this browser');
      });
    });
    panel.querySelectorAll('[data-appearance-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.appearancePreset;
        const preset = presets[name];
        if (!preset) return;
        currentSettings = applySettings({ ...preset, presetName: name });
        saveSettings(currentSettings);
        syncControls();
        emitChanged(currentSettings);
        showStatus(`${button.dataset.presetLabel || button.textContent.trim()} applied`);
      });
    });
    panel.querySelector('[data-appearance-reset]')?.addEventListener('click', () => {
      currentSettings = applySettings(defaults);
      saveSettings(currentSettings);
      syncControls();
      emitChanged(currentSettings);
      showStatus('Facebook light restored');
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
