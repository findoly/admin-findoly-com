# Service CRM Admin

A simple Express + EJS + Alpine.js CRM that shares MongoDB with the provider portal.

## Code flow

```text
Browser page
  -> views/*.ejs (Alpine.js only)
  -> /api route
  -> controller
  -> small service
  -> Mongoose model
  -> MongoDB
```

The frontend route only renders the page shell, title, and URL record ID. It never sends MongoDB records into EJS.

## Main structure

```text
app.js
bin/www
db/connection.js
routes/frontend.js       # browser pages
routes/main.js           # /api router
routes/enquiry.js
routes/provider.js
controllers/frontendController.js
controllers/enquiryController.js
services/enquiry/enquiry-service.js
models/Enquiry.js
views/enquiry/*.ejs      # Alpine fetches /api/enquiry
```

There is no repository layer, no shared model factory, no `models/index.js`, and no Mongoose populate logic.

Every module exports with `module.exports`.

## IDs and collections

Existing MongoDB `_id` and `id` values are not changed. The migration copies the same value into the named ID field:

| Collection | Named ID |
|---|---|
| `enquiries` | `enquiryId` |
| `providers` | `providerId` |
| `leaddistributions` | `leadDistributionId` |
| `wallettransactions` | `walletTransactionId` |
| `paymentorders` | `paymentOrderId` |
| `followups` | `followUpId` |
| `communications` | `communicationId` |
| `invoices` | `invoiceId` |

New documents use UUID string IDs. Each Mongoose model explicitly names its MongoDB collection.

## Denormalized lead model

Frequently queried values are flat:

```json
{
  "enquiryId": "req_uuid",
  "name": "Customer name",
  "mobile": "9000000000",
  "city": "Mumbai",
  "category": "Painting",
  "categorySlug": "painting",
  "requirementTitle": "Paint 2 BHK",
  "status": "approved",
  "leadPricePaise": 15000
}
```

Legacy `customer`, `address`, `source`, and `fields` objects remain as mirrors so existing integrations keep working.

## Install and migrate

```bash
cp .env.example .env
npm install
npm run migrate:structure
npm start
```

`migrate:structure`:

- keeps existing `_id` and `id`
- adds named ID fields
- adds flat denormalized lead fields
- normalizes provider mobiles
- synchronizes approved leads to eligible providers

## Frontend and API examples

```text
GET  /enquiries             -> renders EJS only
GET  /api/enquiry           -> returns JSON list
GET  /api/enquiry/:id       -> returns JSON record
POST /api/enquiry           -> creates record
PUT  /api/enquiry/:id       -> updates record
```

Public website intake aliases remain:

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
