# Service CRM Admin

A simple Express, EJS and Alpine.js CRM that shares MongoDB with the provider portal.

## Required code flow

```text
/frontend or normal browser URL
  -> routes/frontend.js
  -> render an EJS page shell only
  -> Alpine.js fetches /api/*
  -> API controller
  -> small service
  -> simple Mongoose model
  -> MongoDB
```

Frontend routes do not query MongoDB and do not pass lead, provider, provider-unlock, follow-up, communication, invoice, or dashboard records into EJS. EJS receives only page-title metadata. Alpine reads route IDs and query filters from `window.location`.

Each page is a complete EJS document. Only these structural partials are shared:

```text
head.ejs
navbar.ejs
sidebar.ejs
footer.ejs
scripts.ejs
```

There are no body/content partials, repository layer, model factory, `models/index.js`, `populate()` calls, or server-rendered database records.

All application modules use `module.exports`.

## Main folders

```text
routes/frontend.js       browser pages
routes/main.js           /api JSON router
controllers/             HTTP input/output only
services/                simple business operations
models/                  simple denormalized schemas
views/                   complete Alpine.js pages
scripts/migrate-structure.js
```

## IDs and collections

MongoDB keeps its own `_id`. The migration never changes existing `_id` or existing `id` fields.

Application queries use one named identifier per collection:

| Collection | Application identifier |
|---|---|
| `categories` | `categoryId` |
| `enquiries` | `enquiryId` |
| `providers` | `providerId` |
| `providerleadunlocks` | `providerLeadUnlockId` |
| `wallettransactions` | `walletTransactionId` |
| `paymentorders` | `paymentOrderId` |
| `followups` | `followUpId` |
| `communications` | `communicationId` |
| `invoices` | `invoiceId` |
| `formtemplates` | `formTemplateId` |
| `crmemployees` | `employeeId` |
| `crmroles` | `roleId` |

New values are plain UUID v4 values with hyphens removed:

```text
6f6fb7f73593409898de8c18808ae3b1
```

They are exactly 32 hexadecimal characters with no collection prefix.

## Simple denormalized lead model

```json
{
  "enquiryId": "6f6fb7f73593409898de8c18808ae3b1",
  "name": "Customer name",
  "mobile": "9000000000",
  "email": "customer@example.com",
  "addressLine": "Flat 10, Main Road",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "category": "Painting",
  "categorySlug": "painting",
  "requirementTitle": "Paint 2 BHK",
  "status": "approved",
  "leadPricePaise": 15000,
  "additionalDetails": {}
}
```

The application services query only named ID fields. Legacy nested documents are flattened by the one-time migration instead of adding fallback queries to every service.

## Install and migrate

Use Node.js 20 or newer. The locked AWS SES SDK requires Node.js 20+.

```bash
cp .env.example .env
npm install
npm run migrate:structure
npm start
```

`migrate:structure` is the pre-production cutover command. It:

- preserves existing MongoDB `_id` and application IDs;
- normalizes lead search fields and marketplace counters in bounded batches;
- automatically publishes eligible approved leads without provider fan-out;
- removes obsolete Lead Intent and distribution fields; and
- drops the obsolete `leaddistributions` collection.

This migration is intentionally incompatible with the old distribution design and should be run only after a backup.

## CRM employee login, roles and permissions

CRM username/password authentication has been removed. Employees sign in only with a registered Indian mobile number and OTP.

The browser always calls the CRM application host:

```text
POST /api/auth/send-otp
POST /api/auth/verify-otp
```

The CRM server then makes server-side requests to the Findoly OTP service:

```text
POST https://api.findoly.com/otp/send-otp
POST https://api.findoly.com/otp/verify-otp
```

Verification sends only:

```json
{
  "mobile": "9000000000",
  "otp": "1234"
}
```

Successful verification creates a signed, HTTP-only cookie session valid for 24 hours. In production the cookie is also marked `Secure` and uses `SameSite=Lax`. Set a strong `AUTH_COOKIE_SECRET`; old `ADMIN_EMAIL` and `ADMIN_PASSWORD` variables are not used.

### First Super Admin setup

Set these values before the first login:

```env
AUTH_COOKIE_SECRET=replace-with-at-least-32-random-characters
CRM_BOOTSTRAP_MOBILE=9000000000
CRM_BOOTSTRAP_NAME=CRM Administrator
CRM_OTP_BASE_URL=https://api.findoly.com/otp
CRM_OTP_RESEND_SECONDS=30
CRM_OTP_MAX_SENDS_PER_MINUTE=2
CRM_OTP_RATE_WINDOW_SECONDS=60
```

