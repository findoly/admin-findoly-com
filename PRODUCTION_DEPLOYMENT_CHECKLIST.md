# Findoly CRM production deployment and manual QA checklist

## 1. Release gate

- [ ] Use Node.js 20 or newer.
- [ ] Confirm MongoDB is Atlas or another replica set with transactions enabled.
- [ ] Take and verify a MongoDB snapshot/backup.
- [ ] Keep the previous application release and environment configuration available for rollback.
- [ ] Deploy into a new release directory; do not overwrite the running release in place.
- [ ] Run `npm ci` from the committed lockfile.
- [ ] Run `npm run qa:production`.
- [ ] Run `npm run check`.
- [ ] Run `npm test` and resolve every assertion or dependency failure.
- [ ] Run all migrations against a production-like staging copy first.
- [ ] Run the database query-plan gate against production-like data.
- [ ] Confirm `/api/health` returns 200.
- [ ] Confirm `/api/ready` returns 200 only after MongoDB is connected.

## 2. Required environment review

Hostinger bootstrap values remain outside Secrets Manager:

```env
NODE_ENV=production
PORT=3200
CRM_SECRETS_REGION=ap-south-1
CRM_SECRETS_SECRET_ID=findoly/crm/production
CRM_SECRETS_ACCESS_KEY_ID=
CRM_SECRETS_SECRET_ACCESS_KEY=
CRM_SECRETS_TIMEOUT_MS=10000
```

Application values loaded from Secrets Manager:

```env
TRUST_PROXY=1
APP_NAME=Findoly Dashboard
MONGODB_URI=mongodb+srv://.../findoly_prod?retryWrites=true&w=majority
AUTH_COOKIE_SECRET=
AUTH_COOKIE_NAME=service_crm_admin
CORS_ORIGINS=https://admin.findoly.com,https://findoly.com,https://provider.findoly.com,https://agent.findoly.com
CRM_ADMIN_ORIGIN=https://admin.findoly.com
PUBLIC_INTAKE_API_TOKEN=
CRM_QUERY_MAX_TIME_MS=10000
```

Security-sensitive requirements:

- [ ] `AUTH_COOKIE_SECRET` is a non-placeholder random value of at least 32 characters.
- [ ] `PUBLIC_INTAKE_API_TOKEN` is a non-placeholder random value of at least 32 characters.
- [ ] `MONGODB_URI` includes the explicit database name.
- [ ] `CORS_ORIGINS` contains only trusted HTTPS browser origins.
- [ ] `CRM_ADMIN_ORIGIN` exactly matches the admin browser origin and contains no path.
- [ ] Secrets Manager, S3, CloudWatch, Razorpay, WhatsApp, SES and Slack credentials are scoped with least privilege.

Recommended database and OTP settings:

```env
MONGO_AUTO_INDEX=false
MONGO_MAX_POOL_SIZE=30
MONGO_MIN_POOL_SIZE=2
MONGO_MAX_IDLE_TIME_MS=60000
MONGO_SERVER_SELECTION_TIMEOUT_MS=10000

CRM_OTP_RESEND_SECONDS=30
CRM_OTP_MAX_SENDS_PER_MINUTE=2
CRM_OTP_RATE_WINDOW_SECONDS=60
CRM_OTP_MAX_IP_REQUESTS_PER_HOUR=30
CRM_OTP_IP_RATE_WINDOW_SECONDS=3600
CRM_OTP_MAX_IP_VERIFY_ATTEMPTS_PER_HOUR=60
CRM_OTP_IP_VERIFY_WINDOW_SECONDS=3600
```

Optional cache settings:

```env
DASHBOARD_CACHE_TTL_MS=60000
DASHBOARD_COUNT_CAP=10000
COMMUNICATION_DASHBOARD_CACHE_TTL_MS=30000
```

Required Gupshup and Provider Marketplace values:

```env
CRM_GUPSHUP_API_KEY=
CRM_GUPSHUP_APP_NAME=
CRM_GUPSHUP_SOURCE_NUMBER=
CRM_GUPSHUP_API_BASE_URL=https://api.gupshup.io
CRM_GUPSHUP_WEBHOOK_TOKEN=
CRM_WHATSAPP_DEFAULT_COUNTRY_CODE=91
CRM_NEARBY_LEAD_ALERT_BATCH_SIZE=10
PROVIDER_PORTAL_MARKETPLACE_URL=https://provider.findoly.com/leads
```

