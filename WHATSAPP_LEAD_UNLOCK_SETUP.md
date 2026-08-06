# WhatsApp Lead Unlock Setup

The CRM sends the approved nearby-lead template only to matching providers within the existing 20 km rule. The quick-reply button selected in Communication Center carries a signed, expiring action. When clicked, CRM calls the Provider Portal internal action API; the Provider Portal reuses its existing transactional lead-unlock and credit-deduction service. Customer details are returned to CRM only after a successful or already-completed unlock and are then sent to the provider as a WhatsApp session message.

## CRM Secrets Manager values

```env
CRM_GUPSHUP_WEBHOOK_TOKEN=GENERATE_A_THIRD_RANDOM_SECRET
CRM_PROVIDER_ACTION_API_URL=https://provider.findoly.com/api/internal/whatsapp/lead-unlock
CRM_PROVIDER_ACTION_API_TOKEN=GENERATE_A_RANDOM_SECRET
CRM_WHATSAPP_ACTION_SIGNING_SECRET=GENERATE_A_DIFFERENT_RANDOM_SECRET
CRM_WHATSAPP_ACTION_EXPIRY_MINUTES=1440
CRM_PROVIDER_ACTION_API_TIMEOUT_MS=15000
PROVIDER_PORTAL_BASE_URL=https://provider.findoly.com
PROVIDER_PORTAL_WALLET_URL=https://provider.findoly.com/wallet
```

Generate the three secrets independently:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

`CRM_PROVIDER_ACTION_API_TOKEN` must exactly match `PROVIDER_CRM_ACTION_API_TOKEN` in the Provider Portal. `CRM_WHATSAPP_ACTION_SIGNING_SECRET` must be different and must remain CRM-only. `CRM_GUPSHUP_WEBHOOK_TOKEN` must also be different and must match the token in the Gupshup callback URL.

Keep the existing Gupshup webhook callback configured as:

```text
https://admin.findoly.com/api/webhooks/whatsapp?token=CRM_GUPSHUP_WEBHOOK_TOKEN_VALUE
```

The approved template must contain a quick-reply button for the unlock action. Its button index and parameter mappings are selected in **Communication Center → Manage Rules** rather than configured through environment variables.

## Deployment verification

1. Restart CRM after updating Secrets Manager.
2. Confirm the nearby-lead communication rule is enabled for WhatsApp.
3. Publish a test lead within 20 km of a test provider.
4. Confirm CRM Communication Logs show the outbound alert and Gupshup message ID.
5. Tap **Unlock Lead** from the provider's registered WhatsApp number.
6. Confirm credits are deducted exactly once and the unlocked customer details are sent on WhatsApp.
7. Repeat the click and confirm no second charge occurs.

## Gupshup v2 webhook logging

Use **Gupshup format (v2)** and enable inbound messages plus `enqueued`, `sent`, `delivered`, `read`, and `failed` message events.

CRM now stores both IDs supplied by Gupshup:

- `payload.gsId` as the Gupshup message ID
- `payload.id` as the Meta/WhatsApp message ID

Matched events update the original outbound communication and append a timestamped event to its timeline. If no outbound CRM record can be matched, CRM creates or updates an `whatsapp_delivery_event_unmatched` audit row so the callback remains visible in Communication Center.

All button replies are logged. Only a valid signed Findoly `postbackText` can call the Provider Portal unlock endpoint. Visible button text such as `Quick Reply` or `Unlock Lead` is never accepted as authorization to deduct credits.

After deploying, run the CRM index command so the new WhatsApp message-ID indexes are available:

```bash
npm run ensure:indexes
```

## Template assignment

1. Add `CRM_GUPSHUP_APP_ID`, API key, app name and source number to CRM Secrets Manager.
2. Open **Communication Center → Templates** and select **Sync from Gupshup**.
3. Enable the approved template locally.
4. Open **Manage Rules**, edit `nearby_lead_available`, map its parameters and select the Unlock Lead quick-reply button.

Template IDs and quick-reply indexes are stored in MongoDB through the communication rule; they are no longer deployment environment variables.
