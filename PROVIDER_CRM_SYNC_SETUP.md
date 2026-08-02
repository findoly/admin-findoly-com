# Findoly CRM and Provider Portal Sync Setup

## 1. Shared database

Both applications must use the same MongoDB database on MongoDB Atlas or a replica set because credit and payment unlocks use transactions:

```env
MONGODB_URI=mongodb+srv://.../service_crm_admin
MONGO_AUTO_INDEX=false
MONGO_MAX_POOL_SIZE=30
MONGO_MIN_POOL_SIZE=2
MONGO_MAX_IDLE_TIME_MS=60000
```

After deploying matching releases, install dependencies and create indexes as a separate deployment step:

```bash
# CRM
npm ci
npm run ensure:indexes

# Provider Portal
npm ci
npm run ensure:indexes
```

The shared lead-flow collections are `enquiries`, `providerleadunlocks`, `providers`, `paymentorders`, `wallettransactions`, and `creditallocations`. Provider-to-CRM delivery additionally uses the Provider Portal-owned transactional outbox collection `providercrmsyncevents`. Catalog and billing also share `categories`, `servicetypes`, and `providersubscriptions`.

One approved enquiry remains one database record regardless of how many providers can see it. A `providerleadunlocks` record is created only after a provider completes an unlock.

## 2. Lead approval and marketplace flow

CRM owns the lead journey:

```text
New -> Verification -> Approved
```

Approval automatically publishes an eligible Valid lead to the Provider Marketplace. Provider Portal queries approved marketplace enquiries directly using indexed category, availability, date, priority and location fields. It does not create provider-specific rows for visibility or notifications.

CRM is the source of truth for Priority:

```text
low | normal | high | urgent
```

Lead Intent has been removed. The pre-production structure migration unsets old Lead Intent and distribution fields and removes the obsolete `leaddistributions` collection.

## 3. Category and Service Type flow

CRM is the only place where child Service Types are managed.

- A lead must select 1 to 5 Service Types from its selected Category.
- Each Service Type snapshot contains `serviceTypeId`, `name`, and `slug`.
- Provider eligibility uses `categorySlug`; Service Types describe the requirement.
- Provider Portal displays up to five Service Types from the enquiry or compact unlock snapshot.

## 4. Provider unlocks and outcomes

A successful credit or direct-payment unlock creates one compact `providerleadunlocks` record with a unique `{ providerId, enquiryId }` index. Customer contact details remain only on the enquiry.

The Provider Portal sends these authenticated CRM events after committed actions:

```text
provider_lead_unlocked
provider_feedback_updated
```

Configure one shared token:

```env
# CRM
COMMUNICATION_EVENT_API_TOKEN=<strong-random-secret>

# Provider Portal
CRM_API_BASE_URL=https://admin.findoly.com
CRM_COMMUNICATION_EVENT_PATH=/api/communication/events
CRM_API_TIMEOUT_MS=10000
COMMUNICATION_EVENT_API_TOKEN=<same-secret>
```

Notification delivery failures never roll back a successful unlock or outcome update. Each action creates its own `providercrmsyncevents` row inside the same MongoDB transaction, so an unlock and later feedback cannot overwrite one another. Every event carries a monotonic per-unlock sequence; CRM accepts duplicate retries idempotently and ignores stale or unsequenced replays after sequencing is active. The Provider Portal claims due events with a lease and retries with exponential backoff. After `CRM_SYNC_MAX_ATTEMPTS` (default 20), an event moves to dead-letter state; successful rows expire after `CRM_SYNC_EVENT_RETENTION_DAYS` (default 30). The in-process worker runs automatically; bounded manual passes are available with:

```bash
cd /path/to/provider-portal
npm run retry:crm-sync -- --max=100
npm run retry:crm-sync -- --max=100 --include-dead-letter
```

Atomic leases and CRM idempotency protect against duplicate concurrent delivery.

## 5. Bounded marketplace cleanup jobs

Razorpay checkout reserves one marketplace slot before the gateway order is created. Run the Provider Portal cleanup every five minutes so abandoned reservations return their slot:

```bash
cd /path/to/provider-portal
npm run cleanup:lead-reservations
```

Run the CRM expiry cleanup every five minutes so expired leads are marked unavailable in indexed, bounded batches instead of remaining in the hot marketplace set:

```bash
cd /path/to/crm
npm run cleanup:marketplace-leads
```

Optional limits:

```env
# Provider Portal
LEAD_PAYMENT_RESERVATION_MINUTES=20
LEAD_PAYMENT_RELEASE_BATCH_SIZE=25
LEAD_PAYMENT_CLEANUP_MAX_BATCHES=20

# CRM
MARKETPLACE_EXPIRY_BATCH_SIZE=250
MARKETPLACE_EXPIRY_MAX_BATCHES=20
```

Credit unlock and direct-payment checkout re-check one another inside the MongoDB transaction. A concurrent request cannot charge both credits and Razorpay for the same provider and lead. Use one scheduler owner per command and environment.

## 6. Provider subscriptions

Provider Portal writes purchases and renewals to `providersubscriptions`. CRM Billing reads that collection directly in the read-only Provider Subscriptions section. No copy webhook or duplicate subscription collection is required.

## 7. Nearby marketplace location

```env
GOOGLE_MAPS_API_KEY=<restricted-server-key>
GOOGLE_MAPS_TIMEOUT_MS=8000
```

CRM owns lead and provider service-location data. Provider Portal treats provider location as read-only and applies bounded distance checks only to database-filtered candidates.

## 8. Empty-database deployment order

1. Create one explicitly named, transaction-capable MongoDB database for both services.
2. Configure the same strong `COMMUNICATION_EVENT_API_TOKEN` in CRM and Provider Portal.
3. Run `npm ci` in both projects.
4. Deploy CRM first and run `npm run ensure:indexes` with `MONGO_AUTO_INDEX=false`.
5. Start CRM and verify its health/readiness endpoint before starting Provider Portal.
6. Deploy Provider Portal and run `npm run ensure:indexes` with `MONGO_AUTO_INDEX=false`.
7. Start Provider Portal and run `npm run retry:crm-sync -- --max=1` to verify authenticated acknowledgement connectivity. An empty queue is a valid result.
8. Schedule Provider Portal `npm run cleanup:lead-reservations` and CRM `npm run cleanup:marketplace-leads` every five minutes.
9. Run `npm run qa:production`, `npm run check`, and `npm test` on the deployment host.
10. Smoke-test approval, marketplace listing/count parity, credit unlock, direct-payment unlock, CRM outage/recovery, cancellation/expiry and provider outcome updates.

Do **not** run structure, contact, location, date or other backfill migrations for this empty database. They are retained only for future deployments that already contain legacy data. Deploy these CRM and Provider packages as a matched pair because the Provider outbox requires CRM's explicit acknowledgement contract.
