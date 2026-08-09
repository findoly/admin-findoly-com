# Findoly CRM production hardening report

## Release assessment

This release addresses the source-code production blockers found in the August 2026 audit. It is suitable for a staged production rollout after the database migrations, index verification, and real Atlas query-plan checks in this document have passed.

This package is not a blanket certification that every query will remain fast at one million records. That claim requires the production-sized Atlas dataset, tier, indexes, traffic profile, and `explain("executionStats")` output. The release includes an automated query-plan gate so those checks can be performed against staging or production-like data before traffic is increased.

## Major corrections

### Startup and configuration

- The Hostinger listener binds before AWS Secrets Manager, MongoDB, and Express imports.
- Until bootstrap completes, the listener returns a controlled HTTP 503 response.
- All application environment values load before Express, routes, models, and database modules.
- Production configuration now requires an explicit MongoDB database name, a strong public-intake token, valid HTTPS origins, and bounded pool/rate-limit values.
- `/api/health` no longer exposes the database name.

### Admin request security

- Authenticated browser mutations now require the configured CRM origin.
- Cross-site requests and unsupported mutation content types are rejected.
- Login return paths are parsed as same-origin local paths and reject backslash/external-origin tricks.
- Safe request IDs are generated or accepted from bounded, validated headers.
- Server errors log a sanitized error shape and request ID.

### OTP security

- Login responses no longer reveal whether an employee mobile exists.
- OTP send requests have both mobile and network/IP throttles.
- OTP verification has a separate network/IP throttle.
- OTP rate-limit collections have TTL/index coverage in the production index manifest.

### Dates and migrations

- `FollowUp.dueAt` is stored as BSON `Date` rather than text.
- `Invoice.issueDate` and `Invoice.dueDate` are stored as BSON `Date`.
- Explicit dry-run-capable migrations convert legacy values and report malformed records without silently erasing them.

### Index and query controls

- Every CRM model is included in production index creation and verification.
- Representative cursor sorts include `_id` tie-breakers in their compound indexes.
- All cursor-paginated list queries apply a bounded MongoDB execution time.
- `verify:query-plans` runs representative `executionStats` plans and fails on collection scans, blocking sorts, or excessive scan ratios.
- Provider-subscription search no longer silently omits providers after an arbitrary 500-provider cap.
- Dashboard counts no longer materialize thousands of document IDs.
- Managed category reads no longer scan legacy lead values by default.

### Contact uniqueness

- Mobile, WhatsApp, and email contacts use a shared `contactidentities` registry across Agents, Providers, Employees, and Provider joining requests.
- Mobile and WhatsApp share one phone namespace, preventing cross-field duplication.
- Account creation and contact updates reserve identities within MongoDB transactions.
- Registration communication occurs only after the account transaction commits.
- Provider-request conversion can transfer the request's reserved contact identities to the final Provider.
- A streaming migration uses a unique staging collection, reports conflicts with bounded samples, and atomically swaps the completed registry.

### Financial consistency

- Partner withdrawal submission, approval transitions, payout completion, failure, reversal, and eligibility changes are transaction-protected.
- A unique active-withdrawal slot prevents concurrent active requests for one Agent.
- Referral rows are locked while payout processing is in progress.
- Uncertain payout-provider responses remain in a reconcilable processing state rather than being incorrectly marked failed.
- Confirmed failures and reversals release the appropriate referral rows.
- Terminal webhook handling is idempotent.

### Bounded document growth

- Communication, enquiry, and payout histories are capped when written.
- External provider/webhook payloads are bounded before MongoDB storage.
- CloudWatch events use fixed UTC 15-minute streams and confirmed batches are removed from the pending queue so they are not intentionally republished.

## New operational commands

```bash
npm run migrate:provider-contacts -- --dry-run
npm run migrate:follow-up-dates -- --dry-run
npm run migrate:invoice-dates -- --dry-run
npm run migrate:withdrawal-slots -- --dry-run
npm run migrate:contact-identities -- --dry-run

npm run migrate:provider-contacts
npm run migrate:follow-up-dates
npm run migrate:invoice-dates
npm run migrate:withdrawal-slots
npm run migrate:contact-identities

npm run ensure:indexes
npm run verify:indexes
npm run verify:query-plans
npm run preflight:production
```

