(function () {
  'use strict';

  const leadDetailPath = /^\/(?:enquiries|requirements)\/[^/]+\/?$/;
  const nearbyProvidersPath = /^\/(?:enquiries|requirements)\/[^/]+\/nearby-providers\/?$/;
  const providerDetailPath = /^\/providers\/[^/]+\/?$/;
  const categoryPath = /^\/(?:categories|category)\/?$/;

  const rules = [
    {
      key: 'automatic-whatsapp-alerts',
      path: leadDetailPath,
      selector: 'label',
      text: 'Automatic nearby WhatsApp alerts',
      message: 'Enabled sends automatic nearby-provider WhatsApp alerts when this lead is approved and published. Disabled still allows the lead to be published and employees can still send WhatsApp manually.'
    },
    {
      key: 'lead-status',
      path: leadDetailPath,
      selector: 'div.text-muted.fs-sm',
      text: 'Status',
      message: 'This is the CRM journey status for the lead. It is separate from marketplace availability and from the provider sale outcome.'
    },
    {
      key: 'marketplace-status',
      path: leadDetailPath,
      selector: 'div.text-muted.fs-sm',
      text: 'Marketplace',
      message: 'Shows whether the lead is currently available to providers. Published means available; Closed can mean the unlock limit or another lifecycle reason. Expired or deactivated leads remain unavailable.'
    },
    {
      key: 'unlock-capacity',
      path: leadDetailPath,
      selector: 'div.text-muted.fs-sm',
      text: 'Unlock capacity',
      message: 'Shows genuine provider unlocks against the normal unlock limit. WhatsApp alerts are not counted as unlocks. A secure employee-shared provider link can allow an additional selected provider without reopening the marketplace for everyone.'
    },
    {
      key: 'confirmed-providers',
      path: leadDetailPath,
      selector: 'div.text-muted.fs-sm',
      text: 'Confirmed',
      message: 'Counts unlocked providers who marked the lead Confirmed. This is a provider outcome and is different from simply unlocking the lead.'
    },
    {
      key: 'sale-conversion',
      path: leadDetailPath,
      selector: 'h5, strong, span',
      text: 'Sale conversion',
      message: 'Sale conversion is driven by provider outcomes. A provider first unlocks the lead and then marks it Confirmed; employees do not manually create that provider outcome.'
    },
    {
      key: 'nearby-send-whatsapp',
      path: nearbyProvidersPath,
      selector: 'button',
      textPrefix: 'Send WhatsApp to selected',
      placement: 'after',
      message: 'Sends the normal nearby-provider WhatsApp alert. It does not bypass the provider unlock limit. Sending an alert does not count as a lead unlock and does not deduct provider credits.'
    },
    {
      key: 'nearby-whatsapp-status',
      path: nearbyProvidersPath,
      selector: 'th',
      text: 'WhatsApp',
      message: 'Shows whether this provider can receive a normal WhatsApp alert, whether an alert was sent before, and whether the previous send was Automatic or Manual.'
    },
    {
      key: 'nearby-provider-credits',
      path: nearbyProvidersPath,
      selector: 'th',
      text: 'Credits',
      message: 'Shows the provider\'s current usable credit balance. Credits are deducted on an actual paid lead unlock, not when a WhatsApp alert is sent.'
    },
    {
      key: 'copy-provider-lead-link',
      path: nearbyProvidersPath,
      selector: 'button',
      text: 'Copy lead link',
      placement: 'after',
      all: true,
      message: 'Creates a secure link for this provider and this lead only. The selected provider can use it to unlock even after the normal provider unlock limit is reached. Normal lead charges still apply, and it does not reopen the marketplace for other providers.'
    },
    {
      key: 'provider-credit-balance',
      path: providerDetailPath,
      selector: 'dt',
      text: 'Credit balance',
      message: 'The provider\'s current usable credit balance. Credits are normally consumed when the provider genuinely unlocks a paid lead.'
    },
    {
      key: 'provider-add-credits',
      path: providerDetailPath,
      selector: 'button',
      text: 'Add credits',
      placement: 'after',
      message: 'Immediately adds usable credits to this provider and records the adjustment permanently. Use the reason, internal note and optional reference so the change stays auditable.'
    },
    {
      key: 'category-alert-distance',
      path: categoryPath,
      selector: 'label',
      text: 'Provider alert distance (km)',
      message: 'Controls how far Findoly looks for eligible nearby providers. This category value is copied to new requirements and can be overridden on an individual requirement.'
    },
    {
      key: 'category-alert-radius-column',
      path: categoryPath,
      selector: 'th',
      text: 'Alert radius',
      message: 'The default nearby-provider search distance for this category. New requirements copy this value; existing requirements keep their own saved radius.'
    },
    {
      key: 'category-default-unlocks',
      path: categoryPath,
      selector: 'label',
      text: 'Default provider unlocks',
      message: 'Sets the normal provider unlock limit copied to new requirements in this category. Existing requirements keep their saved limit. Secure employee-shared provider links do not reopen normal marketplace capacity.'
    },
    {
      key: 'category-unlock-limit-column',
      path: categoryPath,
      selector: 'th',
      text: 'Unlock limit',
      message: 'The normal maximum number of provider unlocks copied to new requirements for this category.'
    }
  ];

  const style = document.createElement('style');
  style.dataset.crmContextHelpStyle = 'true';
  style.textContent = [
    '.crm-context-help-trigger{display:inline-flex;align-items:center;justify-content:center;width:1.15rem;height:1.15rem;margin-left:.3rem;padding:0;border:1px solid currentColor;border-radius:50%;background:transparent;color:inherit;opacity:.62;font:700 .7rem/1 system-ui,sans-serif;vertical-align:middle;cursor:pointer}',
    '.crm-context-help-trigger:hover,.crm-context-help-trigger:focus-visible,.crm-context-help-trigger[aria-expanded="true"]{opacity:1;outline:none;box-shadow:0 0 0 .18rem rgba(13,110,253,.12)}',
    '#crm-context-help-panel{position:fixed;z-index:1095;width:min(19rem,calc(100vw - 1.5rem));padding:.7rem .8rem;border:1px solid var(--bs-border-color,#dee2e6);border-radius:.65rem;background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#212529);box-shadow:0 .65rem 1.8rem rgba(15,23,42,.16);font-size:.78rem;line-height:1.45;text-align:left;white-space:normal}',
    '#crm-context-help-panel[hidden]{display:none!important}'
  ].join('');
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'crm-context-help-panel';
  panel.setAttribute('role', 'tooltip');
  panel.hidden = true;
  document.body.appendChild(panel);

  let activeTrigger = null;
  let scanScheduled = false;

  function normalizedText(node) {
    return String(node && node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function matchesRule(node, rule) {
    const text = normalizedText(node);
    if (rule.text && text !== rule.text) return false;
    if (rule.textPrefix && !text.startsWith(rule.textPrefix)) return false;
    return true;
  }

  function closeHelp() {
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeTrigger = null;
    panel.hidden = true;
    panel.textContent = '';
  }

  function positionPanel(trigger) {
    if (!trigger || panel.hidden) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const panelWidth = Math.min(304, window.innerWidth - (margin * 2));
    panel.style.width = panelWidth + 'px';
    panel.style.left = Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - margin)) + 'px';
    panel.style.top = Math.min(rect.bottom + gap, window.innerHeight - panel.offsetHeight - margin) + 'px';
  }

  function openHelp(trigger, message) {
    if (activeTrigger === trigger && !panel.hidden) {
      closeHelp();
      return;
    }
    closeHelp();
    activeTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    panel.textContent = message;
    panel.hidden = false;
    positionPanel(trigger);
  }

  function createTrigger(rule, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'crm-context-help-trigger';
    button.textContent = 'i';
    button.setAttribute('aria-label', 'Information: ' + (rule.text || rule.key));
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', panel.id);
    button.dataset.crmContextHelpKey = rule.key + ':' + index;
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openHelp(button, rule.message);
    });
    return button;
  }

  function decorateRule(rule) {
    if (!rule.path.test(window.location.pathname)) return;
    const nodes = Array.from(document.querySelectorAll(rule.selector));
    let decorated = 0;
    for (const node of nodes) {
      if (!matchesRule(node, rule)) continue;
      if (node.dataset.crmContextHelpRule === rule.key) continue;
      node.dataset.crmContextHelpRule = rule.key;
      const trigger = createTrigger(rule, decorated);
      if (rule.placement === 'after') node.insertAdjacentElement('afterend', trigger);
      else node.appendChild(trigger);
      decorated += 1;
      if (rule.all !== true) break;
    }
  }

  function scan() {
    scanScheduled = false;
    rules.forEach(decorateRule);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    window.requestAnimationFrame(scan);
  }

  scheduleScan();
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  document.addEventListener('click', function (event) {
    if (!panel.hidden && event.target !== activeTrigger && !panel.contains(event.target)) closeHelp();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeHelp();
  });
  window.addEventListener('resize', closeHelp);
  window.addEventListener('scroll', closeHelp, true);
})();
