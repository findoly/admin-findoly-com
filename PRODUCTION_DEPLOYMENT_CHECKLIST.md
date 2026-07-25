# Findoly CRM production deployment and manual QA checklist

## 1. Deployment gate

- [ ] Use **Node.js 20+** (`node --version`).
- [ ] Take a MongoDB backup/snapshot.
- [ ] Keep the previous working deployment package and environment configuration for rollback.
- [ ] Extract the release into a new directory; do not overwrite the running release in place.
- [ ] Run `npm ci`.
- [ ] Run `npm run qa:production`.
- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run the required migrations/backfills against staging first.
- [ ] Confirm `/api/health` returns 200.
- [ ] Confirm `/api/ready` returns 200 after MongoDB connects.

## 2. Required environment review

Core:

```env
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
MONGODB_URI=
AUTH_COOKIE_SECRET=
CORS_ORIGINS=https://admin.findoly.com,https://findoly.com,https://provider.findoly.com,https://agent.findoly.com
```

`AUTH_COOKIE_SECRET` must be at least 32 random characters. Adjust `TRUST_PROXY` to the hosting provider; do not blindly use an untrusted proxy setting.

CRM login OTP:

```env
CRM_OTP_BASE_URL=https://api.findoly.com/otp
# Optional overrides
CRM_OTP_SEND_URL=
CRM_OTP_VERIFY_URL=
CRM_OTP_REQUEST_TIMEOUT_MS=12000
CRM_OTP_SEND_ALLOW_UNCONFIRMED=true
CRM_OTP_RESEND_SECONDS=30
CRM_OTP_MAX_SENDS_PER_MINUTE=2
CRM_OTP_RATE_WINDOW_SECONDS=60
```

Integration protection:

```env
PUBLIC_INTAKE_API_TOKEN=
CUSTOMER_PORTAL_API_TOKEN=
COMMUNICATION_EVENT_API_TOKEN=
COMMUNICATION_OTP_API_TOKEN=
MESSAGE_LAMBDA_WEBHOOK_TOKEN=
```

Registration links:

```env
SUPPORT_EMAIL=support@findoly.com
PROVIDER_PORTAL_LOGIN_URL=https://provider.findoly.com/login
AGENT_PORTAL_LOGIN_URL=https://agent.findoly.com/login
EMPLOYEE_CRM_LOGIN_URL=https://admin.findoly.com/login
```

Location:

```env
GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_TIMEOUT_MS=8000
```

Agent payouts:

```env
AGENT_WITHDRAWAL_MAX_REFERRALS=1000
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAYX_ACCOUNT_NUMBER=
RAZORPAY_PAYOUT_WEBHOOK_SECRET=
RAZORPAY_HTTP_TIMEOUT_MS=15000
```

S3, SES, WhatsApp and Slack are documented in `S3_FILE_MANAGER_SETUP.md` and `COMMUNICATION_ENV_KEYS.md`.

## 3. Database checks

- [ ] Confirm no duplicate provider `normalizedMobile` values before adding any future unique index.
- [ ] Confirm Agent and Employee unique mobile indexes are healthy.
- [ ] Confirm named IDs are present and unique for every primary collection.
- [ ] Confirm lead and distribution pagination indexes exist.
- [ ] Confirm `PincodeLocation` rows contain finite latitude/longitude values.
- [ ] Confirm MongoDB supports transactions for provider credit operations.
- [ ] Review index build logs for errors or duplicate-key failures.

Suggested duplicate-provider query:

```javascript
db.providers.aggregate([
  { $match: { normalizedMobile: { $type: "string", $ne: "" } } },
  { $group: { _id: "$normalizedMobile", count: { $sum: 1 }, providerIds: { $push: "$providerId" } } },
  { $match: { count: { $gt: 1 } } }
])
```

## 4. Manual QA scripts

### Login and OTP

- [ ] Active employee receives OTP and can sign in.
- [ ] OTP provider returns JSON success.
- [ ] OTP provider returns plain-text success.
- [ ] Simulate/observe gateway timeout after an OTP arrives; CRM should move to OTP entry with an accepted message.
- [ ] Wrong OTP does not create a session.
- [ ] Resend before wait ends returns 429 and `Retry-After`.
- [ ] Inactive employee cannot request/login.
- [ ] Logout clears the session and protected pages redirect to login.

### Provider

