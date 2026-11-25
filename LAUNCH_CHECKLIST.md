# VAMSEE — Launch and operations checklist

## Current deployment snapshot

- Production Worker: `black-smoke-f08f`
- Public URL: https://black-smoke-f08f.vibhorjmd.workers.dev/
- App URL: https://black-smoke-f08f.vibhorjmd.workers.dev/app.html
- Production deployment version (25 Nov 2026): `769a85e1-3abb-49e8-9c48-100d08eeceb2`
- Latest source commit: `090ed32b8fcb8678244cec62d12e938a850c44a7`
- Automated security regression workflow: passed.
- Cloudflare deployment workflow: passed.
- Smoke checks: `/`, `/app.html`, and `/api/auth/session` returned successful responses.
- Runtime bindings reported by Wrangler: D1 `DB`, Workers AI `AI`, and static assets `ASSETS`.

## Included workflows

1. Customer enquiry intake and ticket queue.
2. Priority classification and draft customer response.
3. SLA monitoring and escalation indicators.
4. Shipment registry and manual tracking event history.
5. CSV shipment import/export.
6. Individual account login and role-based access.
7. Organisation-scoped data access and administrator-managed users.

## CSV import rules

- Required: `tracking_number`.
- Optional carrier header: `carrier_code`, `carrier`, or `carrier_name`.
- Optional status header: `current_status` or `status`.
- Optional: `last_tracking_at`, `external_reference`.
- Maximum 200 rows and 1 MB per upload.
- Existing status is preserved when an update row leaves the optional status blank.
- Only real source scan timestamps should be imported. A shipment/order creation date is not a substitute for a carrier scan timestamp.

## Before onboarding a paying customer

- Confirm the owner account and recovery contact are controlled by the business.
- Review Worker secrets in Cloudflare. Keep the session signing secret private; remove the one-time bootstrap token if it is no longer needed.
- Verify the production D1 migration state and perform a restorable database backup.
- Create named accounts for the customer team; do not share one login.
- Confirm role permissions with a non-admin test account.
- Agree on each customer's SLA definitions and escalation ownership.
- Approve privacy notice, data-processing terms, retention/deletion policy and incident response process.
- Run a customer acceptance test using synthetic data before importing real shipment/customer records.
- Document support hours, escalation contact and change/release procedure.

## Explicitly not included in this release

- Live courier/aggregator integrations or tracking webhooks.
- Shiprocket credential-based access.
- Automatic email, WhatsApp or SMS delivery.
- Automatic CRM/helpdesk synchronization.
- Contractual SLA guarantees or autonomous customer communication.

These are separate product phases and must not be represented as live capabilities.

## Release verification

The deployment workflow performs:
- dependency installation,
- configured Cloudflare credential checks,
- Worker/static asset/D1/AI binding deployment,
- HTTP checks for the public root and application page,
- a JSON shape check for the authentication session endpoint.

The security regression workflow checks source-level controls. A successful workflow is not a substitute for browser-based acceptance testing, tenant-isolation testing with multiple real accounts, or an independent security assessment.
