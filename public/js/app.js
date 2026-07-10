(function () {
  function humanize(value) {
    return String(value || '')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function readJsonScript(selector, fallback) {
    const el = document.querySelector(selector);
    if (!el) return fallback;
    try { return JSON.parse(el.textContent); } catch (error) { return fallback; }
  }

  function sidebar() {
    const sidebarEl = document.querySelector('.sidebar-main');
    const toggles = document.querySelectorAll('.sidebar-mobile-main-toggle');
    if (!sidebarEl || !toggles.length) return;
    toggles.forEach((toggle) => {
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        sidebarEl.classList.toggle('sidebar-mobile-expanded');
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') sidebarEl.classList.remove('sidebar-mobile-expanded');
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 992) sidebarEl.classList.remove('sidebar-mobile-expanded');
    });
  }

  function submenuAccordion() {
    document.querySelectorAll('.nav-item-submenu > .nav-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const item = link.closest('.nav-item-submenu');
        const group = item && item.querySelector(':scope > .nav-group-sub');
        if (!item || !group) return;
        item.classList.toggle('nav-item-open');
        item.classList.toggle('nav-item-expanded');
        group.classList.toggle('show');
      });
    });
  }

  function renderBars() {
    document.querySelectorAll('.crm-mini-bars').forEach((container) => {
      const raw = container.getAttribute('data-bars') || '{}';
      let data = {};
      try { data = JSON.parse(raw); } catch (error) { data = {}; }
      const entries = Object.entries(data);
      if (!entries.length) {
        container.innerHTML = '<div class="text-muted">No data yet.</div>';
        return;
      }
      const max = Math.max(...entries.map(([, value]) => Number(value) || 0), 1);
      container.innerHTML = entries.map(([label, value]) => {
        const width = Math.round(((Number(value) || 0) / max) * 100);
        return `<div class="crm-bar-row"><span>${escapeHtml(humanize(label))}</span><div class="crm-bar-track"><div class="crm-bar-fill" style="width:${width}%"></div></div><strong>${escapeHtml(value)}</strong></div>`;
      }).join('');
    });
  }

  function renderDynamicField(field, value) {
    const requiredBadge = field.required ? '<span class="required-hint">Required, can be filled later</span>' : '';
    const placeholder = escapeHtml(field.placeholder || '');
    const name = escapeHtml(field.name);
    const label = escapeHtml(field.label || humanize(field.name));
    const help = field.helpText ? `<div class="form-text">${escapeHtml(field.helpText)}</div>` : '';
    const options = Array.isArray(field.options) ? field.options : [];
    const valueText = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    let control = '';

    if (field.type === 'textarea') {
      control = `<textarea class="form-control" name="field__${name}" rows="3" placeholder="${placeholder}">${escapeHtml(valueText)}</textarea>`;
    } else if (field.type === 'select') {
      control = `<select class="form-select" name="field__${name}"><option value="">Select</option>${options.map((option) => `<option value="${escapeHtml(option)}" ${valueText === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`;
    } else if (field.type === 'radio') {
      control = `<div class="form-check-horizontal">${options.map((option) => `<label class="form-check form-check-inline"><input class="form-check-input" type="radio" name="field__${name}" value="${escapeHtml(option)}" ${valueText === option ? 'checked' : ''}><span class="form-check-label">${escapeHtml(option)}</span></label>`).join('')}</div>`;
    } else if (field.type === 'checkbox') {
      const selected = Array.isArray(value) ? value : valueText.split(',').map((item) => item.trim()).filter(Boolean);
      control = `<div class="form-check-horizontal">${options.map((option) => `<label class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="field__${name}" value="${escapeHtml(option)}" ${selected.includes(option) ? 'checked' : ''}><span class="form-check-label">${escapeHtml(option)}</span></label>`).join('')}</div>`;
    } else {
      const inputType = field.type === 'file_url' ? 'url' : (field.type || 'text');
      const defaultPlaceholder = field.type === 'file_url' ? 'https://example.com/photo-or-file.jpg' : placeholder;
      control = `<input class="form-control" type="${escapeHtml(inputType)}" name="field__${name}" value="${escapeHtml(valueText)}" placeholder="${escapeHtml(defaultPlaceholder)}">`;
    }

    return `<div class="row mb-3"><label class="col-lg-3 col-form-label">${label}${requiredBadge}</label><div class="col-lg-9">${control}${help}</div></div>`;
  }

  function dynamicTemplateForm() {
    const form = document.querySelector('[data-dynamic-template-form]');
    if (!form) return;
    const sourceInput = form.querySelector('[data-template-source]');
    const categorySelect = form.querySelector('[data-template-category]');
    const formTypeInput = form.querySelector('[data-template-form-type]');
    const templateSelect = form.querySelector('[data-template-select]');
    const target = form.querySelector('[data-dynamic-fields]');
    const keyInput = form.querySelector('[data-dynamic-field-keys]');
    const summary = form.querySelector('[data-template-summary]');
    const templates = readJsonScript('#templates-json', []);
    if (!categorySelect || !target) return;

    const sourceValue = () => String(sourceInput?.value || 'manual-admin').trim().toLowerCase();
    const categoryValue = () => String(categorySelect.value || '').trim();
    const formTypeValue = () => slugify(formTypeInput?.value || 'default') || 'default';

    const scoreTemplate = (template) => {
      if (template.categorySlug !== categoryValue()) return 0;
      let score = 20;
      if (template.sourceWebsite === sourceValue()) score += 20;
      if (template.sourceWebsite === 'any') score += 8;
      if ((template.formType || 'default') === formTypeValue()) score += 20;
      if ((template.formType || 'default') === 'default') score += 5;
      return score;
    };

    const bestTemplate = () => {
      const selectedId = templateSelect?.value;
      if (selectedId) return templates.find((template) => template.id === selectedId);
      return templates
        .map((template) => ({ template, score: scoreTemplate(template) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.template;
    };

    const syncTemplateOptions = () => {
      if (!templateSelect) return;
      Array.from(templateSelect.options).forEach((option) => {
        if (!option.value) return;
        const score = scoreTemplate({
          categorySlug: option.dataset.category,
          sourceWebsite: option.dataset.source,
          formType: option.dataset.formType || 'default'
        });
        option.hidden = score === 0;
      });
    };

    const render = () => {
      syncTemplateOptions();
      const template = bestTemplate();
      const fields = template ? template.fields || [] : [];
      if (keyInput) keyInput.value = fields.map((field) => field.name).join(',');
      if (summary) {
        const schemaUrl = `/api/forms/schema?sourceWebsite=${encodeURIComponent(sourceValue())}&categorySlug=${encodeURIComponent(categoryValue())}&formType=${encodeURIComponent(formTypeValue())}`;
        summary.innerHTML = template
          ? `<div class="alert alert-info"><strong>${escapeHtml(template.name)}</strong><br><span>${escapeHtml(template.sourceWebsite)} · ${escapeHtml(template.categorySlug)} · ${escapeHtml(template.formType || 'default')} · ${fields.length} fields</span><br><a target="_blank" href="${schemaUrl}">Open schema API</a></div>`
          : `<div class="alert alert-warning">No matching form definition found. You can still save the requirement and add a definition later. <a target="_blank" href="${schemaUrl}">Check schema API</a></div>`;
      }
      if (!fields.length) {
        target.innerHTML = '<div class="text-muted">No form definition fields configured for this website/category/form type. You can still save the requirement with notes.</div>';
        return;
      }
      target.innerHTML = fields.map((field) => renderDynamicField(field)).join('');
    };

    const applyCategoryDefaults = () => {
      const selected = categorySelect.selectedOptions[0];
      const categorySource = selected?.dataset.source;
      const categoryFormType = selected?.dataset.formType;
      if (categorySource && categorySource !== 'any' && sourceInput && (!sourceInput.value || sourceInput.value === 'manual-admin')) sourceInput.value = categorySource;
      if (categoryFormType && formTypeInput && (!formTypeInput.value || formTypeInput.value === 'default')) formTypeInput.value = categoryFormType;
    };

    sourceInput?.addEventListener('input', render);
    formTypeInput?.addEventListener('input', render);
    templateSelect?.addEventListener('change', render);
    categorySelect.addEventListener('change', () => {
      applyCategoryDefaults();
      if (templateSelect) templateSelect.value = '';
      render();
    });
    applyCategoryDefaults();
    render();
  }


  function leadCreateWizard() {
    const form = document.querySelector('[data-lead-create-wizard]');
    if (!form) return;

    const steps = Array.from(form.querySelectorAll('[data-wizard-step]'));
    const stepButtons = Array.from(form.querySelectorAll('[data-wizard-step-button]'));
    const nextButton = form.querySelector('[data-wizard-next]');
    const prevButton = form.querySelector('[data-wizard-prev]');
    const submitButton = form.querySelector('[data-wizard-submit]');
    const categorySelect = form.querySelector('[data-lead-category]');
    const sourceInput = form.querySelector('[data-lead-source]');
    const formTypeInput = form.querySelector('[data-lead-form-type]');
    const templateIdInput = form.querySelector('[data-lead-template-id]');
    const schemaTarget = form.querySelector('[data-schema-fields]');
    const schemaSummary = form.querySelector('[data-schema-summary]');
    const dynamicKeysInput = form.querySelector('[data-dynamic-field-keys]');
    const extraSection = form.querySelector('[data-extra-details-section]');
    const extraRows = form.querySelector('[data-extra-detail-rows]');
    const addExtraButton = form.querySelector('[data-add-extra-detail]');
    const extraJsonInput = form.querySelector('[data-extra-details-json]');
    const templates = readJsonScript('#templates-json', []);
    let activeStep = 0;

    const setStep = (index, shouldScroll = true) => {
      activeStep = Math.max(0, Math.min(index, steps.length - 1));
      steps.forEach((step, stepIndex) => step.classList.toggle('active', stepIndex === activeStep));
      stepButtons.forEach((button, buttonIndex) => {
        button.classList.toggle('active', buttonIndex === activeStep);
        button.classList.toggle('completed', buttonIndex < activeStep);
        button.setAttribute('aria-current', buttonIndex === activeStep ? 'step' : 'false');
      });
      prevButton?.classList.toggle('d-none', activeStep === 0);
      nextButton?.classList.toggle('d-none', activeStep === steps.length - 1);
      submitButton?.classList.toggle('d-none', activeStep !== steps.length - 1);
      if (shouldScroll) form.querySelector('.crm-wizard-step.active')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const clearControlError = (control) => {
      control.classList.remove('is-invalid');
      const wrapper = control.closest('[class*="col-"]') || control.parentElement;
      wrapper?.querySelector(':scope > .crm-invalid-feedback')?.remove();
    };

    const showControlError = (control) => {
      clearControlError(control);
      control.classList.add('is-invalid');
      const wrapper = control.closest('[class*="col-"]') || control.parentElement;
      const feedback = document.createElement('div');
      feedback.className = 'crm-invalid-feedback';
      feedback.textContent = control.validationMessage || 'Please complete this field.';
      wrapper?.appendChild(feedback);
    };

    const validatePanel = (panel, shouldFocus = true) => {
      if (!panel) return true;
      const controls = Array.from(panel.querySelectorAll('input, select, textarea'))
        .filter((control) => !control.disabled && control.type !== 'hidden');
      let firstInvalid = null;
      controls.forEach((control) => {
        clearControlError(control);
        if (!control.checkValidity()) {
          showControlError(control);
          firstInvalid ||= control;
        }
      });
      if (firstInvalid) {
        if (shouldFocus) {
          firstInvalid.focus({ preventScroll: true });
          firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return false;
      }
      return true;
    };

    const validateStep = () => validatePanel(steps[activeStep]);

    const getSelectedTemplate = () => {
      const category = String(categorySelect?.value || '').trim();
      const source = String(sourceInput?.value || '').trim().toLowerCase();
      if (!category) return null;
      return templates
        .map((template) => {
          if (template.categorySlug !== category) return { template, score: -1 };
          let score = 20;
          if (template.sourceWebsite === source) score += 10;
          if (template.sourceWebsite === 'any') score += 5;
          if ((template.formType || 'default') === 'default') score += 2;
          return { template, score };
        })
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score)[0]?.template || null;
    };

    const renderSchemaFields = () => {
      if (!schemaTarget || !schemaSummary) return;
      const previousValues = {};
      schemaTarget.querySelectorAll('[name^="field__"]').forEach((input) => {
        previousValues[input.name] = input.value;
      });

      const template = getSelectedTemplate();
      const fields = Array.isArray(template?.fields) ? template.fields : [];
      if (templateIdInput) templateIdInput.value = template?.id || '';
      if (formTypeInput) formTypeInput.value = template?.formType || categorySelect?.selectedOptions?.[0]?.dataset.formType || 'default';
      if (dynamicKeysInput) dynamicKeysInput.value = fields.map((field) => field.name).join(',');

      if (!categorySelect?.value) {
        schemaSummary.innerHTML = 'Select a category in step 1 to load its known fields.';
        schemaTarget.innerHTML = '';
        return;
      }

      if (!fields.length) {
        schemaSummary.innerHTML = '<strong>No predefined fields for this category.</strong> You can still add name/value details below.';
        schemaTarget.innerHTML = '';
        return;
      }

      schemaSummary.innerHTML = `<strong>${escapeHtml(template.name || 'Category fields')}</strong><span class="d-block text-muted fs-sm mt-1">${fields.length} known fields are shown as simple text inputs.</span>`;
      schemaTarget.innerHTML = fields.map((field) => {
        const key = escapeHtml(field.name);
        const value = previousValues[`field__${field.name}`] || '';
        const required = field.required ? '<span class="text-danger ms-1">*</span>' : '';
        return `<div class="row mb-3 crm-schema-field-row"><label class="col-lg-3 col-form-label">${escapeHtml(field.label || humanize(field.name))}${required}<span class="crm-field-type">${escapeHtml(field.type || 'text')}</span></label><div class="col-lg-9"><input class="form-control" type="text" name="field__${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || `Enter ${field.label || humanize(field.name)}`)}"><div class="form-text">Saved as <code>additionalDetails.${key}</code>.</div></div></div>`;
      }).join('');
    };

    const syncExtraDetails = () => {
      if (!extraJsonInput || !extraRows) return;
      const details = {};
      extraRows.querySelectorAll('[data-extra-detail-row]').forEach((row) => {
        const label = row.querySelector('[data-extra-detail-name]')?.value.trim() || '';
        const value = row.querySelector('[data-extra-detail-value]')?.value.trim() || '';
        const key = slugify(label).replace(/-/g, '_');
        if (key) details[key] = value;
      });
      extraJsonInput.value = JSON.stringify(details);
    };

    const addExtraDetailRow = (name = '', value = '') => {
      if (!extraRows) return;
      const row = document.createElement('div');
      row.className = 'row g-2 align-items-end mb-3 crm-extra-detail-row';
      row.setAttribute('data-extra-detail-row', '');
      row.innerHTML = `<div class="col-lg-4"><label class="form-label">Field name</label><input class="form-control" type="text" data-extra-detail-name value="${escapeHtml(name)}" placeholder="Example: Material"></div><div class="col-lg-7"><label class="form-label">Value</label><input class="form-control" type="text" data-extra-detail-value value="${escapeHtml(value)}" placeholder="Example: Plywood"></div><div class="col-lg-1"><button class="btn btn-light w-100" type="button" data-remove-extra-detail aria-label="Remove detail"><i class="ph-trash"></i></button></div>`;
      extraRows.appendChild(row);
      row.querySelectorAll('input').forEach((input) => input.addEventListener('input', syncExtraDetails));
      row.querySelector('[data-remove-extra-detail]')?.addEventListener('click', () => {
        row.remove();
        syncExtraDetails();
      });
      syncExtraDetails();
    };

    const toggleExtraDetails = () => {
      const enabled = form.querySelector('[data-extra-details-choice]:checked')?.value === 'yes';
      extraSection?.classList.toggle('d-none', !enabled);
      if (enabled && extraRows && !extraRows.children.length) addExtraDetailRow();
      if (!enabled && extraRows) {
        extraRows.innerHTML = '';
        syncExtraDetails();
      }
    };

    nextButton?.addEventListener('click', () => {
      if (!validateStep()) return;
      if (activeStep === 0) renderSchemaFields();
      setStep(activeStep + 1);
    });
    prevButton?.addEventListener('click', () => setStep(activeStep - 1));
    stepButtons.forEach((button, index) => button.addEventListener('click', () => {
      if (index > activeStep && !validateStep()) return;
      if (index === 1) renderSchemaFields();
      setStep(index);
    }));
    categorySelect?.addEventListener('change', renderSchemaFields);
    sourceInput?.addEventListener('change', renderSchemaFields);
    form.querySelectorAll('[data-extra-details-choice]').forEach((input) => input.addEventListener('change', toggleExtraDetails));
    addExtraButton?.addEventListener('click', () => addExtraDetailRow());
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      control.addEventListener('input', () => clearControlError(control));
      control.addEventListener('change', () => clearControlError(control));
    });
    form.addEventListener('submit', (event) => {
      syncExtraDetails();
      const invalidStep = steps.findIndex((step) => !validatePanel(step, false));
      if (invalidStep >= 0) {
        event.preventDefault();
        setStep(invalidStep, false);
        validatePanel(steps[invalidStep], true);
      }
    });

    toggleExtraDetails();
    setStep(0, false);
  }


  function compactFilterForms() {
    const forms = document.querySelectorAll('.card-body.border-top > form.row.g-3.align-items-end[method="get"]');
    forms.forEach((form, index) => {
      if (form.dataset.crmCompactFilterInit === 'true') return;
      const groups = Array.from(form.children).filter((node) => node.nodeType === 1);
      const searchGroup = groups.find((group) => group.querySelector('input[name="q"], input[name="search"]'));
      const pageSizeGroup = groups.find((group) => group.querySelector('select[name="pageSize"]'));
      const actionGroup = groups.find((group) => group.querySelector('button[type="submit"]'));
      if (!searchGroup || !actionGroup) return;

      form.dataset.crmCompactFilterInit = 'true';
      form.className = 'crm-filter-form';
      form.parentElement?.classList.add('crm-filter-shell');

      const toolbar = document.createElement('div');
      toolbar.className = 'crm-filter-toolbar';
      const advanced = document.createElement('div');
      advanced.className = 'crm-filter-advanced';
      advanced.id = `crm-filter-advanced-${index}`;
      const grid = document.createElement('div');
      grid.className = 'crm-filter-grid';

      searchGroup.className = 'crm-filter-search';
      searchGroup.querySelector('.form-label')?.classList.add('visually-hidden');
      toolbar.appendChild(searchGroup);

      const advancedGroups = groups.filter((group) => group !== searchGroup && group !== pageSizeGroup && group !== actionGroup);
      advancedGroups.forEach((group) => {
        group.className = 'crm-filter-field';
        grid.appendChild(group);
      });
      advanced.appendChild(grid);

      const activeFilterCount = () => advancedGroups.reduce((count, group) => {
        const active = Array.from(group.querySelectorAll('input, select, textarea')).some((control) => {
          if (control.disabled || !control.name) return false;
          if (control.type === 'checkbox' || control.type === 'radio') return control.checked;
          return String(control.value || '').trim() !== '';
        });
        return count + (active ? 1 : 0);
      }, 0);

      const count = activeFilterCount();
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `btn btn-light crm-filter-toggle${count ? ' is-active' : ''}`;
      toggle.setAttribute('aria-controls', advanced.id);
      toggle.setAttribute('aria-expanded', count ? 'true' : 'false');
      toggle.innerHTML = `<i class="ph-faders-horizontal me-2"></i>Filters${count ? `<span class="badge bg-primary ms-2">${count}</span>` : ''}`;
      if (advancedGroups.length) toolbar.appendChild(toggle);

      if (pageSizeGroup) {
        pageSizeGroup.className = 'crm-filter-page-size';
        const label = pageSizeGroup.querySelector('.form-label');
        if (label) label.textContent = 'Rows';
        toolbar.appendChild(pageSizeGroup);
      }

      const submit = actionGroup.querySelector('button[type="submit"]');
      if (submit) {
        submit.classList.remove('flex-fill', 'w-100');
        submit.classList.add('crm-filter-submit');
        if (!submit.querySelector('i')) submit.innerHTML = `<i class="ph-magnifying-glass me-2"></i>${submit.textContent.trim() || 'Search'}`;
        toolbar.appendChild(submit);
      }
      const clear = actionGroup.querySelector('a');
      if (clear) {
        clear.classList.add('crm-filter-clear');
        clear.setAttribute('title', 'Clear filters');
        toolbar.appendChild(clear);
      }
      actionGroup.remove();

      const setOpen = (open) => {
        advanced.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.classList.toggle('is-open', open);
      };
      setOpen(count > 0);
      toggle.addEventListener('click', () => setOpen(!advanced.classList.contains('is-open')));

      form.replaceChildren(toolbar, advanced);
      const table = form.closest('.card')?.querySelector('.table-responsive table');
      table?.classList.add('crm-compact-table');
    });
  }

  function globalSearch() {
    document.querySelectorAll('[data-crm-global-search]').forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const value = input.value.trim();
        if (!value) return;
        window.location.href = `/search/enquiries?q=${encodeURIComponent(value)}`;
      });
    });
  }


  function dashboardNewBookings() {
    const section = document.querySelector('#new-requirements-section');
    const table = document.querySelector('#dashboard_new_requirements');
    if (!section || !table) return;

    const openAndScroll = () => {
      table.classList.add('show');
      window.setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      window.setTimeout(() => section.classList.add('crm-panel-highlight'), 160);
      window.setTimeout(() => section.classList.remove('crm-panel-highlight'), 1400);
    };

    if (window.location.hash === '#new-requirements-section' || window.location.hash === '#dashboard_new_requirements') {
      openAndScroll();
    }

    document.querySelectorAll('[data-crm-scroll-target="#new-requirements-section"]').forEach((trigger) => {
      trigger.addEventListener('click', () => {
        window.setTimeout(openAndScroll, 80);
      });
    });
  }


  function crmTabs() {
    document.querySelectorAll('[data-crm-tabs]').forEach((container) => {
      const tabs = Array.from(container.querySelectorAll('[data-crm-tab]'));
      const panels = Array.from(container.querySelectorAll('[data-crm-tab-panel]'));
      if (!tabs.length || !panels.length) return;

      const activate = (name, updateHash = true) => {
        tabs.forEach((tab) => {
          const isActive = tab.getAttribute('data-crm-tab') === name;
          tab.classList.toggle('active', isActive);
          tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        panels.forEach((panel) => {
          panel.classList.toggle('active', panel.getAttribute('data-crm-tab-panel') === name);
        });
        if (updateHash) {
          const url = new URL(window.location.href);
          url.hash = name;
          window.history.replaceState(null, '', url.toString());
        }
      };

      tabs.forEach((tab) => {
        tab.addEventListener('click', () => activate(tab.getAttribute('data-crm-tab')));
      });

      const initial = window.location.hash ? window.location.hash.slice(1) : tabs[0].getAttribute('data-crm-tab');
      if (tabs.some((tab) => tab.getAttribute('data-crm-tab') === initial)) activate(initial, false);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    sidebar();
    submenuAccordion();
    renderBars();
    dynamicTemplateForm();
    leadCreateWizard();
    compactFilterForms();
    globalSearch();
    dashboardNewBookings();
    crmTabs();
  });
})();
