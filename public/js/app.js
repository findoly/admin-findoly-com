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
          : `<div class="alert alert-warning">No matching template found. You can still save core enquiry details and add a template later. <a target="_blank" href="${schemaUrl}">Check schema API</a></div>`;
      }
      if (!fields.length) {
        target.innerHTML = '<div class="text-muted">No template fields configured for this website/category/form type. You can still save the enquiry with notes.</div>';
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

  function fieldBuilder() {
    document.querySelectorAll('[data-field-builder]').forEach((form) => {
      const rows = form.querySelector('[data-builder-rows]');
      const hidden = form.querySelector('[data-fields-json]');
      const addButton = form.querySelector('[data-add-field]');
      const preview = form.querySelector('[data-schema-preview]');
      if (!rows || !hidden || !addButton) return;
      const fieldTypes = readJsonScript('#field-types-json', ['text', 'textarea', 'number', 'select', 'radio', 'checkbox', 'date', 'datetime-local', 'email', 'tel', 'url', 'file_url']);

      const defaultFields = [
        { name: 'requirement', label: 'Requirement', type: 'textarea', required: true, options: '', group: 'Requirement', placeholder: 'Describe customer requirement' },
        { name: 'budget', label: 'Budget', type: 'number', required: false, options: '', group: 'Commercials', placeholder: 'Approximate budget' },
        { name: 'photos', label: 'Photo / file URL', type: 'file_url', required: false, options: '', group: 'Attachments', placeholder: 'https://...' }
      ];
      const starter = form.dataset.emptyBuilder === 'true' ? [] : defaultFields;
      const existing = form.getAttribute('data-existing-fields');
      let initialFields = starter;
      if (existing) {
        try { initialFields = JSON.parse(existing); } catch (error) { initialFields = starter; }
      }

      const sync = () => {
        const fields = Array.from(rows.querySelectorAll('.crm-field-builder-row')).map((row) => ({
          label: row.querySelector('[data-field-label]').value.trim(),
          name: slugify(row.querySelector('[data-field-name]').value || row.querySelector('[data-field-label]').value),
          type: row.querySelector('[data-field-type]').value,
          required: row.querySelector('[data-field-required]').checked,
          options: row.querySelector('[data-field-options]').value.split(',').map((item) => item.trim()).filter(Boolean),
          group: row.querySelector('[data-field-group]').value.trim() || 'Details',
          placeholder: row.querySelector('[data-field-placeholder]').value.trim(),
          helpText: row.querySelector('[data-field-help]').value.trim()
        })).filter((field) => field.name && field.label);
        hidden.value = JSON.stringify(fields);
        if (preview) preview.textContent = JSON.stringify({ fields }, null, 2);
      };

      const addRow = (field = {}) => {
        const row = document.createElement('div');
        row.className = 'crm-field-builder-row';
        row.innerHTML = `
          <div class="row g-3 align-items-end">
            <div class="col-lg-3"><label class="form-label">Field label</label><input class="form-control" data-field-label placeholder="Requirement" value="${escapeHtml(field.label || '')}"></div>
            <div class="col-lg-2"><label class="form-label">Field key</label><input class="form-control" data-field-name placeholder="requirement" value="${escapeHtml(field.name || '')}"></div>
            <div class="col-lg-2"><label class="form-label">Type</label><select class="form-select" data-field-type>${fieldTypes.map((type) => `<option value="${escapeHtml(type)}" ${field.type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select></div>
            <div class="col-lg-2"><label class="form-label">Section</label><input class="form-control" data-field-group placeholder="Details" value="${escapeHtml(field.group || 'Details')}"></div>
            <div class="col-lg-2"><label class="form-label">Placeholder</label><input class="form-control" data-field-placeholder placeholder="Shown in form" value="${escapeHtml(field.placeholder || '')}"></div>
            <div class="col-lg-1"><button class="btn btn-danger w-100" type="button" data-remove-field><i class="ph-trash"></i></button></div>
            <div class="col-lg-3"><label class="form-check mt-2"><input class="form-check-input" data-field-required type="checkbox" ${field.required ? 'checked' : ''}><span class="form-check-label">Required</span></label></div>
            <div class="col-lg-4"><label class="form-label">Options</label><input class="form-control" data-field-options placeholder="Small, Medium, Large" value="${escapeHtml(Array.isArray(field.options) ? field.options.join(', ') : field.options || '')}"><div class="form-text">For select, radio and checkbox fields.</div></div>
            <div class="col-lg-5"><label class="form-label">Help text</label><input class="form-control" data-field-help placeholder="Help text shown to admin / website" value="${escapeHtml(field.helpText || field.help || '')}"></div>
          </div>
        `;
        rows.appendChild(row);
        row.querySelector('[data-remove-field]').addEventListener('click', () => { row.remove(); sync(); });
        row.querySelectorAll('input, select').forEach((input) => input.addEventListener('input', sync));
        row.querySelector('[data-field-label]').addEventListener('input', (event) => {
          const nameInput = row.querySelector('[data-field-name]');
          if (!nameInput.value.trim()) nameInput.value = slugify(event.target.value);
        });
        sync();
      };

      addButton.addEventListener('click', () => addRow({ type: 'text', group: 'Details' }));
      initialFields.forEach(addRow);
      if (!initialFields.length) addRow({ type: 'text', group: 'Details' });
      form.addEventListener('submit', sync);
      sync();
    });
  }

  function autoslugCategory() {
    document.querySelectorAll('[data-autoslug-source]').forEach((input) => {
      const target = document.querySelector(input.dataset.autoslugSource);
      input.addEventListener('input', () => {
        if (target && !target.value.trim()) target.value = slugify(input.value);
      });
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
    const section = document.querySelector('#new-bookings-section');
    const table = document.querySelector('#dashboard_new_bookings');
    if (!section || !table) return;

    const openAndScroll = () => {
      table.classList.add('show');
      window.setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      window.setTimeout(() => section.classList.add('crm-panel-highlight'), 160);
      window.setTimeout(() => section.classList.remove('crm-panel-highlight'), 1400);
    };

    if (window.location.hash === '#new-bookings-section' || window.location.hash === '#dashboard_new_bookings') {
      openAndScroll();
    }

    document.querySelectorAll('[data-crm-scroll-target="#new-bookings-section"]').forEach((trigger) => {
      trigger.addEventListener('click', () => {
        window.setTimeout(openAndScroll, 80);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    sidebar();
    submenuAccordion();
    renderBars();
    dynamicTemplateForm();
    fieldBuilder();
    autoslugCategory();
    globalSearch();
    dashboardNewBookings();
  });
})();
