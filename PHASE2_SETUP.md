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
