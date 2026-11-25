# VAMSEE

**Intelligent Operations. Seamless Support.**

VAMSEE is a logistics operations and customer-support workspace for teams that need a clearer view of shipment enquiries, exceptions, service levels and follow-up work.

## Live product

- **Website:** https://black-smoke-f08f.vibhorjmd.workers.dev/
- **Operations workspace:** https://black-smoke-f08f.vibhorjmd.workers.dev/app.html
- **Enquiries:** vibhorjmd@gmail.com
- **Phone:** +91 72105 63739

## What is available today

- Private, named-user sign-in with expiring signed sessions.
- Organisation-scoped ticket and shipment records.
- Role-based workspace access and administrator-managed team accounts.
- Ticket queue, priority classification, SLA monitoring and escalation indicators.
- Shipment registry, manual tracking events, CSV import and CSV export.
- CSV imports accept `carrier_code`, `carrier` or `carrier_name`, and `current_status` or `status`. Human-readable values such as `In Transit` are normalized.
- AI-assisted enquiry classification and suggested customer replies through the Cloudflare Workers AI binding. Human review is required before any reply is sent.

## Shipment CSV format

Required column: `tracking_number`.

Optional columns: `carrier_code` (or `carrier` / `carrier_name`), `current_status` (or `status`), `last_tracking_at`, and `external_reference`.

Example:

```csv
tracking_number,carrier,status,last_tracking_at,external_reference
AWB123456,DELHIVERY,In Transit,2026-11-25T10:00:00Z,ORDER-1001
```

The workspace currently accepts up to 200 shipment rows per upload (1 MB file limit). Do not invent scan times: only provide `last_tracking_at` when the source export contains a genuine carrier scan timestamp.

## Architecture

- Cloudflare Workers for the API.
- Cloudflare Workers Static Assets for the website and application.
- Cloudflare D1 for persistent workspace data.
- Cloudflare Workers AI for assisted enquiry workflows.
- GitHub Actions for automated tests and deployment.

## Development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm test
npm run deploy
```

Deployment requires the Cloudflare GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Authentication uses Worker secrets; never put credentials or customer data in source control.

## Important scope and launch safeguards

- No courier API / Shiprocket credential integration is enabled. Shipment data enters through CSV import or manual updates.
- VAMSEE does not send customer emails, WhatsApp messages or carrier updates automatically.
- AI-generated text is a draft, not an approved customer communication.
- Configure customer-specific SLA targets before using SLA indicators as contractual commitments.
- Use synthetic/demo data until privacy notices, customer agreements, retention, incident handling, access review and operational support procedures have been approved.
- The current deployment has passed the repository's security regression tests and Cloudflare deployment smoke tests. These checks do not replace a full customer acceptance test or independent security review.

See [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) for the operational handover checklist.
