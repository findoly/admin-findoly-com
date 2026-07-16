# CRM OTP and employee access setup

## Required production environment

```env
NODE_ENV=production
AUTH_COOKIE_SECRET=use-a-long-random-secret-with-at-least-32-characters
AUTH_COOKIE_NAME=service_crm_admin
CRM_BOOTSTRAP_MOBILE=9000000000
CRM_BOOTSTRAP_NAME=CRM Administrator
CRM_OTP_BASE_URL=https://api.findoly.com/otp
```

`CRM_BOOTSTRAP_MOBILE` is used only when the employee collection is empty. The first successful OTP verification for that configured mobile creates the initial Super Admin profile and the default roles.

After the first administrator is created:

1. Sign in to the CRM with the bootstrap mobile.
2. Open **Employees** and create employee profiles with their mobile numbers.
3. Open **Roles & permissions** to assign default roles or create custom roles.
4. Remove `CRM_BOOTSTRAP_MOBILE` from the hosting environment if it is no longer needed.

## Authentication flow

1. Browser posts `{ "mobile": "..." }` to `/api/auth/send-otp`.
2. CRM confirms that the mobile belongs to an active employee, or matches the initial bootstrap mobile.
3. CRM forwards the request to `https://api.findoly.com/otp/send-otp`.
4. Browser posts `{ "mobile": "...", "otp": "..." }` to `/api/auth/verify-otp`.
5. CRM forwards only mobile and OTP to `https://api.findoly.com/otp/verify-otp`.
6. CRM confirms the employee and role are active, then creates a signed HTTP-only cookie for 24 hours.

No username, password, password hash, forgot-password route or reset-password flow is used.


## Browser origin rule

The login page uses relative URLs only. In development it calls the current app host, for example `http://localhost:3000/api/auth/verify-otp`; in production it automatically calls the deployed CRM host, for example `https://admin.findoly.com/api/auth/verify-otp`. The external Findoly OTP URL is used only inside the Node.js server and is never called directly by the browser.
