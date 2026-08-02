# Findoly Linked Release Manifest

Release ID: `2026-08-02-emptydb-linked-fix-1`

This package is one half of the matched CRM and Provider Portal release for a clean, empty MongoDB deployment.

- Deploy CRM first, then Provider Portal.
- Both services must use the same explicitly named transaction-capable MongoDB database.
- Both services must use the same strong `COMMUNICATION_EVENT_API_TOKEN`.
- Run `npm ci` and `npm run ensure:indexes` in each project before first traffic.
- Do not run migrations or backfills for the initial empty database.
- Do not mix this package with an older linked counterpart because CRM acknowledgement sequencing is a cross-project contract.