- [ ] The Gupshup API key, app name and source number match the production Gupshup application.
- [ ] The webhook token is a non-placeholder random value and is configured on both sides.
- [ ] The Provider Marketplace URL opens the production Lead Marketplace.
- [ ] No `META_WHATSAPP_*` or Meta Graph API values are required by this release.

## 3. Mandatory migration order

Use a maintenance window and run one application writer while contact identities are built.

### Dry run

```bash
npm run migrate:provider-contacts -- --dry-run
npm run migrate:follow-up-dates -- --dry-run
npm run migrate:invoice-dates -- --dry-run
npm run migrate:withdrawal-slots -- --dry-run
npm run migrate:contact-identities -- --dry-run
```

- [ ] Resolve every malformed date/contact value reported by a dry run.
- [ ] Review every duplicate mobile, WhatsApp or email reported by contact migration v2.
- [ ] Preserve legitimate employee-linked ownership where one Employee is also an Agent, Provider or provider applicant.
- [ ] Resolve same-role duplicates and Agent/Provider/request overlaps that are not linked to an Employee.
- [ ] Resolve multiple active withdrawals for the same Agent.

### Apply

```bash
npm run migrate:provider-contacts
npm run migrate:follow-up-dates
npm run migrate:invoice-dates
npm run migrate:withdrawal-slots
npm run migrate:contact-identities
```

### Index and query verification

```bash
npm run ensure:indexes
npm run verify:indexes
npm run verify:query-plans
```

- [ ] Every model reports its declared indexes as present.
- [ ] No duplicate-key/index-build error is present.
- [ ] Query-plan verification reports no `COLLSCAN` or blocking `SORT` for its representative cases.
- [ ] Review Atlas Performance Advisor after realistic test traffic.

## 4. Security smoke tests

- [ ] A valid admin-origin POST/PUT/PATCH/DELETE succeeds.
- [ ] A cross-origin admin mutation is rejected with 403.
- [ ] A malformed/external login return path falls back to the dashboard.
- [ ] Missing or weak public-intake token stops production startup.
- [ ] Unknown employee and known employee OTP requests use the same generic public message.
- [ ] OTP send and verify network throttles return 429 with `Retry-After`.
- [ ] Request IDs are present on responses and safe server errors.
- [ ] `/api/health` does not expose the database name or credentials.

## 5. Contact identity and role-overlap smoke tests

- [ ] Create an Employee with unique mobile/email.
- [ ] Create an Agent using that Employee's contact; creation succeeds and the shared identity records both owners.
- [ ] Create a Provider using that Employee's contact; creation succeeds.
- [ ] Submit a provider joining request using that Employee's contact; submission succeeds.
- [ ] Attempt a second Agent with the same contact; creation is rejected.
- [ ] Attempt a second Provider with the same contact; creation is rejected.
- [ ] Attempt a second Employee with the same contact; creation is rejected.
- [ ] Attempt a second active provider request with the same contact; submission is rejected.
- [ ] Attempt Agent-to-Provider contact reuse where no Employee is linked; creation is rejected.
- [ ] Attempt a Provider whose WhatsApp matches an unrelated entity's mobile; creation is rejected.
- [ ] Update one entity while preserving its own contacts; update succeeds.
- [ ] Update one entity to an unrelated entity's contact; update is rejected.
- [ ] Convert a provider joining request; request ownership transfers to the created Provider while legitimate Employee ownership remains.
- [ ] Repeat conversion; no duplicate Provider or duplicate welcome communication is created.

## 6. Financial consistency smoke tests

- [ ] Submit two withdrawal requests concurrently for one Agent; only one becomes active.
- [ ] Change referral eligibility while a payout is processing; the protected row cannot be reused.
- [ ] Double-click payout; one external payout claim is created.
- [ ] Simulate an uncertain Razorpay response; withdrawal remains reconcilable rather than incorrectly failed.
- [ ] Apply a terminal failed webhook twice; state remains idempotent.
- [ ] Complete payout and confirm all related enquiry rows become paid in the same transaction.
- [ ] Reverse payout and confirm paid/reserved rows are released correctly.

## 7. Date and list regression tests

- [ ] Existing follow-ups display, edit and filter correctly after the date migration.
- [ ] Existing invoices display and filter by issue/due date correctly after migration.
- [ ] Cursor pagination preserves stable ordering under concurrent inserts.
- [ ] Invalid or oversized cursors return 400 rather than 500.
- [ ] Provider-subscription search returns results beyond the old 500-provider boundary.
- [ ] Dashboard counters remain responsive on production-like volumes.

