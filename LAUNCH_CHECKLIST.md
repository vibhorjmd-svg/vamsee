# VAMSEE — Launch and operations checklist

## Verified production snapshot

Verification performed: 25 November 2026, 06:20 UTC.

- Production Worker: `black-smoke-f08f`
- Public URL: https://black-smoke-f08f.vibhorjmd.workers.dev/
- Operations workspace: https://black-smoke-f08f.vibhorjmd.workers.dev/app.html
- Verified production Worker version: `dcd65e81-6780-449f-b3bd-3af79eea1e46`
- Deployed source commit: `9f154cc7bb2643f93cf103b57c3ebbc4f5154a8d`
- Deployment workflow: https://github.com/vibhorjmd-svg/vamsee/actions/runs/45559867420
- Security regression workflow: https://github.com/vibhorjmd-svg/vamsee/actions/runs/45559867443

## Verification results

- Cloudflare deployment job: passed.
- Dependency installation: passed; npm reported 0 vulnerabilities at the time of this run.
- Runtime bindings confirmed by Wrangler: D1 `DB`, Workers AI `AI`, and static assets `ASSETS`.
- Production HTTP smoke check: `/` passed.
- Production HTTP smoke check: `/app.html` passed.
- Production auth-session smoke check: `/api/auth/session` returned valid JSON with a boolean `authenticated` field.
- Security regression suite: 15 tests passed, 0 failed.
- Source-level checks cover password hashing, signed/expiring sessions, one-time bootstrap, least-privilege role assignment, tenant-scoped ticket and shipment access, same-origin mutation protection, retirement of legacy shared-password login, and CSV validation/normalisation.

These checks establish that the demo is deployed and its automated checks pass. They are not a browser-based customer acceptance test, a live D1 migration audit, or an independent security assessment.

## Product capabilities available in this release

1. Named-user sign-in with expiring signed sessions.
2. Organisation-scoped ticket and shipment records.
3. Role-based workspace access and administrator-managed team accounts.
4. Ticket queue, priority classification, SLA indicators and escalation workflow.
5. Shipment registry, manual tracking events, CSV import and CSV export.
6. AI-assisted enquiry classification and suggested customer replies. A human must review any draft before communicating it.

## CSV import rules

- Required: `tracking_number`.
- Optional carrier header: `carrier_code`, `carrier`, or `carrier_name`.
- Optional status header: `current_status` or `status`.
- Optional: `last_tracking_at`, `external_reference`.
- Maximum 200 rows and 1 MB per upload.
- Existing status is preserved when an update row leaves the optional status blank.
- Only genuine carrier scan timestamps may be imported. An order or shipment creation date is not a carrier scan timestamp.

## Launch status and remaining gates

**Public demo launch: ready. Real customer-data onboarding: not yet cleared.**

The following items still require an authorised owner/operator to verify in Cloudflare and through a browser-based acceptance test:

- Confirm the owner account exists, the owner controls its email/recovery channel, and access is tested.
- Review Worker secrets. Keep the session signing secret private. Remove the one-time bootstrap token after successful owner creation if it is no longer required.
- Confirm the remote D1 migration history, especially migration `0002_multitenant_foundation.sql`. The verified deployment workflow runs `wrangler deploy` and HTTP smoke checks; its logs do not show a remote D1 migrations-apply step.
- Take a D1 backup and verify that it can be restored.
- Confirm a documented owner password-recovery procedure. The current Worker routes and dashboard source do not expose a password-reset/recovery flow.
- Create named customer test accounts; do not share one login.
- Verify role permissions using a non-admin account, including that a viewer cannot mutate records and cannot use AI assistance.
- Verify Cloudflare-side login/bootstrap rate limiting and security rules; these are not established by the repository checks.
- Approve the privacy notice, customer data-processing terms, retention/deletion policy and incident-response process.
- Run end-to-end browser acceptance tests using synthetic data before importing any real customer or shipment records.
- Document support hours, escalation contact, backup ownership and release/change procedure.
- Agree each customer's SLA definitions and escalation ownership before presenting SLA indicators as service commitments.

## Explicit exclusions — do not promise these as live features

- Live courier/aggregator integrations or tracking webhooks.
- Shiprocket credential-based access.
- Automatic email, WhatsApp or SMS delivery.
- Automatic CRM/helpdesk synchronisation.
- Contractual SLA guarantees or autonomous customer communication.

These require separate implementation and acceptance testing.
