# Reference migration map

This app was generated as a clean replacement/reference implementation for the uploaded VetsKart admin website.

## Preserved workflows

1. **Enquiry/booking received**  
   Old portal handled VetsKart home service and consultation bookings. New portal receives generic enquiries from any source website through `/api/enquiries` or manual admin entry.

2. **Admin portal handles request**  
   Admin can filter, search, update status/priority, add notes, create follow-ups, log communications and create invoices.

3. **Assign to provider**  
   Old wording was vet/doctor. New app uses provider, with category-based matching and service-area scoring.

4. **Follow-up and completion**  
   Follow-up queue remains generic and can be used for customer callbacks, provider coordination and reminder tasks.

5. **Communication hooks**  
   Old portal had AWS Lambda/service calls. New app logs every communication locally and can forward it to `COMMUNICATION_WEBHOOK_URL`. Assignment/enquiry-created events can be forwarded to `EVENT_WEBHOOK_URL`.

6. **Dynamic forms**  
   Old portal had fixed veterinary form templates. New app supports category-specific templates using dynamic field definitions.

## Suggested next migration steps

- Connect `/api/enquiries` to each website form.
- Replace JSON store with the production database.
- Add data migration scripts for old Vet/VetBooking collections into Provider/Enquiry collections.
- Add real authentication/roles.
- Connect communication webhook to the existing AWS Lambda used by the old app.
