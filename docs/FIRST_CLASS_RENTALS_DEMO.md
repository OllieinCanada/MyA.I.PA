# First Class Rentals Niagara private demonstration

## Purpose

This private My AI PA demonstration shows a conservative virtual receptionist for:

- prospective-renter inquiries;
- application-process questions;
- existing-tenant maintenance messages;
- tenant complaints and requests to speak with Dave; and
- deterministic emergency redirection.

It is available locally at `/#/demo/first-class-rentals`.

The demonstration does not send messages, transfer calls, confirm availability, accept rental applications, or provide emergency dispatch.

## Published sources used

- `https://www.firstclassrentalsniagara.ca/`
- `https://www.firstclassrentalsniagara.ca/Listings.html`
- `https://www.firstclassrentalsniagara.ca/Application.html`
- the three linked room-detail pages

The listing pages contain conflicting prices and labels. Consequently, every listing in the demonstration is marked `requires_confirmation` for both availability and pricing.

## Privacy boundary

The published rental application requests sensitive identity, credit, employment, and reference information. The receptionist must not collect or repeat any of the following by voice, transcript, SMS, or ordinary email:

- Social Insurance Number;
- driver's-licence or passport number;
- banking or payment-card data;
- detailed credit-report information; or
- identity-document images.

The agent may explain the approved application process and direct a caller to a secure application controlled by the landlord.

## Complaint handling

The tenant-complaint flow records the tenant's own account without deciding fault. It collects the tenant name, property and unit, callback number, category, description, timing, requested resolution, and preferred callback window.

## Provisioning status

The private demo is implemented locally and its verified callable demonstration line is `+1 249-315-4508`.

The August 5, 2026 website signup for `firstclassrentals99@gmail.com` returned `+1 785-960-0840`, but read-back found neither that phone number nor a matching First Class Rentals assistant in Vapi. The Make.com signup scenario also shows an unresolved Vapi `401 Unauthorized` execution and is currently inactive. Treat `+1 785-960-0840` as a stale provisioning response, not as an assigned demo line.

On August 6, 2026, Oliver explicitly authorized reusing the inactive line ending `4508`. Vapi read-back confirmed that `+1 249-315-4508` was active, attached to exactly one isolated test assistant, had no calls in the inspected call window, and already had a protected per-line summary tool. The assistant was replaced with the First Class Rentals Niagara policy and verified for recording consent, rental availability and pricing boundaries, sensitive application-data refusal, tenant complaint intake, emergency redirection, AI identity disclosure, business knowledge, owner routing to Dave at `905-964-7422`, trusted caller-ID fallback, and natural post-tool closing. Eight safe Vapi chat scenarios passed after configuration.

The live operations dashboard now maps both the `4508` phone number and its assistant ID to First Class Rentals Niagara. The customer setup checklist records the Make step as an audited manual bypass, the isolated SMS step as verified, and the first real phone call as the only remaining runtime check.

The guarded configurator is available as:

```powershell
npm run configure:vapi-first-class-rentals
```

It is read-only by default and refuses to patch a missing or shared phone assignment. Apply mode requires its explicit confirmation phrase after the selected phone has been verified. The configurator preserves existing tool IDs, routes owner summaries to Dave at `905-964-7422`, blocks sensitive application data, and verifies complaint, emergency, caller-ID, notification, and natural-closing safeguards after the update.

The demonstration says a callback request is **prepared for Dave**. It must not say that Dave received a message until the production notification adapter confirms delivery.

Immediate danger stops ordinary intake. Fire, smoke, suspected gas leaks, carbon-monoxide alarms, violence, a break-in in progress, medical emergencies, or flooding near energized equipment receive deterministic emergency wording.

## Inputs required before activation

1. Written confirmation that Dave authorizes the live receptionist and use of his name.
2. The approved owner-notification phone number and/or email address.
3. Approved business hours and callback wording.
4. A verified list of active properties, availability, rent, inclusions, parking, pets, smoking, laundry, and occupancy terms.
5. A confirmed secure application URL and privacy contact.
6. A decision on whether existing tenants may use the line for maintenance and complaints.
7. Approved emergency and after-hours instructions.
8. Recording and SMS-consent settings.

Live Vapi, telephone forwarding, SMS, and email integrations should remain disabled until these inputs are supplied and tested with synthetic data.