When `crmemployees` is empty, only the configured bootstrap mobile may request CRM login. After its OTP is successfully verified, the CRM creates the initial Super Admin employee and the default roles. Remove `CRM_BOOTSTRAP_MOBILE` from the environment after first setup if desired.

Administrators can then use **Employees** and **Roles & permissions** to:

- create and activate/deactivate employee profiles
- assign default or custom roles
- grant page and action permissions
- revoke access immediately by deactivating an employee or role

Protected pages and JSON APIs both enforce permissions. Employee and role changes take effect on the employee's next request, even when an older 24-hour cookie still exists.

### CRM login OTP request protection

The browser does not enforce a countdown or request quota. The CRM server stores OTP send limits in MongoDB so the policy works across browser refreshes, application restarts and multiple application instances. By default, a mobile number may request at most two OTPs in a 60-second window, with at least 30 seconds between requests. When blocked, the API returns HTTP `429`, a `Retry-After` header and a customer-facing message containing the exact remaining wait in seconds. OTP verification has no CRM-side rate limiter; any verification restrictions returned by the Findoly OTP service are passed through as clear messages.

### Appearance themes

The original appearance remains the default. Six additional optional presets are available: Soft Blue, Soft Green, Soft Purple, Soft Peach, Soft Grey and Soft Orange. The selected theme is saved per employee profile in that browser and does not modify the Findoly logo, fonts or layout.

## Frontend and API examples

```text
GET  /enquiries             renders an EJS shell only
GET  /api/enquiry           returns JSON list
GET  /api/enquiry/:id       returns JSON record
POST /api/enquiry           creates a record
PUT  /api/enquiry/:id       updates a record
```

Public website intake aliases remain JSON endpoints:

```text
POST /api/enquiries
POST /api/requirements
POST /api/leads
```

## Validation

```bash
# Dependency-free syntax, EJS, route, view and lock-file checks
npm run qa:static

# Critical regression tests that can run before external services are configured
npm run qa:critical

# Runs both commands above
npm run qa:production

# Run after npm install for the complete project test suite
npm run check
npm test
```

## CRM UI restoration

The CRM frontend keeps the Alpine.js + JSON API separation while restoring the polished admin interface:

- compact page headers and contextual actions
- visible sidebar icons and responsive navigation
- compact expandable requirement filters
- dashboard metric cards, recent requirements and quick actions
- provider directory with category, access and wallet summaries
- loading, empty and pagination states
- compatibility display IDs for legacy records that still use `id`

## Agent Portal integration

The CRM now includes minimal agent management at `/agents`:

- CRM administrators create individual or shop agents.
- Each agent receives one immutable 32-character `agentId` and one immutable 6-character uppercase alphanumeric `referralId`.
- Each agent is assigned exactly one active category and an OTP login mobile number.
- Agent-submitted requirements are written to the shared `enquiries` collection with a denormalized agent snapshot and customer-mobile OTP verification fields.
- CRM lists and details render through Alpine.js JSON API calls. No Mongoose `populate()` or MongoDB `$lookup` is used.

## Partner referral payouts

Every lead now requires CRM lead validation (`pending`, `valid`, or `invalid`) before an employee can move it through the journey or publish it to the marketplace. Employees must record whether validation happened by phone call, WhatsApp, email, in person, or another method; choosing Other requires an explanation. Invalid leads are automatically rejected before marketplace publication. Agent Portal partner withdrawals continue to use only valid matured referrals at least 14 days old, complete blocks of 10, and a minimum 20% sale conversion. Configure each agent's ₹50–₹200 rate and verified RazorpayX fund account in the CRM agent profile.

Set the RazorpayX values from `.env.example`, allowlist the CRM server IP in RazorpayX, and configure the payout webhook URL as `/api/webhooks/razorpay/payouts`. Run `npm run migrate:agent-payouts` once for existing Agent Portal requirements.

## Communication Center

The Communication Center is intentionally split by channel so employees do not need to work through one mixed configuration screen.

