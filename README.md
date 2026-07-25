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

The CRM includes a built-in Communication Center at `/communications` for:

- Meta WhatsApp Cloud API template creation, submission, status synchronization and test sending
- approved WhatsApp Utility, Authentication and Marketing templates
- Amazon SES email templates and test sending
- internal Slack messages to multiple manually created channels through one bot token
- WhatsApp, email or Slack lead-status notification rules
- separate OTP request and verification APIs with hashed OTP storage, expiry, resend cooldown and attempt limits
- WhatsApp delivery/read/failure webhooks and inbound-message logging
- Amazon SES/SNS delivery, bounce, complaint, reject, open and delay updates
- lead-level communication history and manual failed-message retry
- MongoDB TTL deletion of communication and OTP activity logs after seven days
- local delivery now, with a Lambda delivery mode later without changing CRM rules or logs

### Main pages

```text
/communications                 dashboard
/communications/logs            message history
/communications/send            manual template send
/communications/templates       WhatsApp and email templates
/communications/rules           event-to-template rules
/communications/otp             OTP activity and test send
/communications/settings        configuration readiness
```

### Public and integration endpoints

```text
GET  /api/communication/slack/channels
POST /api/communication/slack/send
POST /api/communication/otp/send
POST /api/communication/otp/verify
GET  /api/webhooks/whatsapp
POST /api/webhooks/whatsapp
POST /api/webhooks/ses
POST /api/webhooks/message-delivery
POST /api/communication/events/:event
```

`/api/communication/events/:event` is intended for the provider or agent portal. Protect it with `COMMUNICATION_EVENT_API_TOKEN` and send the token in either `x-communication-token` or `Authorization: Bearer <token>`.

### Provider communication integration

The provider backend sends two primary server-to-server events:

```text
provider_lead_unlocked
provider_feedback_updated
```

`provider_lead_unlocked` is emitted only after a credit or direct-payment unlock commits successfully. `provider_feedback_updated` is emitted after a provider saves the mandatory Confirmed/Not Confirmed outcome and any optional activity status.

Named status events such as `provider_confirmed`, `provider_rejected`, and `provider_contacted`, plus the generic `provider_status` and `provider_status_updated` names, remain supported for compatible integrations.

Identify the unlocked provider record using `providerLeadUnlockId`, or by the unique combination of `enquiryId` and `providerId`:

```json
{
  "providerLeadUnlockId": "UNLOCK_REFERENCE",
  "enquiryId": "LEAD_REFERENCE",
  "providerId": "PROVIDER_REFERENCE",
  "outcome": "confirmed",
  "activityStatus": "contacted",
  "reason": "",
  "note": "Customer confirmed the purchase"
}
```

Provider sale outcome is mandatory (`confirmed` or `not_confirmed`); activity status is optional. The lead remains at the CRM `approved` stage while denormalized fields track `providerConfirmedCount` and `providerSaleConversionStatus`. Employees do not manually overwrite provider conversion.

No reconciliation scan runs when a lead is opened. The provider action updates the compact unlock record and the enquiry counters in one transaction, then sends the CRM communication event after commit.

### Local-to-Lambda migration

Keep this during the first deployment:

```env
MESSAGE_DELIVERY_MODE=local
```

Later deploy the message sender in Lambda and change only:

```env
MESSAGE_DELIVERY_MODE=lambda
MESSAGE_LAMBDA_URL=https://your-lambda-endpoint
MESSAGE_LAMBDA_AUTH_TOKEN=your-private-token
MESSAGE_LAMBDA_WEBHOOK_TOKEN=your-private-webhook-token
```

The Lambda request receives the channel, recipient, template, variables, rendered email content, communication ID, purpose and metadata. It should return `providerMessageId` and `status`, then call `/api/webhooks/message-delivery` for later delivery updates.

### Meta setup

1. Configure the WhatsApp Business Account ID, phone-number ID, access token, app secret and webhook verification token.
2. Configure the Meta callback URL as `/api/webhooks/whatsapp`.
3. Create a local WhatsApp template, submit it to Meta, then use **Sync Meta templates** until its status is `approved`.
4. Assign approved templates to notification rules.

### Amazon SES setup

1. Verify `SES_FROM_EMAIL` or its domain in the configured AWS Region.
2. Use an IAM role in production or local AWS credentials during development.
3. For delivery events, configure an SES configuration set and an SNS event destination pointing to `/api/webhooks/ses`.
4. Keep bounce and complaint monitoring enabled for production sending.

### Slack setup

1. Create or open the Slack app and add the bot scopes `chat:write`, `channels:read`, and `groups:read`. Add `chat:write.public` only when the bot must post to public channels without being invited.
2. Install or reinstall the app to the workspace and copy the **Bot User OAuth Token** beginning with `xoxb-`.
3. Set `SLACK_BOT_TOKEN`, `SLACK_DEFAULT_CHANNEL_ID`, and `SLACK_DEFAULT_CHANNEL_NAME`. The default channel receives every automatic CRM/provider event. `SLACK_CHANNEL_CACHE_SECONDS` remains optional.
4. Invite the Slack app to every private channel that should appear in the CRM channel selector.
5. Use **Sync channels** on `/communications` or `/communications/rules`, then select the required channel and send or save the rule.

The CRM calls Slack `conversations.list` to discover accessible public/private channels and `chat.postMessage` to send. One bot token supports multiple manually created channels; each rule stores both the Slack channel ID and display name.

### Seven-day MongoDB TTL retention

`communications` records use a TTL index on `createdAt`. OTP activity uses its own TTL index. With the default environment values, MongoDB deletes both after seven days without an application cron job. TTL cleanup is asynchronous, so a record may remain briefly after its expiry time. Templates, notification rules, settings, leads and CRM audit notes are unaffected.

```env
COMMUNICATION_LOG_RETENTION_DAYS=7
OTP_RETENTION_DAYS=7
```

Secrets are never stored or displayed in the CRM database. The settings page only reports whether required environment variables are present.

### Slack in notification rules

Communication Rules can also send internal Slack notifications. Enable Slack on a rule, select a synchronized channel, and write the message using supported variables such as `{{lead_id}}`, `{{customer_name}}`, `{{lead_status}}`, `{{provider_name}}`, and `{{note}}`.

Each rule stores the Slack channel ID used by `chat.postMessage` and the channel name used for CRM display/logging. Blank Slack messages and missing channel IDs are rejected. Existing webhook-era Slack rules should be opened once and saved with a synchronized channel.

## Provider portal synchronization

The Provider Portal and CRM share compatible `enquiries`, `providerleadunlocks`, `providers`, `paymentorders`, and credit collections. CRM approval publishes the enquiry directly; provider eligibility does not create database records. One compact unlock record is created only after a provider unlocks.

Provider browsers call only the Provider Portal host. The Provider backend notifies CRM through:

```text
POST /api/communication/events/provider_lead_unlocked
POST /api/communication/events/provider_feedback_updated
```

Both services must share `COMMUNICATION_EVENT_API_TOKEN`. Slack/email delivery failures are logged independently and never roll back a committed lead action. See `PROVIDER_CRM_SYNC_SETUP.md` for coordinated deployment and reservation-cleanup instructions.

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
