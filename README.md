# Service CRM Admin

Generic monolithic admin CRM for multi-website, multi-category service enquiries. It keeps the VetsKart-style business workflow, but supports any provider category such as veterinary care, carpentry, painting, plumbing, electrical, cleaning and future service verticals.

## What this version supports

- Local MongoDB or MongoDB Atlas through **Mongoose**.
- Website-specific service modules with an inline form builder.
- Dynamic form templates selected by:
  - `sourceWebsite`
  - `categorySlug`
  - `formType`
- Manual admin booking with dynamic fields per category/form type.
- Enquiries can be saved even when some dynamic fields are missing.
- Enquiry detail page shows missing required dynamic fields and allows admins to complete them later.
- External website/API intake with flexible `fields`, `formData`, or `dynamicFields` object.
- Provider assignment, follow-ups, communications, billing, reports and audit logs.
- Limitless/Bootstrap based admin UI with a classic operations-console layout, responsive sidebar, mobile-friendly forms, and dense laptop tables.

## Current storage

This app uses **MongoDB through Mongoose**. It works with a **local MongoDB database for testing/development** and MongoDB Atlas for staging/production.

MongoDB collections created by the app:

- `enquiries`
- `providers`
- `categories`
- `formtemplates`
- `followups`
- `communications`
- `invoices`
- `auditlogs`

## Local MongoDB setup

Install and start MongoDB locally, then use this URI:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/service_crm_admin
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/service_crm_admin_test
```

Common local start commands:

```bash
# macOS Homebrew
brew services start mongodb-community

# Linux systemd
sudo systemctl start mongod

# Docker
docker run -d --name service-crm-mongo -p 27017:27017 mongo:7
```

## Setup

```bash
cp .env.example .env
npm install
```

The default `.env.example` already points to local MongoDB:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/service_crm_admin
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/service_crm_admin_test
```

When you later move to Atlas, replace `MONGODB_URI` with your Atlas connection string. Do not commit `.env` because it may contain database credentials.

## Seed demo data

After MongoDB is running:

```bash
npm run seed
```

This seeds demo service modules, providers, dynamic templates, enquiries and follow-ups into MongoDB. Demo data includes `woodoly.com` examples with multiple categories and form types.

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Default demo admin login:

```text
Email: admin@example.com
Password: change-me
```

For auto-restart during development:

```bash
npm run dev
```

## How dynamic forms work

Create website modules and their forms from:

```text
/catalog/categories
```

A module defines which category belongs to which source website, and the inline **Form builder** defines exactly what the website form/admin manual booking should collect. The matching key is:

```text
sourceWebsite + categorySlug + formType
```

Example:

```text
sourceWebsite: woodoly.com
categorySlug: furniture-repair
formType: wardrobe-repair
```

You can also manage standalone templates from:

```text
/catalog/templates
```

A template defines the fields that should appear for that website/category/form type. For example, Woodoly can have separate templates for:

- `furniture-repair + wardrobe-repair`
- `modular-kitchen + kitchen-installation`
- `wall-painting + painting-quote`
- `waterproofing + waterproofing-quote`

Each template can have fields like text, textarea, number, select, radio, checkbox, date, email, tel, URL or file URL.

Manual enquiry creation from `/enquiries/new` loads the matching template. Dynamic required fields are shown to the admin, but they do not block saving. Later, open the enquiry detail page and use **Update dynamic form data** to fill missing fields.

## Form Schema API for websites

External websites can ask the CRM what fields to render before submitting enquiries:

```http
GET /api/forms/schema?sourceWebsite=woodoly.com&categorySlug=furniture-repair&formType=wardrobe-repair
```

Alias endpoint:

```http
GET /api/form-schema?sourceWebsite=woodoly.com&categorySlug=furniture-repair&formType=wardrobe-repair
```

Example response shape:

```json
{
  "ok": true,
  "data": {
    "sourceWebsite": "woodoly.com",
    "categorySlug": "furniture-repair",
    "formType": "wardrobe-repair",
    "fields": [
      {
        "name": "requirement",
        "label": "Requirement",
        "type": "textarea",
        "required": true,
        "group": "Requirement",
        "placeholder": "Describe customer requirement"
      }
    ],
    "submitEndpoint": "/api/enquiries"
  }
}
```

