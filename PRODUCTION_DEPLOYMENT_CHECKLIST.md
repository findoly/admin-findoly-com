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
- [ ] Resolve every duplicate mobile, WhatsApp or email across Agents, Providers, Employees and joining requests.
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

## 5. Contact uniqueness smoke tests

- [ ] Create an Agent with unique mobile/email.
- [ ] Attempt a Provider with the Agent's mobile; creation is rejected.
- [ ] Attempt an Employee with the Provider's email; creation is rejected.
- [ ] Attempt a Provider whose WhatsApp matches another entity's mobile; creation is rejected.
- [ ] Update one entity while preserving its own contacts; update succeeds.
- [ ] Update one entity to another entity's contact; update is rejected.
- [ ] Convert a provider joining request; contact ownership transfers to the created Provider.
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

## 8. Existing feature smoke tests

- [ ] Employee login/logout and role revocation.
- [ ] Provider, Agent and Employee create/update.
- [ ] Provider joining request review and conversion.
- [ ] Lead creation, verification, publication and provider unlock.
- [ ] Communication Center rules, templates, logs, OTP activity and provider-created notification.
- [ ] S3 File Manager list/upload/download/error logging.
- [ ] Razorpay webhook signature validation.
- [ ] WhatsApp, SES and message-delivery webhook validation.

## 9. Scale validation

- [ ] Load representative data volumes into staging.
- [ ] Run `npm run verify:query-plans` against that dataset.
- [ ] Capture p50, p95 and p99 latency for major list, search and write operations.
- [ ] Monitor MongoDB documents examined/returned, blocking sorts, working set and connection pool saturation.
- [ ] Test concurrent account creation, provider conversion, withdrawal and payout operations.
- [ ] Confirm CloudWatch rotates streams every UTC 15 minutes and does not intentionally resend confirmed batches.

Broad free-text search should move to Atlas Search or dedicated normalized search fields before sustained million-record use. Per-process caches/rate limits should move to a shared store before horizontal scaling.

## 10. Go-live and rollback

- [ ] Start one instance and complete smoke tests before scaling out.
- [ ] Watch CloudWatch/Hostinger logs for startup, migration, index, MongoDB, OTP, S3, communication and payout errors.
- [ ] Enable traffic gradually.
- [ ] Monitor transactions, duplicate-key errors, query timeouts and rate-limit responses.
- [ ] If a release blocker appears, stop traffic, restore the previous release, and follow the verified database rollback/restore procedure.