```text
/communications/whatsapp                 WhatsApp overview
/communications/whatsapp/templates       Gupshup templates
/communications/whatsapp/automations     WhatsApp automations
/communications/whatsapp/logs            WhatsApp message logs
/whatsapp-inbox                           standalone customer inbox

/communications/email                    Email overview
/communications/email/internal-alerts    Internal operational alerts
/communications/email/templates          Amazon SES templates
/communications/email/automations        Email automations
/communications/email/logs               Email message logs

/communications/otp                      OTP activity
```

The active channels are:

- **WhatsApp:** Gupshup template synchronization, automated template messages, delivery/read/failure status, inbound messages and the standalone WhatsApp Inbox.
- **Email:** Amazon SES templates, automatic internal alerts, event automations, test sending and SES delivery/bounce/complaint history.
- **OTP:** request and verification activity with hashed OTP storage, expiry, resend cooldown and attempt limits.

Slack is not an active delivery channel. Historical Slack Communication rows are preserved for audit, but Slack services, channel synchronization, sending controls and rule execution have been removed.

### Automatic internal email alerts

The CRM sends operational alerts through Amazon SES to the fixed recipient configured by:

```env
INTERNAL_ALERT_EMAIL=alert@findoly.com
INTERNAL_ALERT_EMAIL_ENABLED=true
```

Employees can enable or disable each alert, select its template, edit the template, send a test and open filtered logs from **Communication Center → Email → Internal alerts**.

System-managed events are:

```text
lead_created                         CRM lead created
partner_lead_submitted               Partner lead submitted
agent_created                        Partner account created
provider_join_request_submitted      Provider joining request submitted
provider_created                     Provider account created
```

The internal recipient is read-only in the UI. Messages exclude customer mobile numbers, customer email addresses, full street addresses, OTPs and credentials. Each automatic alert uses a deterministic idempotency key so repeated integration requests do not create duplicate emails.

### Public and integration endpoints

```text
POST /api/communication/otp/send
POST /api/communication/otp/verify
GET  /api/webhooks/whatsapp
POST /api/webhooks/whatsapp
POST /api/webhooks/ses
POST /api/webhooks/message-delivery
POST /api/communication/events/:event
```

Protect `/api/communication/events/:event` with `COMMUNICATION_EVENT_API_TOKEN` and send the token in `x-communication-token` or `Authorization: Bearer <token>`.

### Partner and Provider event reliability

The Partner Portal sends `partner_lead_submitted` from its transactional outbox after a requirement commits. The Provider Portal sends `provider_join_request_submitted` from its own transactional outbox after a joining request commits. CRM loads the authoritative database record and sends the configured SES internal alert.

A temporary CRM, network or immediate SES delivery failure does not roll back the submitted lead or joining request. The portal outbox keeps retrying with an atomic lease and deterministic event identity. If an internal alert is deliberately disabled in Communication Center, CRM acknowledges the event without sending email.

Provider access and feedback integrations continue to use:

```text
provider_lead_unlocked
provider_feedback_updated
```

Provider sale outcomes and status updates remain synchronized independently from the new internal operational alerts.

### Gupshup WhatsApp setup

1. Configure the Gupshup API key, app ID, app name, source number and webhook token.
2. Configure the callback URL as `/api/webhooks/whatsapp?token=<CRM_GUPSHUP_WEBHOOK_TOKEN>`.
3. Synchronize approved templates from **Communication Center → WhatsApp → Templates**.
4. Configure event mappings from **WhatsApp → Automations**.
5. Use the standalone `/whatsapp-inbox` page for two-way customer conversations.

### Amazon SES setup

1. Verify `SES_FROM_EMAIL` or its domain in the configured AWS Region.
2. Use an IAM role in production, or local AWS credentials only during development.
3. Configure `SES_CONFIGURATION_SET` and an SNS event destination pointing to `/api/webhooks/ses`.
4. Keep bounce and complaint monitoring enabled.
5. Confirm `INTERNAL_ALERT_EMAIL=alert@findoly.com`, then use **Send test** for every internal alert.

### Retention

`communications` and OTP activity use MongoDB TTL indexes. With the default values, both are deleted after seven days; cleanup is asynchronous. Templates, rules, internal-alert settings, leads and audit notes are not affected.

```env
COMMUNICATION_LOG_RETENTION_DAYS=7
OTP_RETENTION_DAYS=7
```

### Removing legacy Slack rule configuration

After deploying the email-based Communication Center, run:

```bash
npm run migrate:remove-slack-rules -- --dry-run
npm run migrate:remove-slack-rules
```