The website should render these fields and submit values in `fields`, `formData`, or `dynamicFields`.

## Generic enquiry intake API

External websites can send enquiries here:

```http
POST /api/enquiries
Content-Type: application/json
```

Example with Woodoly dynamic form data and source information:

```json
{
  "source": {
    "website": "woodoly.com",
    "channel": "landing-page",
    "campaign": "woodoly-launch",
    "formId": "wardrobe-repair",
    "landingPage": "https://woodoly.com/wardrobe-repair",
    "referrer": "https://google.com",
    "externalEnquiryId": "WOOD-1001",
    "utm": {
      "source": "google",
      "medium": "cpc",
      "campaign": "bengaluru-wardrobe"
    },
    "metadata": {
      "sourceIp": "203.0.113.10",
      "device": "mobile"
    }
  },
  "categorySlug": "furniture-repair",
  "formType": "wardrobe-repair",
  "serviceType": "Wardrobe repair",
  "priority": "normal",
  "customer": {
    "name": "Amit Verma",
    "mobile": "9876543210",
    "email": "amit@example.com"
  },
  "address": {
    "line1": "Indiranagar",
    "city": "Bengaluru",
    "state": "Karnataka",
    "pincode": "560038"
  },
  "preferredDate": "2026-07-11",
  "preferredSlot": "Afternoon",
  "fields": {
    "workType": "Wardrobe repair",
    "furnitureItem": "Sliding wardrobe",
    "issueDescription": "One shutter is not sliding properly",
    "photos": ["https://example.com/photo.jpg"]
  },
  "notes": "Customer wants inspection before quote."
}
```

### Required intake fields

- `customer.mobile` or `mobile`
- `categorySlug` or `category`
- `source.website` or `sourceWebsite`
- `fields`, `formData`, or `dynamicFields` as an object

The dynamic object is intentionally flexible. A painting enquiry can send `rooms`, a carpentry enquiry can send `material`, a veterinary enquiry can send `petType`, and a future category can send any other keys without adding new database columns.

## Source information supported

The API and admin manual-entry screen support:

- `source.website`
- `source.channel`
- `source.campaign`
- `source.formId`
- `source.landingPage`
- `source.referrer`
- `source.externalEnquiryId`
- `source.utm.source`
- `source.utm.medium`
- `source.utm.campaign`
- `source.utm.term`
- `source.utm.content`
- `source.metadata`

Flat aliases are also supported for website forms, such as `sourceWebsite`, `sourceChannel`, `campaign`, `formId`, `landingPage`, `referrer`, `externalEnquiryId`, `utm_source`, `utm_medium`, and `utm_campaign`.

## Health check

```http
GET /api/health
```

Example response:

```json
{
  "ok": true,
  "service": "service-crm-admin",
  "database": {
    "connected": true,
    "name": "service_crm_admin"
  }
}
```

## Tests

Syntax/import check:

```bash
npm run check
```

Unit tests that do not require MongoDB:

```bash
npm test
```

MongoDB integration test against your local test database:

```bash
RUN_MONGO_INTEGRATION=true npm test
```

With the default config, the integration test uses:

```env
mongodb://127.0.0.1:27017/service_crm_admin_test
```

Keep `TEST_MONGODB_URI` set to a separate database so test data does not mix with development data.

## Main admin routes

- `/dashboard`
- `/enquiries`
- `/providers`
- `/follow-ups`
- `/billing`
- `/catalog/categories`
- `/catalog/templates`
- `/communications`
- `/reports`
- `/api/enquiries`

## Migration notes from old portal

| Old portal concept | New generic concept |
| --- | --- |
| Vet / Doctor | Provider |
| Vet booking | Enquiry / Booking |
| Home service / consultation | Service request |
| Assign vet | Assign provider |
| Doctor payment | Provider payout / billing |
| VetsKart-only source | Multi-website source |
| Fixed vet forms | Dynamic website/category/form templates |

