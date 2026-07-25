# Findoly CRM production QA report

Date: 25 July 2026  
Source reviewed: `admin.findoly-updated.zip`

## Release assessment

The two reported release blockers were reproduced at code-path level and corrected:

1. **Provider creation could report failure because external pincode verification or post-save lead synchronisation failed.** Provider creation now commits the provider first. Temporary Google Maps failures use validated manual city/state, while lead synchronisation and registration notifications run as non-blocking post-create work.
2. **OTP could be delivered while the CRM returned `OTP_SERVICE_UNAVAILABLE`.** The OTP proxy now accepts JSON and plain-text acknowledgements and treats gateway 5xx/timeouts as an uncertain acknowledgement. The login page proceeds to verification with HTTP 202 when delivery may already have occurred. OTP verification remains mandatory and authoritative.

## Automated QA completed

- JavaScript syntax: **137 files passed**.
- EJS inline JavaScript syntax: **39 blocks passed**.
- EJS view/include and frontend route audit: **43 views passed**.
- API route/controller export audit: **116 handler references passed**.
- Package manifest/lock root consistency: passed.
- Critical dependency-free regression tests: **134 passed, 0 failed**.
- `git diff --check`: passed.

Run the same checks with:

```bash
npm run qa:production
```

The full dependency-backed `npm test` suite could not be executed in the isolated QA environment because `node_modules` was not present and the npm registry was unavailable. Run `npm ci`, `npm run check`, and `npm test` in staging before deployment.

## Critical fixes and hardening

### Provider, address and pincode

- Provider mobile is validated as an Indian 10-digit number beginning with 6–9 in frontend, service and schema layers.
- Provider service pincode is required and must be six digits without a leading zero.
- City/state are required for the manual pincode fallback.
- Invalid/legacy cached pincode coordinates are ignored and refreshed.
- Temporary maps failure no longer prevents provider creation.
- Provider lead synchronisation no longer makes a successful create/update appear failed.
- Registration email rule failure no longer makes account creation appear failed.
- Duplicate provider mobile receives a clear 409 response before insert.

A provider saved through manual location fallback has no verified latitude/longitude and will not receive radius-matched leads until location verification succeeds and **Sync leads** is run. This is intentional to avoid using incorrect coordinates.

### OTP and login

- Supports JSON and plain-text OTP-provider responses.
- Distinguishes confirmed provider rejection from uncertain gateway acknowledgement.
- Uses server-side OTP resend throttling.
- Prevents duplicate send/verify clicks in the browser.
- Validates employee mobile and OTP format on both sides.
- Keeps OTP verification fail-closed.
- Session cookie is signed, HTTP-only, `SameSite=Lax`, and `Secure` in production.

### Provider, agent and employee registration emails

- Provider, Agent and Employee registration events remain managed through Communication Center rules.
- Registration rules stay disabled until a template is selected and the rule is enabled.
- Email templates must be active before an email rule can use them.
- Missing templates, SES errors or rule errors are logged without rolling back account creation.
- Idempotency keys prevent duplicate registration sends.

### Agent and employee validation

- Indian mobile validation is consistent in UI, service and model layers.
- Shop agents require a business name.
- Agent pincode requires city/state.
- Agent payout amount, mode and Razorpay fund-account conditions are validated.
- Duplicate Agent and Employee mobile numbers produce clear conflict errors.
- Employee role selection is required and checked against an active role.

### Leads and provider journey

- Lead mobile, pincode, city and state validation is aligned frontend/backend.
- Lead metadata and additional-details objects reject unsafe Mongo-style keys and excessive depth/size.
- Lead status, referral validation, notes, distribution and reactivation actions have duplicate-submit guards.
- Communication failures after a successful lead mutation are non-blocking.
- Distribution still requires verified coordinates because radius matching cannot safely use manual/unverified coordinates.
- Multi-record lead and distribution lists use bounded cursor pagination.

### Billing and follow-ups

- Invoice number duplication produces a clear conflict response.
- Invoice line descriptions, quantity, rate, tax and totals are validated.
- Invoice dates and date order are checked.
- Follow-up date/time, status, notes and record identifiers are validated.
- Invoice and follow-up forms prevent duplicate submits.

### Credits and partner payouts

