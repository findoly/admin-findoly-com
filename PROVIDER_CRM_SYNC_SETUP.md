# Findoly CRM and Provider Portal Sync Setup

## 1. Database

Both applications must use the same MongoDB database:

```env
MONGODB_URI=mongodb+srv://.../service_crm_admin
```

Run the provider index command once after deployment:

```bash
npm run ensure:indexes
```

## 2. Shared communication token

Generate one strong secret:

```bash
openssl rand -hex 32
```

CRM `.env`:

```env
COMMUNICATION_EVENT_API_TOKEN=<generated-secret>
```

Provider portal `.env`:

```env
CRM_API_BASE_URL=https://admin.findoly.com
CRM_COMMUNICATION_EVENT_PATH=/api/communication/events
CRM_API_TIMEOUT_MS=10000
COMMUNICATION_EVENT_API_TOKEN=<same-generated-secret>
PROVIDER_OUTCOME_REMINDER_DAYS=7
```

The provider browser never calls CRM directly. Its backend calls these authenticated server-to-server endpoints:

```text
POST https://admin.findoly.com/api/communication/events/provider_lead_unlocked
POST https://admin.findoly.com/api/communication/events/provider_feedback_updated
```

The CRM resolves the provider email from its own provider record. The provider portal does not choose or submit the email recipient.

## 3. Nearby marketplace location

Configure the same Google Geocoding API capability in both applications:

```env
GOOGLE_MAPS_API_KEY=<restricted-server-key>
GOOGLE_MAPS_TIMEOUT_MS=8000
```

- CRM requires a valid lead PIN code before marketplace distribution.
- Each provider has one mandatory primary service PIN code and an optional full address.
- The server stores cached approximate coordinates in `pincodelocations`.
- Visibility expands at 5 km immediately, 10 km after 5 minutes, 25 km after 15 minutes, 50 km after 30 minutes, 100 km after 1 hour, 200 km after 2 hours, 400 km after 4 hours, and becomes unrestricted after 8 hours.
- Lead Intent remains CRM-controlled. Unlock pricing remains the original CRM-configured credit cost; no discount is applied.

## 4. Lead intent

CRM is the source of truth. Employees select High, Medium, Low, or Not assessed while creating or editing a lead. The provider marketplace reads the value from the shared lead record.

## 5. Provider outcome rules

Every unlocked lead requires Confirmed or Not Confirmed. The activity status is separate and optional.

- Any current Confirmed provider: Distributed becomes Sale Converted.
- No current Confirmed providers: Sale Converted returns to Distributed.
- Other provider statuses do not cancel conversion while at least one provider remains Confirmed.

## 6. Communication rules

Automatic routing is now fixed as follows:

- Every CRM or provider event emitted through the Communication Center is sent to the configured internal Slack channel.
- A provider receives email only after successfully unlocking a lead or successfully saving a lead status/outcome update.
- Slack and email are attempted independently. A delivery failure does not roll back the lead action.
- WhatsApp is not called by this integration. Existing WhatsApp code remains unchanged.
- Communication records retain independent sent/failed status and idempotency keys for safe retries.

CRM also keeps its optional Communication Center rules for any additional customized notifications.

## 7. Provider review

CRM users review outcomes from the lead provider journey. Warnings, suspension, and blocking are manual and require:

1. Verification result `Incorrect status`.
2. A mandatory review note.
3. An explicit account action selected by an authorized CRM employee.

## 8. Deployment order

1. Deploy CRM and configure the shared token.
2. Deploy provider portal with the CRM URL and same token.
3. Run provider indexes: `npm run ensure:indexes`.
4. In CRM, run `npm run migrate:marketplace-location` once to geocode existing provider/lead PIN codes and calculate existing marketplace visibility.
5. Restart both Node services.
6. Create/edit a test lead in CRM and set Lead Intent.
7. Unlock it in provider portal.
8. Save Confirmed and verify CRM changes to Sale Converted.
9. Change to Not Confirmed and verify CRM returns to Distributed.
10. Confirm the Slack event and provider email appear in Communication Center logs; optional customized rules may create additional messages.
