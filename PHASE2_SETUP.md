# VAMSEE Logistics Automation — Phase 2 backend

This repository now includes a Cloudflare Worker API and D1 schema for persistent ticket storage.

## Files
- `worker.js`: GET/POST tickets, PATCH ticket status, health check.
- `migrations/0001_create_tickets.sql`: D1 table and indexes.
- `wrangler.toml`: deployment configuration template.

## Important deployment notes
1. Create a Cloudflare D1 database named `vamsee-tickets`.
2. Replace the placeholder `database_id` in `wrangler.toml` with the ID shown by Cloudflare.
3. Put the existing website file at `public/index.html`.
4. Apply the migration with Wrangler: `npx wrangler d1 migrations apply vamsee-tickets --remote`.
5. Deploy with Wrangler: `npx wrangler deploy`.

Do not put customer personal data into this demo until authentication and access controls are enabled. The API scaffold is not yet protected for production use. Add Cloudflare Access or an authenticated admin layer before handling real customer tickets.


## Individual accounts and role-based access (Phase 2)

The individual-account endpoints are included in the `phase2/individual-user-auth` branch. The existing shared-password demo login remains available during migration.

### Required Worker secrets
Set these in Cloudflare Worker **Settings → Variables and Secrets** (mark both as secrets):
- `VAMSEE_SESSION_SECRET`: a random secret of at least 32 characters.
- `VAMSEE_BOOTSTRAP_TOKEN`: a separate, high-entropy one-time setup token. Remove this secret after the first administrator account has been created.

Keep the existing `VAMSEE_ACCESS_PASSWORD` only while the legacy demo login is still needed. Never put any of these values in source code or send them in chat.

### First administrator setup

After confirming migration `0002_multitenant_foundation.sql` is applied remotely and deploying this branch, open the VAMSEE dashboard login page. Expand **First-time setup · Create the owner account**, then enter the one-time setup token, owner name, owner email, and a unique password of at least 12 characters. The form submits to the same-origin `/api/auth/bootstrap` endpoint; the first account is created as `platform_admin` and automatically signed in.

Immediately remove `VAMSEE_BOOTSTRAP_TOKEN` from Cloudflare Worker secrets after successful setup. Do not share the token or password in chat, email, or source control. Bootstrap is refused once any user exists.

### Login and provisioning
- Individual login: `POST /api/auth/login` with `email` and `password`.
- Session check: `GET /api/auth/session`.
- Logout: `POST /api/auth/logout`.
- List workspace users: authenticated administrator requests `GET /api/users` (limited to the current organisation).\n- Create a user: authenticated administrator sends `POST /api/users` with `email`, `full_name`, `temporary_password` (12+ characters), and `role`. Share the temporary password through a separate secure channel.
- Supported roles: `platform_admin` (bootstrap only), `org_admin`, `seller_admin`, `seller_operator`, `logistics_manager`, `logistics_agent`, `courier_manager`, `courier_operator`, `viewer`. Assignment is restricted by the creator's role: seller admins can create seller operators/viewers; logistics managers can create logistics agents/viewers; courier managers can create courier operators/viewers. Platform and organisation admins have broader but distinct assignment rights.

Passwords are stored as PBKDF2-HMAC-SHA-256 hashes with per-user random salts. Signed, HttpOnly, Secure, SameSite=Strict sessions expire after 8 hours. Membership and organization status are checked against D1 on each authenticated API request. Ticket queries and mutations use the authenticated membership's organization; the browser cannot choose a tenant. Viewer accounts are read-only for ticket operations.

**Deployment gate:** do not use this with real customer data until migration 0002 is confirmed applied remotely, secrets are configured, the Worker is deployed, and the authentication/tenant-isolation checks have passed. This branch is not the live deployment.


### Regression checks
Run `npm test` before merging. The built-in Node test suite checks JavaScript syntax, password hashing, session validation, one-time bootstrap, role assignment boundaries, tenant-scoped queries, and same-origin mutation protection. These are source-level regression checks; live D1 and browser integration tests are still required before production use.


Individual account sessions take precedence over the legacy shared-password session. If an individual session is present but invalid or revoked, the legacy session is not accepted as a fallback; users must sign out fully before switching authentication modes.

### Shipment registry and manual tracking events
- List shipments in the signed-in organisation: `GET /api/shipments`.
- Create a shipment: `POST /api/shipments` with `tracking_number`, optional `carrier_code`, and optional `current_status`.
- View a shipment's event history: `GET /api/shipments/:id/events`.
- Add a tracking event: `POST /api/shipments/:id/events` with `event_status`, `description`, and optional `location` / `event_time`.
- Shipment and event writes are tenant-scoped, role-checked, and recorded in the audit log. These are manual operations; live carrier/aggregator integrations are a separate phase.