- [ ] Create with valid Indian mobile, category and pincode.
- [ ] Create while Google Maps is available; city/state and coordinates are verified.
- [ ] Create while Google Maps is unavailable; manually entered city/state are saved and the account still succeeds.
- [ ] Duplicate provider mobile returns a clear conflict.
- [ ] Invalid pincode/mobile/email are rejected frontend and backend.
- [ ] Edit categories, status and portal access.
- [ ] Click **Sync leads** after a manually saved location is verified.
- [ ] Disable registration rule: account creates with no email.
- [ ] Enable rule with active Provider template: one email is logged/sent.
- [ ] Break SES temporarily: provider still creates and failure is visible in communication logs.

### Agent

- [ ] Create individual agent.
- [ ] Shop agent without business name is blocked.
- [ ] Pincode with missing city/state is blocked.
- [ ] Invalid payout mode/rate is blocked.
- [ ] Enabling payout without Razorpay fund account is blocked.
- [ ] Duplicate mobile/referral ID returns a clear conflict.
- [ ] Agent registration rule sends only once.

### Employee and roles

- [ ] Create employee with active role and valid mobile.
- [ ] Missing/inactive role is rejected.
- [ ] Duplicate mobile is rejected.
- [ ] Disable employee and confirm existing cookie loses access on next request.
- [ ] Remove a permission and confirm API and page access are both denied.
- [ ] Employee registration rule sends only once.

### Lead journey

- [ ] Create lead with valid mobile, pincode, city/state and category.
- [ ] Edit lead without changing its reference ID.
- [ ] Agent lead requires the mandatory validation and status-change notes.
- [ ] Invalid referral moves to Rejected as expected.
- [ ] Valid lead advances through New → Verification → Approved → Distributed.
- [ ] Publishing before Distributed is rejected.
- [ ] Publishing without verified coordinates is rejected clearly.
- [ ] Duplicate publish click produces one result.
- [ ] Provider Confirmed changes sale conversion; removing all confirmations returns to Distributed.
- [ ] Deactivate and reactivate retain the record and timeline.

### Communication Center

- [ ] Create active email templates for Provider, Agent and Employee.
- [ ] Attach each template to the corresponding registration rule and enable it.
- [ ] Save rule with inactive email template is rejected.
- [ ] Send direct Email, WhatsApp and Slack test messages.
- [ ] Retry a failed log once and check idempotency behaviour.
- [ ] Verify WhatsApp webhook challenge and signed event.
- [ ] Verify SES SNS delivery/bounce event.
- [ ] Verify message-delivery integration rejects an invalid token.

### Billing, follow-ups and categories

- [ ] Create invoice with valid line items and totals.
- [ ] Duplicate invoice number is rejected.
- [ ] Negative/invalid quantity, rate or tax are rejected.
- [ ] Due date before issue date is rejected.
- [ ] Create/edit follow-up with valid local date-time.
- [ ] Create duplicate category name/slug and confirm clear error.

### Credits and payouts

- [ ] Add provider credits with an authorised role.
- [ ] Repeat the exact idempotency request and confirm balance changes once.
- [ ] Confirm unauthorised role cannot add credits.
- [ ] Validate agent eligibility counts with known test data.
- [ ] Submit and approve withdrawal through all stages.
- [ ] Double-click payout and confirm only one Razorpay request is claimed.
- [ ] Use Razorpay test mode and a signed payout webhook.
- [ ] Confirm failed payout can be safely reviewed/retried according to status rules.

### S3 File Manager

- [ ] Without S3 variables, CRM starts and File Manager shows configuration disabled.
- [ ] List root/public/private prefixes.
- [ ] Create a folder.
- [ ] Upload allowed image and PDF.
- [ ] Reject oversized file, forbidden extension and path traversal.
- [ ] Preview/download a private file using the short-lived URL.
- [ ] Copy public CloudFront URL.
- [ ] Replace an existing file only after the UI confirmation.
- [ ] Confirm a `storage.view`-only role cannot upload.

### Pagination and load

- [ ] Navigate next/previous on leads, providers, agents, distributions, communications, invoices and follow-ups.
- [ ] Invalid/oversized cursor returns 400, not 500.
- [ ] Verify filters use indexes with MongoDB `explain()` on staging-sized data.
- [ ] Load Communication dashboard with a large log collection and monitor MongoDB/application memory.
- [ ] Verify partner eligibility does not load all eligible referrals into application memory.

## 5. Go-live and rollback

- [ ] Put the application in a short maintenance/read-only window if migrations are required.
- [ ] Deploy the new release directory and environment variables.
- [ ] Start one instance and complete smoke tests before scaling out.
- [ ] Watch logs for `INVALID_RUNTIME_CONFIG`, MongoDB, OTP, geocoding, SES, Razorpay and S3 errors.
- [ ] Confirm provider create and OTP login first; these are the release-critical checks.
- [ ] Enable traffic gradually.
- [ ] If a blocker appears, restore the previous release and database snapshot/migration rollback plan.
