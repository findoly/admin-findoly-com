# Findoly Customer Website ↔ CRM integration

The CRM exposes a server-to-server API under `/api/customer-portal`. The customer browser must never call these CRM endpoints directly and must never receive the shared token.

## CRM environment

```env
CUSTOMER_PORTAL_API_TOKEN=REPLACE_WITH_A_LONG_RANDOM_SHARED_SECRET
CRM_OTP_BASE_URL=https://api.findoly.com/otp
```

Customer requirement verification reuses the same external OTP proxy/gateway as CRM employee login. It does not use Communication Center OTP templates and therefore does not require an active WhatsApp authentication template in the CRM.

The existing CRM S3 settings continue to be used for Website Content images. A public image base is required through the existing `AWS_CLOUDFRONT_DOMAIN` or `S3_PUBLIC_BASE_URL` configuration.

## Customer website environment

Use the same shared token only on the findoly.com backend:

```env
CRM_CUSTOMER_PORTAL_BASE_URL=https://admin.findoly.com/api/customer-portal
CRM_CUSTOMER_PORTAL_API_TOKEN=REPLACE_WITH_THE_SAME_SHARED_SECRET
CRM_CUSTOMER_PORTAL_TIMEOUT_MS=6000
CRM_CONTENT_CACHE_MS=60000

# Only needed when the CRM media public URL uses a custom CDN origin
CUSTOMER_IMAGE_CDN_ORIGIN=https://cdn.example.com
```

## Endpoints

All endpoints require `Authorization: Bearer <CUSTOMER_PORTAL_API_TOKEN>`.

- `GET /api/customer-portal/website` — published homepage, categories, subcategories, services/products, and resolved public media URLs.
- `GET /api/customer-portal/categories` — CRM lead taxonomy compatibility endpoint.
- `POST /api/customer-portal/enquiries` — create an `Enquiry` lead from findoly.com. Requires a verified `otpId` for the same mobile number.
- `GET /api/customer-portal/enquiries?mobile=9876543210`
- `GET /api/customer-portal/enquiries/:enquiryId?mobile=9876543210`
- `POST /api/customer-portal/enquiries/:enquiryId/cancel`

Customer website enquiries are created in the existing `Enquiry` collection with `sourceWebsite=findoly.com`, `sourceChannel=customer-website`, and `sourceType=direct-customer`. `externalEnquiryId` is used for retry/idempotency protection. The CRM stores only a short-lived customer verification reference; the OTP itself is never stored by this customer-portal flow and the reference is consumed after a new enquiry is created.

## Customer mobile verification
Customer OTP is intentionally independent of CRM. `findoly.com` sends and verifies the four-digit OTP directly from its own backend against `api.findoly.com/otp`. Only after that verification succeeds does Findoly.com submit the requirement to this Customer Portal API with an authenticated server-to-server `mobileVerified` assertion. CRM does not send, verify, or persist customer OTPs.