## Production hardening checklist

- Use environment variables for MongoDB credentials.
- Use MongoDB Atlas or a managed MongoDB deployment for production.
- Add API key or request-signature verification for `/api/enquiries`.
- Replace demo cookie login with SSO or a real admin-user database.
- Add role-based permissions for admin, manager, caller, finance and operations teams.
- Add retry queue for communication webhooks/AWS Lambda failures.
- Add attachment storage for enquiry photos and provider documents.
- Add audit retention and backup policies.

## UI update notes

The admin UI now uses the uploaded Limitless/Bootstrap CSS as the base layout. The shell is built with theme classes such as `navbar`, `page-content`, `sidebar`, `content-wrapper`, `content-inner`, `page-header`, `nav-sidebar`, Bootstrap cards, buttons, tables, and responsive grid utilities. The local `public/css/app.css` file only contains CRM-specific compatibility helpers and mobile fixes.

The category builder screen is mobile-first: field-builder rows stack on small screens and use auto-fit columns on laptop/desktop. Every website/category/form type can define its own fields, and external websites can call the schema API before rendering their intake form:

```http
GET /api/forms/schema?sourceWebsite=woodoly.com&categorySlug=furniture-repair&formType=wardrobe-repair
```

## Search and edit workflow

The admin CRM now uses separate Finder-style search pages instead of mixing all records into one result page. The Search menu contains dedicated table views with pagination and View/Edit actions:

- `/search/enquiries` — enquiry-only search with website/category/status/form filters.
- `/search/providers` — provider-only search with category/status/city filters.
- `/search/invoices` — invoice-only search with status and enquiry filters.
- `/search/follow-ups` — follow-up task search.
- `/search/communications` — communication log search.

`/search` redirects to `/search/enquiries`, and the top navbar search opens the enquiry finder by default.

Common edit routes:

- `GET /enquiries/:id/edit` — full enquiry edit screen for source website, category, form type, customer, address, status, pricing, notes and dynamic form fields.
- `POST /enquiries/:id` — saves core enquiry and dynamic field changes.
- `POST /enquiries/:id/assign` — assigns or reassigns a provider.
- `GET /providers/:id/edit` — full provider profile edit screen for contact, categories, skills, service areas, rating and document status.
- `POST /providers/:id` — saves provider changes.

Provider assignment is intentionally open. The recommendation list scores all active providers by category match, customer city/service area, provider city, rating and availability, but the admin can still choose another active provider when needed.

## Navigation and separated operations

Operational modules are intentionally split into list/search/create/detail pages so admins do not have to create and manage records on the same crowded screen:

- Enquiries: `/enquiries`, `/enquiries/new`, `/search/enquiries`, `/enquiries/:id`, `/enquiries/:id/edit`
- Providers: `/providers`, `/providers/new`, `/search/providers`, `/providers/:id`, `/providers/:id/edit`
- Follow-ups: `/follow-ups`, `/follow-ups/new`, `/search/follow-ups`, `/follow-ups/:id`, `/follow-ups/:id/edit`
- Communications: `/communications`, `/communications/new`, `/search/communications`, `/communications/:id`, `/communications/:id/edit`
- Billing: `/billing`, `/billing/new`, `/search/invoices`, `/billing/:id`, `/billing/:id/edit`

Each list page has its own table, filters, pagination, View action, and Edit action where editing is supported. The sidebar groups these pages by workflow so the user can move from list → create → view → edit → search without mixing records from different modules on one screen.

Additional read APIs are available for internal integrations and page-level API links:

```http
GET /api/follow-ups
GET /api/follow-ups/:id
GET /api/communications
GET /api/communications/:id
GET /api/invoices
GET /api/invoices/:id
```

## Simple internal UI skin

The admin UI uses a calm internal-operations skin: neutral navigation, white cards, subtle status accents, and clearer tables with hover rows, compact spacing, status badges, and visible action buttons. Heavy gradients are intentionally avoided because the app is for employees, not customer-facing marketing.
