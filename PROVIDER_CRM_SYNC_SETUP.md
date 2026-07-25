# Findoly CRM and Provider Portal Sync Setup

## 1. Shared database

Both applications must use the same MongoDB database:

```env
MONGODB_URI=mongodb+srv://.../service_crm_admin
```

After deploying the matching releases, run:

```bash
# CRM
npm run ensure:indexes

# Provider Portal
npm run ensure:indexes
```

The shared collections used by this release include `categories`, `servicetypes`, `enquiries`, `leaddistributions`, `providers`, `providersubscriptions`, `creditallocations`, and `wallettransactions`.

## 2. Category and Service Type flow

CRM is the only place where child Service Types are managed.

- A parent Category may have multiple active Service Types.
- A lead must select 1 to 5 Service Types from its selected Category.
- Leads keep `serviceType` as a first-item compatibility value and store all selections in `serviceTypes`.
- Each `serviceTypes` entry contains a stable `serviceTypeId`, `name`, and `slug` snapshot.
- Provider matching continues to use `categorySlug`; Service Types describe the requirement and do not reduce provider eligibility.
- Provider Portal reads the current Service Types from the shared enquiry record and displays up to five.

Configure Service Types for every active Category before creating or editing production leads.

## 3. Lead priority

CRM is the source of truth for Priority:

```text
low | normal | high | urgent
```

Provider Portal no longer displays or filters by Lead Intent. Historical `leadIntent` values are not deleted, but they are ignored by provider-facing services and views. Providers cannot change Priority.

## 4. Provider subscriptions

Provider Portal writes purchases and renewals to the shared `providersubscriptions` collection. CRM Billing reads this collection directly in the read-only Provider Subscriptions section.

No duplicate subscription collection or copy webhook is required. Both applications must point to the same database and use compatible model fields.

## 5. Shared communication token

Generate one strong secret:

```bash
openssl rand -hex 32
```

CRM `.env`:

```env
COMMUNICATION_EVENT_API_TOKEN=<generated-secret>
```

Provider Portal `.env`:

```env
CRM_API_BASE_URL=https://admin.findoly.com
CRM_COMMUNICATION_EVENT_PATH=/api/communication/events
CRM_API_TIMEOUT_MS=10000
COMMUNICATION_EVENT_API_TOKEN=<same-generated-secret>
PROVIDER_OUTCOME_REMINDER_DAYS=7
```

Provider backend calls the authenticated CRM events after successful unlock and feedback changes. Notification failure never rolls back the saved lead action.

## 6. Nearby marketplace location

Configure the Google Geocoding capability in both applications:

```env
GOOGLE_MAPS_API_KEY=<restricted-server-key>
GOOGLE_MAPS_TIMEOUT_MS=8000
```

CRM owns lead location and provider service-location data. Provider Portal treats provider location as read-only.

## 7. Text validation

- CRM lead fields reject emoji, HTML tags, and encoded HTML on both frontend and backend.
- Provider Portal rejects emoji, HTML tags, and encoded HTML in parsed form/API bodies.
- Razorpay webhook verification remains before JSON and text middleware and continues to use the original raw body.

## 8. Deployment order

1. Back up MongoDB.
2. Deploy CRM and Provider Portal releases together.
3. Confirm both use the same `MONGODB_URI`.
4. Run `npm ci` and `npm run ensure:indexes` in both projects.
5. Run `npm run qa:production`, `npm run check`, and `npm test` in staging.
6. In CRM, create active Service Types for every active Category.
7. Create a lead with 1 Service Type and another with 5 Service Types.
8. Confirm Provider Portal shows the selected Service Types and CRM Priority only.
9. Purchase a test subscription and confirm it appears under CRM Billing → Provider Subscriptions.
10. Unlock a lead, save its outcome, and confirm CRM status and Communication Center logging.
