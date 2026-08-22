(function () {
  'use strict';

  if (window.Alpine) return;

  const sources = [
    'https://cdn.jsdelivr.net/npm/alpinejs@3.15.12/dist/cdn.min.js',
    'https://unpkg.com/alpinejs@3.15.12/dist/cdn.min.js'
  ];

  function showRuntimeError() {
    if (document.getElementById('crm-runtime-error')) return;
    const banner = document.createElement('div');
    banner.id = 'crm-runtime-error';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'position:fixed;left:.75rem;right:.75rem;top:.75rem;z-index:2000;padding:.8rem 1rem;border:1px solid #fecaca;border-radius:.65rem;background:#fff1f2;color:#991b1b;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 .5rem 1.5rem rgba(15,23,42,.14)';
    banner.textContent = 'The CRM interface could not finish loading. Check the connection and reload this page.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload';
    button.style.cssText = 'margin-left:.75rem;padding:.35rem .65rem;border:1px solid #fca5a5;border-radius:.45rem;background:#fff;color:#991b1b;font:inherit;cursor:pointer';
    button.addEventListener('click', () => window.location.reload());
    banner.appendChild(button);
    document.body.appendChild(banner);
    document.dispatchEvent(new CustomEvent('crm:alpine-unavailable'));
  }

  function loadSource(index) {
    if (window.Alpine) return;
    if (index >= sources.length) {
      showRuntimeError();
      return;
    }

    const script = document.createElement('script');
    script.src = sources[index];
    script.async = false;
    script.setAttribute('data-crm-alpine-source', String(index + 1));
    script.addEventListener('load', () => {
      if (!window.Alpine) loadSource(index + 1);
    }, { once: true });
    script.addEventListener('error', () => loadSource(index + 1), { once: true });
    document.head.appendChild(script);
  }

  loadSource(0);
})();
