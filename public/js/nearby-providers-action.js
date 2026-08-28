(function addNearbyProvidersRequirementAction() {
  async function updateCount(link, leadId) {
    try {
      const body = await apiFetch('/api/enquiry/' + encodeURIComponent(leadId) + '/nearby-providers');
      const count = Number(body.count);
      if (!Number.isFinite(count)) return;
      const nearbyCount = Math.max(0, Math.trunc(count));
      const canSend = body.lead?.providerAlertStatus?.canSend === true;
      link.textContent = (canSend ? 'Send Provider Alert' : 'Provider Alerts')
        + ' (' + nearbyCount + ' nearby)';
    } catch (_error) {
      // Keep the action available even if the count request cannot be completed.
    }
  }

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
    link.textContent = 'Send Provider Alert';
    link.dataset.nearbyProvidersAction = 'true';
    providerStatus.insertAdjacentElement('afterend', link);
    updateCount(link, match[2]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertAction, { once: true });
  } else {
    insertAction();
  }
})();
