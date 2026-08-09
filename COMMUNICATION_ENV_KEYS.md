# Findoly Communication Environment Keys

The active Communication Center supports **WhatsApp through Gupshup** and **email through Amazon SES**. Slack delivery has been removed from active runtime and UI. Historical Slack communication rows remain readable for audit purposes.

## Required production keys

```env
# Delivery execution
MESSAGE_DELIVERY_MODE=local

# Gupshup WhatsApp
CRM_GUPSHUP_API_KEY=replace-with-gupshup-api-key
CRM_GUPSHUP_APP_ID=replace-with-gupshup-app-id
CRM_GUPSHUP_APP_NAME=replace-with-gupshup-app-name
CRM_GUPSHUP_SOURCE_NUMBER=91XXXXXXXXXX
CRM_GUPSHUP_API_BASE_URL=https://api.gupshup.io
CRM_GUPSHUP_WEBHOOK_TOKEN=replace-with-long-random-token
CRM_WHATSAPP_DEFAULT_COUNTRY_CODE=91

# Amazon SES
AWS_REGION=ap-south-1
SES_FROM_EMAIL=no-reply@findoly.com
SES_FROM_NAME=Findoly
SES_CONFIGURATION_SET=findoly-transactional

# Automatic internal operational email alerts
INTERNAL_ALERT_EMAIL=alert@findoly.com
INTERNAL_ALERT_EMAIL_ENABLED=true

# Provider access/status confirmations
PROVIDER_EVENT_EMAIL_ENABLED=true

# Server-to-server events from Partner and Provider portals
COMMUNICATION_EVENT_API_TOKEN=replace-with-long-random-shared-token

# Communication and OTP retention
COMMUNICATION_LOG_RETENTION_DAYS=7
OTP_RETENTION_DAYS=7
OTP_EXPIRY_MINUTES=5
OTP_RESEND_SECONDS=60
OTP_MAX_ATTEMPTS=5
OTP_SECRET=replace-with-long-random-secret
```

Use an IAM role in production where available. Local AWS access keys may be used only for development and must not be committed.

## Internal alert events

The Email section of Communication Center controls the enabled state and template for these system-managed events:

```text
lead_created                         CRM lead created
partner_lead_submitted               Partner lead submitted
agent_created                        Partner account created
provider_join_request_submitted      Provider joining request submitted
provider_created                     Provider account created
```

All enabled internal alerts are sent to `INTERNAL_ALERT_EMAIL`. The recipient is intentionally read-only in the CRM UI. Templates remain editable and testable from Communication Center.

## Webhooks and integration paths

```text
POST /api/webhooks/whatsapp
POST /api/webhooks/ses
POST /api/webhooks/message-delivery
POST /api/communication/events/:event
```

Protect `/api/communication/events/:event` with `COMMUNICATION_EVENT_API_TOKEN`. Partner and Provider portals must use the same value and send it through `x-communication-token` or `Authorization: Bearer <token>`.

## Optional Lambda delivery mode

Keep local delivery for the normal CRM deployment:

```env
MESSAGE_DELIVERY_MODE=local
```

For a later Lambda sender deployment:

```env
MESSAGE_DELIVERY_MODE=lambda
MESSAGE_LAMBDA_URL=https://your-lambda-endpoint
MESSAGE_LAMBDA_AUTH_TOKEN=replace-with-private-token
MESSAGE_LAMBDA_WEBHOOK_TOKEN=replace-with-private-webhook-token
```

The Lambda path must support only the active WhatsApp and email channel contracts and return a provider message ID and status.

## Slack retirement

These keys are no longer used by the CRM and should be removed from production secrets after the deployment is stable:

```text
SLACK_BOT_TOKEN
SLACK_DEFAULT_CHANNEL_ID
SLACK_DEFAULT_CHANNEL_NAME
SLACK_CHANNEL_CACHE_SECONDS
SYSTEM_EVENT_SLACK_ENABLED
```

Before removing them, run the Slack-rule cleanup migration described in `PRODUCTION_DEPLOYMENT_CHECKLIST.md`. The migration clears deprecated Slack fields from rules but does not delete historical Communication records.
