# VAMSEE multi-tenant platform architecture

## Product shape

One VAMSEE website with role-based workspaces:
- Seller: orders, shipments, courier selection, NDR/RTO, returns, customer notifications.
- Logistics: multi-client operations, SLA monitoring, exceptions, assignment, reporting.
- Courier: shipment events, pickup/delivery exceptions, partner communication, delivery performance.
- Platform admin: organizations, users, integrations, health, plans and audit.

## Tenant isolation

Every customer organization receives an organization record. Users receive explicit memberships and roles. All tenant-owned records must carry organization_id. Every read, write, update, export and background job must scope by the authenticated membership's organization_id. Never trust an organization_id supplied by the browser as authorization.

Roles are deliberately distinct:
- platform_admin
- org_admin
- seller_admin / seller_operator
- logistics_manager / logistics_agent
- courier_manager / courier_operator
- viewer

The current shared-password demo remains a private prototype only. Do not onboard real customers until individual authentication, membership checks, tenant-scoped APIs, rate limiting, audit logging, secret encryption, backups and privacy controls are implemented and tested.

## Integration model

Use a provider adapter interface so aggregators, direct courier APIs, seller platforms and webhooks can be added without changing the core shipment model. Provider credentials must be encrypted at rest using an application encryption key held as a Cloudflare Worker secret. Never store provider API keys in source code, browser JavaScript, logs or plaintext config_json.

Suggested adapter contract:
- authenticate(connection)
- createShipment(input) (optional capability)
- fetchTracking(trackingNumber)
- normalizeTrackingEvent(providerPayload)
- verifyWebhook(request) (when supported)

Each adapter declares capabilities. Some providers may only support tracking; others may support label creation, pickup, cancellation, NDR or returns. Do not imply every provider supports every action.

## Shipment event model

Store normalized shipment records and append-only tracking events. Keep provider payloads only where permitted by provider terms and privacy policy. Derive last_tracking_at from the latest meaningful movement event, not from a support ticket's creation time. A shipment is considered stagnant only when a reliable carrier event timestamp is available and the configured threshold is crossed.

## Delivery sequence

1. Database foundation: organizations, users, memberships, shipments, events, integrations and audit logs.
2. Individual login, invitations, role checks and organization-scoped API middleware.
3. Role-based portal shell and tenant-safe ticket/shipment APIs.
4. Provider adapter framework and demo provider using synthetic data.
5. First approved aggregator connector, then more aggregators and direct courier connectors.
6. Seller/logistics/courier workflows, webhooks, scheduled polling and notifications.
7. Production readiness review, operational monitoring, data retention and customer onboarding.

## Current status

The SQL migration in `migrations/0002_multitenant_foundation.sql` creates the initial schema and attaches existing demo tickets to the VAMSEE Demo Workspace. It does not yet activate multi-user authentication or expose the new portals. Apply the migration to the D1 database before deploying application code that depends on these tables.
