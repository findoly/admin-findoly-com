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

Frontend routes do not query MongoDB and do not pass lead, provider, distribution, follow-up, communication, invoice, or dashboard records into EJS. EJS receives only page-title metadata. Alpine reads route IDs and query filters from `window.location`.

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
| `leaddistributions` | `leadDistributionId` |
| `wallettransactions` | `walletTransactionId` |
| `paymentorders` | `paymentOrderId` |
| `followups` | `followUpId` |
| `communications` | `communicationId` |
| `invoices` | `invoiceId` |
| `formtemplates` | `formTemplateId` |

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

```bash
cp .env.example .env
npm install
npm run migrate:structure
npm start
```

`migrate:structure`:

- preserves existing `_id` and `id`
- adds 32-character named UUID fields
- remaps relation fields to the new named identifiers
- flattens legacy enquiry data
- normalizes provider mobile numbers
- rebuilds approved lead offers for eligible providers

The old command remains an alias:

```bash
npm run migrate:lead-distribution
```

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

Agent Portal requirements now require CRM referral validation (`pending`, `valid`, or `invalid`). Only valid requirements can move to provider distribution. Partner withdrawals use matured referrals at least 14 days old, complete blocks of 10, and a minimum 20% sale conversion. Configure each agent's ₹50–₹200 rate and verified RazorpayX fund account in the CRM agent profile.

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

`/api/communication/events/:event` is intended for the provider or agent portal. Protect it with `COMMUNICATION_EVENT_API_TOKEN`. The request can include `enquiryId`, `provider`, `status`, `note`, and other event context. Supported default events include `provider_confirmed`, `provider_rejected`, `provider_invalid`, and `sale_conversion_updated`.

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
3. Set `SLACK_BOT_TOKEN`. Optionally set `SLACK_DEFAULT_CHANNEL_ID`, `SLACK_DEFAULT_CHANNEL_NAME`, and `SLACK_CHANNEL_CACHE_SECONDS`.
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