This clears deprecated Slack fields from existing rules. It does not delete rules and does not delete historical Slack Communication records. Obsolete Slack environment variables can be removed from Secrets Manager after verification.

## Provider portal synchronization

The Provider Portal and CRM share compatible `enquiries`, `providerleadunlocks`, `providers`, `paymentorders`, and credit collections. Provider-to-CRM delivery is persisted separately in the Provider Portal-owned `providercrmsyncevents` transactional outbox. CRM approval publishes the enquiry directly; provider eligibility does not create database records. One compact unlock record is created only after a provider unlocks.
Provider feedback events include a monotonic per-unlock sequence; stale or unsequenced replays are accepted as no-ops once sequencing is active.

Provider browsers call only the Provider Portal host. The Provider backend notifies CRM through:

```text
POST /api/communication/events/provider_lead_unlocked
POST /api/communication/events/provider_feedback_updated
```

Both services must share `COMMUNICATION_EVENT_API_TOKEN`. The Provider Portal persists every CRM event in a transactional outbox, retries with an atomic lease and exponential backoff, moves exhausted events to dead-letter state, and expires successful rows after retention; CRM communication processing remains idempotent by outbox event ID. Provider confirmation-email failures are logged independently and never roll back a committed lead action. Provider joining requests use a separate durable outbox to trigger the CRM internal SES alert. See `PROVIDER_CRM_SYNC_SETUP.md` for coordinated deployment, retry and reservation-cleanup instructions.

## Scalable marketplace maintenance

Approved Valid leads are stored once in `enquiries`; provider-specific `providerleadunlocks` rows are created only after a successful unlock. Filtered CRM dashboard metrics use bounded counts and a short cache rather than repeated exact scans. Run the following CRM cleanup every five minutes to retire expired marketplace records in indexed batches:

```bash
npm run cleanup:marketplace-leads
```

The Provider Portal must separately run `npm run cleanup:lead-reservations` every five minutes. MongoDB Atlas or another replica set is mandatory because credit unlocks, direct-payment reservations and outcome counters use transactions.

## Nearby provider marketplace deployment

Configure `GOOGLE_MAPS_API_KEY` in both CRM and provider portal. CRM geocodes lead/provider PIN codes and publishes radius-based visibility. For existing data, run once after deployment:

```bash
npm run migrate:marketplace-location
```

The script keeps existing lead/provider records intact and caches PIN-code coordinates used by bounded marketplace distance checks.

## Partner multiple Categories

CRM Partner records keep the legacy primary `categoryId`, `categorySlug`, and `categoryName` fields and also store `categories[]` plus `categorySlugs[]`. The Agent/Partner form uses locally served Bootstrap Select assets from the installed `jquery` and `bootstrap-select` packages. Run `npm ci` before starting the application.

## WhatsApp lead unlock

Nearby providers can unlock an eligible lead from the approved Gupshup quick-reply button without opening the Provider Portal. Configuration and deployment checks are documented in `WHATSAPP_LEAD_UNLOCK_SETUP.md`.

## Gupshup template synchronization

WhatsApp templates are synchronized from Gupshup in **Communication Center → Templates** using `CRM_GUPSHUP_APP_ID` and `CRM_GUPSHUP_API_KEY`. Admins control the local enabled state and assign an approved template, variable mappings and quick-reply action to each communication rule. Template IDs are not hard-coded in deployment environment variables.

## Automatic internal email alerts

The CRM creates editable SES templates and internal-alert rules for CRM lead creation, Partner lead submission, Partner account creation, Provider joining-request submission, and Provider account creation. The default recipient is `alert@findoly.com`, controlled by `INTERNAL_ALERT_EMAIL`. Employees can enable or disable each alert, select an active email template, edit the template, send a test email, and inspect SES delivery logs under **Communication Center → Email → Internal alerts**.

The Partner Portal sends `partner_lead_submitted` from its transactional outbox after a requirement is committed. The Provider Portal sends `provider_join_request_submitted` from its own transactional outbox after a joining request is committed. Both integrations retry safely and use deterministic event IDs, so temporary CRM or SES failures do not remove business records or create duplicate internal emails.

Before deploying this change, remove legacy Slack configuration from communication rules without deleting historical communication rows:

```bash
npm run migrate:remove-slack-rules -- --dry-run
npm run migrate:remove-slack-rules
```
