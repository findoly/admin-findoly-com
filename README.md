# Service CRM Admin

A simple Express, EJS and Alpine.js CRM that shares MongoDB with the provider portal.

## Required code flow

```text
/frontend or normal browser URL
  -> routes/frontend.js
  -> render an EJS page shell only
  -> Alpine.js fetches /api/*
  -> API controller
  -> small service
  -> simple Mongoose model
  -> MongoDB
```

Frontend routes do not query MongoDB and do not pass lead, provider, distribution, follow-up, communication, invoice, or dashboard records into EJS. EJS receives only page-title metadata. Alpine reads route IDs and query filters from `window.location`.

Each page is a complete EJS document. Only these structural partials are shared:

```text
head.ejs
navbar.ejs
sidebar.ejs
footer.ejs
scripts.ejs
```

There are no body/content partials, repository layer, model factory, `models/index.js`, `populate()` calls, or server-rendered database records.

All application modules use `module.exports`.

## Main folders

```text
routes/frontend.js       browser pages
routes/main.js           /api JSON router
controllers/             HTTP input/output only
services/                simple business operations
models/                  simple denormalized schemas
views/                   complete Alpine.js pages
scripts/migrate-structure.js
```

## IDs and collections

MongoDB keeps its own `_id`. The migration never changes existing `_id` or existing `id` fields.

Application queries use one named identifier per collection:

| Collection | Application identifier |
|---|---|
| `categories` | `categoryId` |
| `enquiries` | `enquiryId` |
| `providers` | `providerId` |
| `leaddistributions` | `leadDistributionId` |
| `wallettransactions` | `walletTransactionId` |
| `paymentorders` | `paymentOrderId` |
| `followups` | `followUpId` |
| `communications` | `communicationId` |
| `invoices` | `invoiceId` |
| `formtemplates` | `formTemplateId` |

New values are plain UUID v4 values with hyphens removed:

```text
6f6fb7f73593409898de8c18808ae3b1
```

They are exactly 32 hexadecimal characters with no collection prefix.

## Simple denormalized lead model

```json
{
  "enquiryId": "6f6fb7f73593409898de8c18808ae3b1",
  "name": "Customer name",
  "mobile": "9000000000",
  "email": "customer@example.com",
  "addressLine": "Flat 10, Main Road",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "category": "Painting",
  "categorySlug": "painting",
  "requirementTitle": "Paint 2 BHK",
  "status": "approved",
  "leadPricePaise": 15000,
  "additionalDetails": {}
}
```

The application services query only named ID fields. Legacy nested documents are flattened by the one-time migration instead of adding fallback queries to every service.

## Install and migrate

```bash
cp .env.example .env
npm install
npm run migrate:structure
npm start
```

`migrate:structure`:

- preserves existing `_id` and `id`
- adds 32-character named UUID fields
- remaps relation fields to the new named identifiers
- flattens legacy enquiry data
- normalizes provider mobile numbers
- rebuilds approved lead offers for eligible providers

The old command remains an alias:

```bash
npm run migrate:lead-distribution
```

## Frontend and API examples

```text
GET  /enquiries             renders an EJS shell only
GET  /api/enquiry           returns JSON list
GET  /api/enquiry/:id       returns JSON record
POST /api/enquiry           creates a record
PUT  /api/enquiry/:id       updates a record
```

Public website intake aliases remain JSON endpoints:

```text
POST /api/enquiries
POST /api/requirements
POST /api/leads
```

## Validation

```bash
npm run check
npm test
```

## CRM UI restoration

The CRM frontend keeps the Alpine.js + JSON API separation while restoring the polished admin interface:

- compact page headers and contextual actions
- visible sidebar icons and responsive navigation
- compact expandable requirement filters
- dashboard metric cards, recent requirements and quick actions
- provider directory with category, access and wallet summaries
- loading, empty and pagination states
- compatibility display IDs for legacy records that still use `id`

## Agent Portal integration

The CRM now includes minimal agent management at `/agents`:

- CRM administrators create individual or shop agents.
- Each agent receives one immutable 32-character `agentId` and one immutable 6-character uppercase alphanumeric `referralId`.
- Each agent is assigned exactly one active category and an OTP login mobile number.
- Agent-submitted requirements are written to the shared `enquiries` collection with a denormalized agent snapshot and customer-mobile OTP verification fields.
- CRM lists and details render through Alpine.js JSON API calls. No Mongoose `populate()` or MongoDB `$lookup` is used.