## 8. Gupshup and nearby-lead alert smoke tests

- [ ] Create or edit the nearby-lead WhatsApp template and enter the exact approved Gupshup template ID.
- [ ] Activate the local template only after the Gupshup template is approved.
- [ ] Enable the `nearby_lead_available` rule with WhatsApp enabled; email and Slack remain disabled for this event.
- [ ] Publish a category-matching lead with valid coordinates.
- [ ] A portal-enabled active Provider at exactly 20.0 km receives one WhatsApp alert.
- [ ] A Provider farther than 20.0 km receives no WhatsApp alert, including when the lead becomes visible later.
- [ ] A Provider without service coordinates receives no WhatsApp alert.
- [ ] A Provider with a non-matching category receives no WhatsApp alert.
- [ ] Repeating or retrying publication does not create a duplicate alert for the same lead/provider/publication.
- [ ] A Gupshup delivery failure is logged but does not roll back lead publication.
- [ ] Gupshup `message-event` callbacks update message delivery status.
- [ ] The alert contains only provider name, service/category, general location, requirement summary and marketplace link; no locked customer contact or exact address is exposed.

## 9. Provider Portal marketplace smoke tests

- [ ] On a real Android phone, Lead Marketplace shows one compact Search & Filters button with no closed-state blank space.
- [ ] On a real iPhone, the bottom sheet opens, scrolls, applies filters, clears filters and closes correctly.
- [ ] Desktop and tablet filter layout remains unchanged.
- [ ] A lead within 20 km appears immediately and contributes to Available Leads.
- [ ] A lead above 20–50 km is excluded until its 10-minute visibility time.
- [ ] A lead above 50–100 km is excluded until its 30-minute visibility time.
- [ ] A lead above 100 km or with missing provider coordinates is excluded until its 60-minute visibility time.
- [ ] A lead already unlocked by the Provider is excluded from Available Leads.
- [ ] Expired, closed, fully unlocked, unavailable or category-mismatched leads are excluded.
- [ ] Dashboard Available Leads count matches the Lead Marketplace result set for the same Provider.

## 10. Existing feature smoke tests

- [ ] Employee login/logout and role revocation.
- [ ] Provider, Agent and Employee create/update.
- [ ] Provider joining request review and conversion.
- [ ] Lead creation, verification, publication and provider unlock.
- [ ] Communication Center rules, templates, logs, OTP activity and provider-created notification.
- [ ] S3 File Manager list/upload/download/error logging.
- [ ] Razorpay webhook signature validation.
- [ ] Gupshup WhatsApp, SES and message-delivery webhook validation.

## 11. Scale validation

- [ ] Load representative data volumes into staging.
- [ ] Run `npm run verify:query-plans` against that dataset.
- [ ] Capture p50, p95 and p99 latency for major list, search and write operations.
- [ ] Monitor MongoDB documents examined/returned, blocking sorts, working set and connection pool saturation.
- [ ] Test concurrent account creation, provider conversion, withdrawal and payout operations.
- [ ] Confirm CloudWatch rotates streams every UTC 15 minutes and does not intentionally resend confirmed batches.

Broad free-text search should move to Atlas Search or dedicated normalized search fields before sustained million-record use. Per-process caches/rate limits should move to a shared store before horizontal scaling.

## 12. Go-live, deployment order and rollback

- [ ] Put CRM and Provider Portal writes into the agreed maintenance mode.
- [ ] Back up the database and deploy the CRM release first without enabling public traffic.
- [ ] Run contact identity migration v2, index verification and CRM readiness checks.
- [ ] Configure and validate the production Gupshup template, rule and webhook.
- [ ] Deploy the Provider Portal release and run its index/readiness checks.
- [ ] Start one instance of each portal and complete role-overlap, marketplace-count, mobile-filter and 20 km alert smoke tests before scaling out.
- [ ] Watch CloudWatch/Hostinger logs for startup, migration, index, MongoDB, OTP, S3, Gupshup, communication and payout errors.
- [ ] Enable traffic gradually, CRM first and then Provider Portal.
- [ ] Monitor transactions, duplicate-key errors, query timeouts and rate-limit responses.
- [ ] If a release blocker appears, stop traffic, restore the previous release, and follow the verified database rollback/restore procedure.
