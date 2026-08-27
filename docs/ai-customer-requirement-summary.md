# AI Customer Requirement — Implementation Summary

## Status

This document records the AI-assisted customer requirement implementation prepared on the `chatgpt-dev` branches for:

- CRM: `findoly/admin-findoly-com`
- Provider Portal: `findoly/provider-findoly-com`

Tested branch heads at the time of this summary:

- CRM `chatgpt-dev`: `fce665a3174326118ec9a42c04aa6fadf9389dc4`
- Provider `chatgpt-dev`: `9e6ca1eace8a3fd932eac2a497568d2bdb65937a`

The feature is not yet merged into `dev` or `prod`.

---

## Business Workflow

The CRM validation journey remains:

1. Lead Validation
2. Lead Qualification
3. Customer Requirement
4. Journey Status
5. Sale Conversion

The existing journey states remain unchanged:

`new -> verification -> approved`

The new customer requirement step is completed after lead validation and lead qualification.

### Step 3 behavior

The CRM employee enters the customer's actual requirement in their own words.

Examples include:

- buying or sourcing a product,
- requesting a quotation with purchase intent,
- hiring a service,
- repair,
- maintenance,
- installation,
- inspection,
- rental,
- supply,
- consultation,
- or similar procurement.

The raw employee-entered requirement is stored before the OpenAI call so that an AI error or timeout does not lose the employee's work.

The employee then uses **Check with AI**.

OpenAI performs only a low-level clarity check. It does not judge commercial quality, seriousness, lead value, likelihood to purchase, category eligibility, or whether all optional details are present.

OpenAI can return only:

- `ready`
- `clarify`

There is no strict AI rejection state.

If the requirement is too unclear to describe without guessing, OpenAI returns `clarify` with a specific clarification message. Lead approval remains blocked until the employee updates the requirement and checks again.

If the requirement is clear enough, OpenAI returns `ready` with:

- a provider alert title of no more than 20 words,
- provider requirement details of no more than 100 words.

The employee may generate again or edit the generated wording before approval.

Selecting **Approve requirement & lead** saves the approved provider wording and moves the lead through the existing journey logic to Approved and existing marketplace publication.

---

## Structured OpenAI Contract

OpenAI uses the Responses API with strict JSON Schema structured output.

### Ready response

```json
{
  "schemaVersion": 1,
  "status": "ready",
  "clarificationReason": null,
  "clarificationMessage": null,
  "providerTitle": "Two CCTV cameras not working; inspection and possible replacement required",
  "providerDetails": "Customer has two CCTV cameras that are not displaying video and requires inspection. Repair is preferred, but replacement cameras may be purchased if the existing units cannot be repaired."
}
```

### Clarify response

```json
{
  "schemaVersion": 1,
  "status": "clarify",
  "clarificationReason": "missing_core_requirement",
  "clarificationMessage": "Please mention what product or service the customer needs.",
  "providerTitle": null,
  "providerDetails": null
}
```

Allowed clarification reasons:

- `missing_core_requirement`
- `ambiguous_requirement`
- `conflicting_information`
- `insufficient_context`

The CRM backend validates the response contract independently and does not trust model output blindly.

---

## Word Limits

The backend enforces:

- Provider alert title: maximum 20 words
- Provider requirement details: maximum 100 words

If model output exceeds either limit, the response is rejected.

The UI also displays live word counts to the CRM employee before approval.

---

## Privacy and Data Minimization

The AI request intentionally excludes unnecessary provider-sensitive or customer-sensitive data.

### Removed before OpenAI

Customer requirement text is redacted for:

- email addresses,
- Indian mobile numbers in common formatted forms,
- explicit budget amounts,
- INR / Rs / rupee monetary references tied to budget text.

### Excluded from qualification context

`expected_spend` is excluded from the OpenAI input.

### Provider-facing wording is rejected if it contains

- customer mobile number,
- customer email,
- budget information,
- expected-spend information.

OpenAI is also instructed not to include:

- internal scores,
- responsiveness labels,
- confidence labels,
- CRM-only notes,
- exact customer contact details.

The OpenAI request uses:

`store: false`

---

## Stored CRM Fields

The CRM Enquiry model now stores the original requirement, AI result, approved provider wording, and audit metadata.

Key fields include:

- `customerRequirementRaw`
- `providerRequirementTitle`
- `providerRequirementDetails`
- `requirementAiStatus`
- `requirementAiClarificationReason`
- `requirementAiClarificationMessage`
- `requirementAiProviderTitle`
- `requirementAiProviderDetails`
- `requirementAiSchemaVersion`
- `requirementAiSourceHash`
- `requirementAiModel`
- `requirementAiGeneratedAt`
- `requirementAiGenerationCount`
- `requirementAiApprovedAt`
- `requirementAiApprovedBy`

The existing `requirementTitle` field is preserved and remains backward compatible.

---

## Stale AI Protection

AI output is tied to a source hash generated from:

- raw customer requirement,
- category,
- selected service types,
- validation context,
- qualification context excluding expected spend.

The AI result is invalidated if relevant source data changes before final approval.

Changes that invalidate the generated wording include:

- raw customer requirement,
- validation answers,
- qualification answers,
- category,
- service types.

The employee must run the AI check again before approval.

---

## Approval Gate

The backend centrally blocks a move to `approved` unless the new provider requirement has been approved.

The requirement approval action:

1. validates the AI result is `ready`,
2. verifies the source hash is still current,
3. validates the final 20-word and 100-word limits,
4. validates privacy rules,
5. stores approved provider wording,
6. records approval metadata,
7. moves the existing journey from New to Verification if required,
8. moves Verification to Approved,
9. invokes the existing marketplace publication behavior.

