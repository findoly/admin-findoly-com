# Findoly Customer Portal CRM integration

The CRM exposes a server-to-server API under `/api/customer-portal`.
The browser must never call these endpoints directly.

## Required environment variable

```env
CUSTOMER_PORTAL_API_TOKEN=REPLACE_WITH_A_LONG_RANDOM_SHARED_SECRET
```

Use the same value as `CRM_CUSTOMER_PORTAL_API_TOKEN` in the customer website.

## Endpoints

- `GET /api/customer-portal/categories`
- `POST /api/customer-portal/enquiries`
- `GET /api/customer-portal/enquiries?mobile=9876543210`
- `GET /api/customer-portal/enquiries/:enquiryId?mobile=9876543210`
- `POST /api/customer-portal/enquiries/:enquiryId/cancel`

All endpoints require `Authorization: Bearer <CUSTOMER_PORTAL_API_TOKEN>`.
Customer mobile verification happens in the customer website through the existing OTP provider before these endpoints are called.
