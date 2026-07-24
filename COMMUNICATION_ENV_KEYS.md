# Communication Center environment keys

Copy `.env.communication.example` into the main `.env` and replace every `replace-with-*` value.

## Required now

```env
MESSAGE_DELIVERY_MODE=local
COMMUNICATION_HTTP_TIMEOUT_MS=15000
COMMUNICATION_EVENT_API_TOKEN=replace-with-a-long-random-token
COMMUNICATION_LOG_RETENTION_DAYS=7
OTP_RETENTION_DAYS=7

SLACK_BOT_TOKEN=xoxb-replace-with-bot-user-oauth-token
SLACK_DEFAULT_CHANNEL_ID=C0123456789
SLACK_DEFAULT_CHANNEL_NAME=internal-team
SLACK_CHANNEL_CACHE_SECONDS=300

# Automatic Findoly event routing
# Slack receives every event emitted through the CRM Communication Center.
SYSTEM_EVENT_SLACK_ENABLED=true
# Provider email is sent only after a lead unlock or provider status/outcome update.
PROVIDER_EVENT_EMAIL_ENABLED=true

META_WHATSAPP_API_VERSION=v25.0
META_WHATSAPP_ACCESS_TOKEN=replace-with-meta-access-token
META_WHATSAPP_PHONE_NUMBER_ID=replace-with-phone-number-id
META_WHATSAPP_BUSINESS_ACCOUNT_ID=replace-with-whatsapp-business-account-id
META_WEBHOOK_VERIFY_TOKEN=replace-with-a-random-webhook-token
META_APP_SECRET=replace-with-meta-app-secret
WHATSAPP_DEFAULT_COUNTRY_CODE=91

AWS_REGION=ap-south-1
SES_FROM_EMAIL=verified-sender@example.com
SES_FROM_NAME=Findoly
SUPPORT_EMAIL=support@findoly.com
PROVIDER_PORTAL_LOGIN_URL=https://provider.findoly.com/login
AGENT_PORTAL_LOGIN_URL=https://agent.findoly.com/login
EMPLOYEE_CRM_LOGIN_URL=https://admin.findoly.com/login

OTP_SECRET=replace-with-at-least-32-random-characters
OTP_EXPIRY_MINUTES=5
OTP_RESEND_SECONDS=60
OTP_MAX_ATTEMPTS=5
OTP_MAX_REQUESTS_PER_HOUR=10
OTP_MAX_IP_REQUESTS_PER_HOUR=30
```

AWS credentials can be omitted when the server uses an IAM role. Otherwise set:

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=
```

Optional SES values:

```env
SES_REPLY_TO_EMAIL=
SES_CONFIGURATION_SET=
SES_SNS_AUTO_CONFIRM=false
```

## Required later for Lambda mode

Keep these empty for now. When the delivery API moves to Lambda, set:

```env
MESSAGE_DELIVERY_MODE=lambda
MESSAGE_LAMBDA_URL=https://your-private-lambda-endpoint
MESSAGE_LAMBDA_AUTH_TOKEN=replace-with-a-private-token
MESSAGE_LAMBDA_WEBHOOK_TOKEN=replace-with-a-private-webhook-token
```

In Lambda mode, Meta, SES and Slack provider secrets can live in Lambda instead of the CRM server. The CRM continues sending the same channel payloads and retaining logs for seven days.

## Slack setup and dashboard API

Add these Slack bot scopes before installing or reinstalling the app:

```text
chat:write
channels:read
groups:read
```

`chat:write.public` is optional when the bot must post to public channels without being invited. Invite the app manually to every private channel it should see or use.

Synchronize channels:

```http
GET /api/communication/slack/channels?refresh=1
```

Send to a selected channel:

```http
POST /api/communication/slack/send
Content-Type: application/json
```

```json
{
  "channelId": "C0123456789",
  "channelName": "internal-team",
  "message": "A new high-priority lead requires review."
}
```

The channel ID controls the actual Slack destination. The channel name is retained for display and seven-day communication logs.