Existing customer mobile verification preparation/rollback behavior is preserved.

---

## Provider Alert Behavior

The communication variable `requirement_title` now prefers:

`providerRequirementTitle -> requirementTitle -> serviceType`

This preserves compatibility with old enquiries.

The current Meta template itself was not modified by this implementation.

The intended first alert uses the approved maximum-20-word provider requirement title.

---

## Provider Marketplace and Unlock Privacy

Both CRM and Provider Portal use the shared MongoDB `enquiries` collection.

The Provider Portal marketplace projection includes:

- `providerRequirementTitle`

The marketplace projection intentionally excludes:

- `providerRequirementDetails`

This means the short requirement can be used before unlock, while the full maximum-100-word provider details remain hidden.

After successful provider unlock, the Provider Portal exposes:

- `providerRequirementDetails`

The provider lead detail UI shows the approved long requirement only after unlock.

The WhatsApp View Enquiry / unlock response also includes the approved long requirement when available.

---

## Legacy Lead Compatibility

Older enquiries that do not have the new AI fields continue to work.

Fallback behavior remains:

`providerRequirementTitle -> requirementTitle -> existing service title fallback`

Existing approved leads remain approved even if they pre-date this feature.

The CRM UI explicitly shows that AI requirement wording was not captured for such historical approved leads, without changing their provider access.

---

## OpenAI Configuration

CRM deployment requires:

- `CRM_OPENAI_API_KEY`
- `CRM_OPENAI_MODEL`
- `CRM_OPENAI_REASONING_EFFORT`
- `CRM_OPENAI_TIMEOUT_MS`

Defaults currently used by the implementation:

- model: `gpt-5.6-luna`
- timeout: `8000` ms

The implementation follows the same OpenAI Responses API / strict JSON Schema pattern already used in `findoly/findoly-com`.

If `CRM_OPENAI_API_KEY` is missing, the employee's raw requirement remains saved, but the AI action returns a controlled configuration error and approval cannot proceed.

---

## CRM Files Changed

`findoly/admin-findoly-com`:

- `controllers/enquiryController.js`
- `models/Enquiry.js`
- `routes/enquiry.js`
- `services/communication/notification-service.js`
- `services/communication/provider-whatsapp-action-service.js`
- `services/communication/system-event-service.js`
- `services/enquiry/enquiry-service.js`
- `services/lead-qualification/lead-qualification-service.js`
- `services/lead-validation/lead-validation-service.js`
- `services/requirement-ai/requirement-ai-service.js`
- `test/requirement-ai-contract.test.js`
- `utils/runtime-config.js`
- `views/enquiry/show.ejs`

---

## Provider Files Changed

`findoly/provider-findoly-com`:

- `services/lead/lead-service.js`
- `services/marketplace/marketplace-service.js`
- `test/provider-requirement-wording.test.js`
- `utils/lead.js`
- `views/lead/show.ejs`

---

## Preservation Scope

The implementation preserves:

- existing lead validation questionnaire,
- existing six-question lead qualification,
- Lead Price calculation,
- Intent calculation,
- Priority calculation,
- category maximum-price behavior,
- provider unlock charging,
- provider unlock limits,
- marketplace publication flow,
- customer contact unlock behavior,
- customer mobile verification flow,
- existing journey states,
- existing Meta template,
- existing `requirementTitle`,
- existing provider fallback behavior,
- current design system and page structure.

No pricing or qualification formula was changed.

---

## QA Summary

The final executable QA re-run on the current `chatgpt-dev` heads passed.

### Layer 1 — Standard QA

PASS:

- modified JavaScript syntax,
- CRM embedded `leadShow()` script,
- Provider embedded `leadShow()` script,
- strict `ready` / `clarify` schema,
- clarify null-field contract,
- 20-word title limit,
- 100-word details limit,
- mobile-number protection,
- email protection,
- budget / expected-spend output protection,
- unexpected field rejection,
- low-level clarity prompt behavior.

### Layer 2 — Deep Regression QA

PASS:

- validation question source unchanged,
- existing default Meta template unchanged,
- qualification scoring source unchanged.

Exhaustive qualification comparison against production:

- answer combinations checked: **11,520**
- Lead Price / Intent / Priority differences: **0**

### Layer 3 — Practical Integration QA

PASS:

- raw requirement persisted before AI call,
- contact information redacted before OpenAI,
- budget amount redacted before OpenAI,
- expected spend excluded from AI context,
- strict JSON Schema enabled,
- `store: false`,
- New -> Verification -> Approved flow,
- shared MongoDB enquiry field compatibility,
- short title available to provider marketplace,
- long requirement hidden before unlock,
- long requirement available after unlock,
- WhatsApp View Enquiry uses long requirement,
- legacy approved lead compatibility,
- timeout cleanup,
- customer mobile verification rollback when final approval transition fails.

### QA environment limitation

GitHub branch heads currently have no configured status checks or workflow runs.

A full fresh local repository clone and full `npm test` / production QA run could not be executed in the container because DNS resolution for `github.com` remains unavailable.

This limitation is environmental and is recorded rather than being reported as a full local test-suite pass.

---

## Tested Branch Heads

At summary creation time:

### CRM

Branch:

`chatgpt-dev`

Tested feature head before this documentation commit:

`fce665a3174326118ec9a42c04aa6fadf9389dc4`

### Provider Portal

Branch:

`chatgpt-dev`

Tested feature head:

`9e6ca1eace8a3fd932eac2a497568d2bdb65937a`

No merge to `dev` or `prod` is represented by this document.