Run the contact-identity migration in a maintenance window with one writer. It derives a cross-collection uniqueness registry and must not race concurrent Agent, Provider, Employee, or provider-request creation.

## Required or recommended environment values

```env
CRM_ADMIN_ORIGIN=https://admin.findoly.com
CRM_QUERY_MAX_TIME_MS=10000

CRM_OTP_MAX_IP_REQUESTS_PER_HOUR=30
CRM_OTP_IP_RATE_WINDOW_SECONDS=3600
CRM_OTP_MAX_IP_VERIFY_ATTEMPTS_PER_HOUR=60
CRM_OTP_IP_VERIFY_WINDOW_SECONDS=3600

PUBLIC_INTAKE_API_TOKEN=REPLACE_WITH_A_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS

# Optional per-process cache tuning
DASHBOARD_CACHE_TTL_MS=60000
DASHBOARD_COUNT_CAP=10000
COMMUNICATION_DASHBOARD_CACHE_TTL_MS=30000
```

`MONGODB_URI` must point to MongoDB Atlas or another replica set that supports transactions and must include the database name explicitly.

## Test evidence in this workspace

- Static production QA passed for 183 JavaScript files, 42 EJS inline scripts, 47 views, and 126 API handler references.
- 32 focused production-hardening tests passed.
- 235 dependency-independent architecture, security, validation, UI, and regression tests passed.
- The complete test discovery found 249 tests: 238 passed and 11 could not start because this workspace did not have `mongoose` or `supertest` installed.
- `npm ci` could not complete in this workspace because the available package registry returned a 404 for the existing `wrappy` dependency. No assertion failure was observed in the dependency-independent suite.

A release machine with normal npm registry access must run `npm ci`, `npm run check`, `npm test`, `npm run qa:production`, and the database-backed preflight before deployment. In this workspace, `npm run check` also could not start because `ejs` was unavailable after the failed dependency installation.

## Residual risks and next scaling steps

These are not hidden; they require production infrastructure or a broader architecture change:

1. **Free-text search at one million records.** Exact mobile/email/ID lookups are indexed and general text searches are bounded, but broad name/message prefix search should move to MongoDB Atlas Search or dedicated normalized search fields before sustained million-record use.
2. **Real query-plan certification.** Run `npm run verify:query-plans` against representative data and review Atlas Performance Advisor. Empty development databases cannot prove production selectivity.
3. **Provider Portal contact registry.** This CRM owns the shared registry, but the public Provider Portal should adopt the same transactional contact-reservation service so public submissions cannot race CRM account creation.
4. **Communication delivery.** External email/WhatsApp delivery is still initiated from application workflows. A transactional outbox and background worker are recommended at higher traffic.
5. **Shared caches and distributed rate limits.** Dashboard caches and the public-intake IP limiter are per process. Redis or another shared store is recommended when running multiple instances.
6. **Customer Portal authentication.** The current shared service token should eventually be replaced with customer-scoped, expiring signed sessions/tokens.
7. **Sensitive S3 uploads.** Add post-upload file-signature verification, checksum enforcement, malware scanning, and quarantine before using S3 for identity documents.
8. **Load testing.** Generate representative production-like records and measure p50/p95/p99 latency, pool saturation, index size, working set, and transaction conflict rates.

## Go-live verdict

Proceed only as a staged rollout after:

- backup and rollback rehearsal;
- all migration dry runs are clean;
- non-dry migrations complete;
- index creation and verification pass;
- query-plan verification passes on production-like data;
- the full dependency-backed test suite passes on the release machine;
- duplicate-contact, OTP, provider creation, withdrawal, payout, communication, and rollback smoke tests pass.

Do not describe the system as one-million-record certified until the real Atlas query plans and load-test measurements pass.
