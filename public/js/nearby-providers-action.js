(function addNearbyProvidersRequirementAction() {
  function insertAction() {
    const match = window.location.pathname.match(/^\/(enquiries|requirements)\/([^/]+)\/?$/);
    if (!match) return;

    const actionBar = document.querySelector('[x-data="leadShow()"] > .d-flex.flex-wrap.gap-2.mb-3');
    if (!actionBar || actionBar.querySelector('[data-nearby-providers-action]')) return;

    const providerStatus = Array.from(actionBar.querySelectorAll('a')).find((link) =>
      String(link.textContent || '').trim() === 'Provider status',
    );
    if (!providerStatus) return;

    const link = document.createElement('a');
    link.className = providerStatus.className;
    link.href = '/' + match[1] + '/' + encodeURIComponent(match[2]) + '/nearby-providers';
    link.textContent = 'Nearby providers';
    link.dataset.nearbyProvidersAction = 'true';
    providerStatus.insertAdjacentElement('afterend', link);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertAction, { once: true });
  } else {
    insertAction();
  }
})();