- Provider credit addition remains permission-protected, atomic and idempotent.
- Payout mode is restricted to UPI, IMPS, NEFT or RTGS.
- Razorpay calls have bounded timeouts and controlled upstream errors.
- Concurrent payout processing uses an atomic claim and rejects a second attempt.
- Razorpay webhook signatures use HMAC verification.
- Eligibility now uses database counts and bounded selection rather than loading all eligible leads into Node.js.
- `AGENT_WITHDRAWAL_MAX_REFERRALS` defaults to 1,000 and is constrained to 10–5,000 in multiples of 10. Remaining eligible referrals stay available for a later withdrawal.

### Communication Center

- Template/rule duplicate conflicts have clear messages.
- Manual email send requires an active email template.
- WhatsApp rules require approved templates.
- Communication dashboard status/channel counts run as MongoDB aggregation instead of reading every log row into Node.js.
- WhatsApp raw-body signature, Amazon SNS signature and Razorpay webhook verification remain intact.
- Message-delivery and integration-event tokens use constant-time comparison.
- Communication actions have browser duplicate-submit guards.

### S3 File Manager

- S3 is optional; incomplete S3 configuration disables File Manager instead of crashing the CRM.
- Path traversal and access outside configured public/private prefixes are blocked.
- File extension, MIME type, size, filename and signed-URL expiry are validated.
- Private downloads use short-lived signed URLs.
- Public asset URLs use the configured CloudFront hostname.
- S3 secrets stay server-side.
- Delete, move and rename remain intentionally unavailable.

### Runtime and security

- Production configuration fails fast for missing MongoDB URI or weak session secret.
- Node.js requirement is aligned to **20+**, matching the locked AWS SDK.
- Request body limits are 2 MB; webhook limits are smaller.
- `X-Powered-By` is disabled and security headers are added.
- Production HSTS is enabled.
- CORS is allow-list based through `CORS_ORIGINS`.
- Public intake endpoints have rate limiting and optional token protection.
- Customer portal, Communication OTP and Communication Event integrations have separate tokens.
- API errors handle invalid JSON, oversized bodies, duplicate keys, Mongoose validation and invalid IDs consistently.
- Health and readiness endpoints are available at `/api/health` and `/api/ready`.
- Startup waits for the database, validates the port and handles shutdown signals.

## Module QA matrix

| Module | Static/regression QA | Required staging manual test |
|---|---|---|
| Login and OTP | Passed | Real OTP send, uncertain ACK, wrong OTP, resend wait, inactive employee |
| Dashboard | Passed | Counts and recent rows against staging data |
| Providers | Passed | Create/edit, maps on/off, duplicate mobile, manual fallback, sync |
| Agents | Passed | Individual/shop create/edit, payout conditions, registration rule |
| Employees and roles | Passed | Create/edit/deactivate, role permission revocation, registration rule |
| Categories | Passed | Create/edit duplicate slug/name handling |
| Leads/requirements | Passed | Create/edit, referral validation, status journey, publish, deactivate/reactivate |
| Provider statuses | Passed | Confirm/reject/on-hold/invalid, reason/note, sale conversion |
| Distribution | Passed | Radius matching and pagination with real coordinates |
| Follow-ups | Passed | Create/edit/date validation and filters |
| Billing | Passed | Create/edit, duplicate invoice, calculations and statuses |
| Provider credits | Passed | Idempotency and balance transaction using staging DB transaction support |
| Agent withdrawals | Passed | Eligibility, approvals, concurrency and Razorpay test payout/webhook |
| Communication Center | Passed | Email/WhatsApp/Slack send, rules, retry, webhooks and logs |
| S3 File Manager | Passed | Real bucket list, folder, public/private upload, preview and download |
| Customer/agent integrations | Passed | Tokens, CORS and real portal payload compatibility |
| Reports/search | Passed | Filters, permissions and paginated result navigation |

## Known deployment prerequisites

- Use Node.js 20 or newer.
- Run `npm ci` from the included lock file.
- Run migrations/backfills on a database backup before switching traffic.
- Verify MongoDB indexes completed successfully.
- Configure all production secrets in the hosting environment, never in the ZIP.
- Test OTP, SES, Meta, Slack, Razorpay, Google Maps and S3 against staging credentials.
- Confirm `TRUST_PROXY` for the hosting platform before enabling secure-cookie traffic.
- Add every authorised external portal origin to `CORS_ORIGINS`.
- Back up MongoDB and keep the prior deployment package available for rollback.
