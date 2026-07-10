# LeadOps CRM

Internal Express/EJS CRM for receiving, verifying, categorizing, approving, following up, and searching customer leads from websites, agents, calls, WhatsApp, or manual admin entry.

## Express Generator structure

The application now follows the standard Express Generator bootstrap layout. There is no `src/` application directory.

```text
app.js                 Express configuration and exported app
bin/www                HTTP server entry point and MongoDB startup
routes/                 Feature routers
controllers/            HTTP request handlers
services/               Business rules and orchestration
models/                 Mongoose schemas and models
repositories/           Public UUID lookup helpers
middleware/             Authentication and error middleware
db/                     Mongoose connection
config/                 Branding and app configuration
utils/                  Shared utilities
views/                  EJS templates
public/                 Static CSS, JavaScript, and uploads
scripts/                Seed and validation scripts
test/                   Node test runner suites
```

`npm start` and `npm run dev` both start the generated-style `bin/www` entry point. `app.js` remains side-effect free apart from middleware configuration, which keeps it directly reusable in Supertest and other integrations.


## Per-employee appearance settings

Authenticated employees can open **Appearance settings** from the palette button in the top navigation or from the account menu. Changes preview immediately and are saved only in browser `localStorage`, using the signed-in employee email in the storage key.

Only four dashboard presets are included:

- **Black & white** — dark header/sidebar with white content surfaces.
- **White & black** — light header/sidebar with dark text; this is the default.
- **Facebook style, Facebook light, LinkedIn professional, Teal professional** — familiar Facebook blue with light-gray page surfaces.
- **Blue, black & white** — dark navigation with blue actions and white content.

Font selection and font-size controls have been removed so every employee sees consistent typography. Employees can still adjust layout density, page/header/sidebar colors, backgrounds, card and table surfaces, borders, radii, shadows, sidebar width, and table row styling. These preferences are not written to MongoDB and do not affect another employee's browser or account.

## Current workflow

1. A lead is created from the CRM or submitted through the API.
2. The team verifies the customer and requirement details.
3. The team categorizes the lead and records category-specific information.
4. The team approves, rejects, completes, or closes the lead.
5. Follow-ups and communication logs are managed on separate pages.

Provider assignment, lead distribution, provider unlock, and public provider listings are not part of the current CRM workflow. Providers are maintained only as an internal directory and onboarding record.

## Lead data model

Every lead uses the same fixed Mongoose schema for common information:

- UUID string `id`
- status and priority
- customer name, mobile, and email
- address
- category and requirement title
- preferred date and time
- lead source and tracking information
- notes and timeline

Category-specific information is stored in a flexible `additionalDetails` object:

```json
{
  "material": "Plywood",
  "budget": "5000",
  "work_area": "Bedroom"
}
```

Legacy API keys `fields`, `formData`, and `dynamicFields` are still accepted and normalized into `additionalDetails`.

## Create lead wizard

The manual lead screen is available at:

```text
/enquiries/new
```

It uses three focused steps:

1. **Customer details** — fixed customer, address, category, title, priority, and preferred time fields.
2. **Additional details** — known category schema fields are displayed as simple text fields. Admins can optionally add extra field-name/value rows.
3. **Lead source** — source type, website/source name, agent/source name, channel, campaign, form ID, external ID, landing page, and internal note.

The CRM reads existing category field definitions internally to display known fields, but the Website Modules and Form Definitions management pages are intentionally removed from the admin UI.

## Lead detail UI

The lead detail page uses nav pills instead of one long page:

- Overview
- Form data
- Verification
- Approval
- Activity
- Metadata

Approval is the final CRM decision. There is no provider assignment step.

## Main pages

```text
/dashboard
/enquiries
/enquiries/new
/enquiries/queue/new
/enquiries/queue/verification
/enquiries/queue/approved
/enquiries/queue/completed
/enquiries/queue/rejected
/enquiries/:id
/enquiries/:id/edit
/search/enquiries
/providers
/providers/new
/providers/:id
/providers/:id/edit
/search/providers
/follow-ups
/follow-ups/new
/communications
/communications/new
/billing
/reports
```

Each operational module uses separate list, create, detail, edit, and search pages where applicable.

## API

Create a lead:

```http
POST /api/requirements
Content-Type: application/json
```

Example:

```json
{
  "source": {
    "website": "example.com",
    "sourceType": "customer_website",
    "channel": "landing-page",
    "campaign": "carpenter-campaign",
    "formId": "carpenter-requirement",
    "externalEnquiryId": "WEB-1001"
  },
  "categorySlug": "carpenter",
  "serviceType": "Wardrobe repair",
  "customer": {
    "name": "Amit Verma",
    "mobile": "9876543210",
    "email": "amit@example.com"
  },
  "address": {
    "city": "Bengaluru",
    "state": "Karnataka",
    "pincode": "560038"
  },
  "additionalDetails": {
    "material": "Plywood",
    "issue": "Sliding shutter is stuck"
  }
}
```

Other lead aliases remain available for compatibility:

```http
POST /api/enquiries
POST /api/leads
GET /api/requirements
GET /api/requirements/:id
GET /api/enquiries
GET /api/leads
```

Read-only category schema endpoint:

```http
GET /api/forms/schema?sourceWebsite=example.com&categorySlug=carpenter&formType=default
```

Operational read APIs:

```http
GET /api/providers
GET /api/follow-ups
GET /api/follow-ups/:id
GET /api/communications
GET /api/communications/:id
GET /api/invoices
GET /api/invoices/:id
GET /api/health
```

There are no active provider-assignment, distribution, or unlock endpoints.

## Storage and architecture

- MongoDB through Mongoose.
- UUID-style string IDs are used for public and primary record IDs.
- Controllers and services fetch records by public `id`.
- Application services do not use Mongoose `populate`, aggregation pipelines, or ObjectId-based business lookups.
- Operational records denormalize the display data needed by their own pages.
- `additionalDetails` and `metadata` use flexible mixed objects for category/source-specific values.

Collections:

- `enquiries` — lead/requirement records; legacy collection name retained
- `providers`
- `categories`
- `formtemplates` — internal/read-only field definitions
- `followups`
- `communications`
- `invoices`
- `auditlogs`

## Local setup

```bash
cp .env.example .env
npm install
```

Start MongoDB locally. The default configuration uses:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/service_crm_admin
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/service_crm_admin_test
```

Seed demo data:

```bash
npm run seed
```

Start the app:

```bash
npm start
```

Open `http://localhost:3000`.

Default demo login:

```text
admin@example.com
change-me
```

## Checks and tests

```bash
npm run check
npm test
```

Run the MongoDB integration test only against a separate test database:

```bash
RUN_MONGO_INTEGRATION=true npm test
```

The integration test is skipped by default when that environment variable is not enabled.

## Production checklist

- Replace demo cookie authentication with SSO or database-backed admin users.
- Add roles for operations, verification, managers, finance, and support.
- Add API keys or signature validation to public lead intake endpoints.
- Add attachment storage for photos/documents.
- Add queue/retry handling for communication webhooks.
- Use managed MongoDB backups and audit-log retention.

## Default appearance

The default employee interface is the **White & black** theme: white header and cards, soft-gray page/sidebar surfaces, dark text, subtle borders, no gradients, and no card shadows. Employees can switch among the four approved themes, stored per employee in browser localStorage.
