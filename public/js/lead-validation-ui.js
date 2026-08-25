(function () {
  'use strict';

  const path = window.location.pathname.replace(/\/$/, '');
  const match = path.match(/^\/enquiries\/([^/]+)$/);
  if (!match) return;

  const enquiryId = decodeURIComponent(match[1]);

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({ success: false, message: 'Invalid server response' }));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Request failed');
    return body;
  }

  function humanize(value) {
    return String(value || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function findEditableContainer(card) {
    return [...card.children].find((element) =>
      element.getAttribute && element.getAttribute('x-show') === '!providerControlled'
    ) || null;
  }

  function findActionCard(title) {
    return [...document.querySelectorAll('.crm-lead-action-card')].find((card) =>
      card.querySelector('h3')?.textContent?.trim() === title
    ) || null;
  }

  function syncQualificationGate(validation = {}) {
    const questionnaireReady = validation.completed === true && validation.final?.decision === 'valid';
    const card = findActionCard('Lead qualification');
    if (!card || questionnaireReady) return;

    card.classList.remove('is-required', 'is-complete');
    card.classList.add('is-locked');

    const editable = [...card.children].find((element) =>
      element.getAttribute && element.getAttribute('x-show') === 'validationReady && !providerControlled'
    );
    if (editable) editable.style.setProperty('display', 'none', 'important');

    const existingWarning = card.querySelector('[data-validation-questionnaire-gate]');
    if (existingWarning) return;

    const warning = document.createElement('div');
    warning.dataset.validationQuestionnaireGate = 'true';
    warning.className = 'crm-action-lock crm-action-lock-warning';
    warning.innerHTML = '<strong>Complete the validation questionnaire first</strong><span>Finish Step 1 with a final Valid decision before calculating lead price, intent and priority.</span>';
    if (editable) card.insertBefore(warning, editable);
    else card.appendChild(warning);
  }

  function decisionClass(decision) {
    if (decision === 'valid') return 'alert-success';
    if (decision === 'invalid') return 'alert-danger';
    return 'alert-warning';
  }

  function render(container, state) {
    const validation = state.validation || {};
    const answers = state.answers || {};
    const system = state.system || null;
    const finalDecision = state.finalDecision || '';
    const questions = Array.isArray(validation.questions) ? validation.questions : [];
    const reasons = Array.isArray(system?.reasons) ? system.reasons : [];
    const manualReasonRequired = system && (system.decision === 'needs_review' || (finalDecision && finalDecision !== system.decision));

    container.innerHTML = `
      <div data-lead-validation-questionnaire>
        <p class="crm-action-help mb-3">Answer each validation check. The CRM decides the system result from these answers; you can review and change the final decision before saving.</p>
        <div data-validation-questions>
          ${questions.map((question) => `
            <div class="mb-3">
              <label class="form-label" for="validation-${escapeHtml(question.id)}">${escapeHtml(question.prompt)}</label>
              <select class="form-select" id="validation-${escapeHtml(question.id)}" data-validation-answer="${escapeHtml(question.id)}" ${state.saving ? 'disabled' : ''}>
                <option value="">Select an answer</option>
                ${(question.options || []).map((option) => `
                  <option value="${escapeHtml(option.id)}" ${answers[question.id] === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                `).join('')}
              </select>
            </div>
          `).join('')}
        </div>

        ${state.previewing ? '<div class="text-muted mb-3">Checking validation result…</div>' : ''}

        ${system ? `
          <div class="alert ${decisionClass(system.decision)} mb-3">
            <div class="fw-semibold">System decision: ${escapeHtml(humanize(system.decision))}</div>
            <div class="small mt-1">${reasons.map(escapeHtml).join(' · ')}</div>
          </div>

          <div class="mb-3">
            <label class="form-label" for="validation-final-decision">Final employee decision</label>
            <select class="form-select" id="validation-final-decision" data-validation-final ${state.saving ? 'disabled' : ''}>
              <option value="">Select final decision</option>
              <option value="valid" ${finalDecision === 'valid' ? 'selected' : ''}>Valid</option>
              <option value="invalid" ${finalDecision === 'invalid' ? 'selected' : ''}>Invalid</option>
            </select>
            <div class="form-text">The system recommendation is kept in history even when the final decision is changed.</div>
          </div>
        ` : ''}

        <div class="mb-3">
          <label class="form-label" for="validation-method">Validation method</label>
          <select class="form-select" id="validation-method" data-validation-method ${state.saving ? 'disabled' : ''}>
            <option value="">Select how the lead was validated</option>
            <option value="phone_call" ${state.method === 'phone_call' ? 'selected' : ''}>Phone call</option>
            <option value="whatsapp" ${state.method === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
            <option value="email" ${state.method === 'email' ? 'selected' : ''}>Email</option>
            <option value="in_person" ${state.method === 'in_person' ? 'selected' : ''}>In person</option>
            <option value="other" ${state.method === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </div>

        ${manualReasonRequired ? `
          <div class="mb-3">
            <label class="form-label" for="validation-override-reason">${system.decision === 'needs_review' ? 'Final decision reason' : 'Override reason'}</label>
            <textarea class="form-control" rows="2" maxlength="1000" id="validation-override-reason" data-validation-override-reason placeholder="Explain why this final decision is appropriate" ${state.saving ? 'disabled' : ''}>${escapeHtml(state.overrideReason || '')}</textarea>
            <div class="form-text">Required because the CRM could not decide automatically or because the system decision is being changed.</div>
          </div>
        ` : ''}

        <div class="mb-3">
          <label class="form-label" for="validation-note">Validation note ${state.method === 'other' ? '(required)' : '(optional)'}</label>
          <textarea class="form-control" rows="2" maxlength="2000" id="validation-note" data-validation-note placeholder="Add a short validation note, if useful" ${state.saving ? 'disabled' : ''}>${escapeHtml(state.note || '')}</textarea>
        </div>

        <button type="button" class="btn btn-primary w-100" data-validation-save ${state.saving || !system || !finalDecision || !state.method ? 'disabled' : ''}>
          ${state.saving ? 'Saving…' : validation.completed ? 'Update validation' : 'Save validation'}
        </button>
        ${validation.completedAt ? `<p class="crm-action-help mb-0 mt-2">Last saved ${escapeHtml(new Date(validation.completedAt).toLocaleString('en-IN'))}${validation.completedBy ? ` by ${escapeHtml(validation.completedBy)}` : ''}.</p>` : ''}
        <div class="text-danger small mt-2" data-validation-error>${escapeHtml(state.error || '')}</div>
      </div>
    `;

    container.querySelectorAll('[data-validation-answer]').forEach((select) => {
      select.addEventListener('change', async (event) => {
        state.answers[event.target.dataset.validationAnswer] = event.target.value;
        await previewIfComplete(container, state);
      });
    });

    container.querySelector('[data-validation-final]')?.addEventListener('change', (event) => {
      state.finalDecision = event.target.value;
      state.overrideReason = '';
      render(container, state);
    });
    container.querySelector('[data-validation-method]')?.addEventListener('change', (event) => {
      state.method = event.target.value;
      render(container, state);
    });
    container.querySelector('[data-validation-override-reason]')?.addEventListener('input', (event) => {
      state.overrideReason = event.target.value;
    });
    container.querySelector('[data-validation-note]')?.addEventListener('input', (event) => {
      state.note = event.target.value;
    });
    container.querySelector('[data-validation-save]')?.addEventListener('click', () => saveValidation(container, state));
  }

  function answersComplete(state) {
    const questions = Array.isArray(state.validation?.questions) ? state.validation.questions : [];
    return questions.length === 5 && questions.every((question) => Boolean(state.answers?.[question.id]));
  }

  async function previewIfComplete(container, state) {
    state.system = null;
    state.finalDecision = '';
    state.overrideReason = '';
    if (!answersComplete(state)) {
      render(container, state);
      return;
    }
    state.previewing = true;
    state.error = '';
    render(container, state);
    try {
      const body = await request(`/api/enquiry/${encodeURIComponent(enquiryId)}/validation/preview`, {
        method: 'POST',
        body: JSON.stringify({ answers: state.answers })
      });
      state.system = body.data?.system || null;
      state.finalDecision = ['valid', 'invalid'].includes(state.system?.decision) ? state.system.decision : '';
    } catch (error) {
      state.error = error.message;
    } finally {
      state.previewing = false;
      render(container, state);
    }
  }

  async function saveValidation(container, state) {
    state.error = '';
    const requiresReason = state.system?.decision === 'needs_review'
      || state.finalDecision !== state.system?.decision;
    if (requiresReason && !String(state.overrideReason || '').trim()) {
      state.error = state.system?.decision === 'needs_review'
        ? 'Enter a reason for the final decision.'
        : 'Enter an override reason before changing the system decision.';
      render(container, state);
      return;
    }
    if (state.method === 'other' && !String(state.note || '').trim()) {
      state.error = 'Describe how the lead was validated when using Other.';
      render(container, state);
      return;
    }

    state.saving = true;
    render(container, state);
    try {
      await request(`/api/enquiry/${encodeURIComponent(enquiryId)}/referral-validation`, {
        method: 'POST',
        body: JSON.stringify({
          answers: state.answers,
          finalDecision: state.finalDecision,
          method: state.method,
          note: state.note,
          overrideReason: state.overrideReason
        })
      });
      window.location.reload();
    } catch (error) {
      state.error = error.message;
      state.saving = false;
      render(container, state);
    }
  }

  async function init() {
    const card = document.querySelector('.crm-validation-action');
    if (!card) return;
    const container = findEditableContainer(card);
    if (!container || container.dataset.validationQuestionnaireMounted === 'true') return;
    container.dataset.validationQuestionnaireMounted = 'true';
    container.innerHTML = '<div class="text-muted">Loading validation questionnaire…</div>';

    try {
      const body = await request(`/api/enquiry/${encodeURIComponent(enquiryId)}/validation`);
      const validation = body.data || {};
      syncQualificationGate(validation);
      const state = {
        validation,
        answers: { ...(validation.answers || {}) },
        system: validation.system || null,
        finalDecision: validation.final?.decision || '',
        method: validation.method || '',
        note: validation.note || '',
        overrideReason: validation.overrideReason || '',
        previewing: false,
        saving: false,
        error: ''
      };
      render(container, state);
      if (!state.system && answersComplete(state)) await previewIfComplete(container, state);
    } catch (error) {
      container.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message)}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.setTimeout(init, 0), { once: true });
  } else {
    window.setTimeout(init, 0);
  }
})();
