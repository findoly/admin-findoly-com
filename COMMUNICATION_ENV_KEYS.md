# Communication Center environment keys

Copy `.env.communication.example` into the main `.env` and replace every `replace-with-*` value.

## Required now

```env
MESSAGE_DELIVERY_MODE=local
COMMUNICATION_HTTP_TIMEOUT_MS=15000
COMMUNICATION_EVENT_API_TOKEN=replace-with-a-long-random-token
COMMUNICATION_LOG_RETENTION_DAYS=7
OTP_RETENTION_DAYS=7

SLACK_WEBHOOK_URL=https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK
SLACK_CHANNEL_NAME=internal-team

META_WHATSAPP_API_VERSION=v25.0
META_WHATSAPP_ACCESS_TOKEN=replace-with-meta-access-token
META_WHATSAPP_PHONE_NUMBER_ID=replace-with-phone-number-id
META_WHATSAPP_BUSINESS_ACCOUNT_ID=replace-with-whatsapp-business-account-id
META_WEBHOOK_VERIFY_TOKEN=replace-with-a-random-webhook-token
META_APP_SECRET=replace-with-meta-app-secret
WHATSAPP_DEFAULT_COUNTRY_CODE=91

AWS_REGION=ap-south-1
SES_FROM_EMAIL=verified-sender@example.com
SES_FROM_NAME=VetsKart

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

## Slack dashboard API

```http
POST /api/communication/slack/send
Content-Type: application/json
```

```json
{
  "channelName": "internal-team",
  "message": "A new high-priority lead requires review."
}
```

The incoming webhook is connected to one actual Slack channel. `SLACK_CHANNEL_NAME` and the dashboard field are used for display and logs, so keep them matched to the webhook channel.
