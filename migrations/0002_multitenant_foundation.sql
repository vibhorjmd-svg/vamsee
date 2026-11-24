-- VAMSEE multi-tenant foundation
-- Apply once to the existing D1 database after backing up the database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  organization_type TEXT NOT NULL CHECK (organization_type IN ('platform','seller','logistics','courier')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('platform_admin','org_admin','seller_admin','seller_operator','logistics_manager','logistics_agent','courier_manager','courier_operator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,
  carrier_code TEXT,
  aggregator_code TEXT,
  current_status TEXT NOT NULL DEFAULT 'unknown',
  last_tracking_at TEXT,
  last_event_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','aggregator_api','courier_api','webhook','demo')),
  external_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organization_id, tracking_number)
);

CREATE TABLE IF NOT EXISTS shipment_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_code TEXT,
  event_status TEXT NOT NULL,
  description TEXT,
  location TEXT,
  event_time TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  raw_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS api_integrations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_code TEXT NOT NULL,
  integration_type TEXT NOT NULL CHECK (integration_type IN ('aggregator','courier','seller_platform','webhook')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','connected','error','disabled')),
  credentials_ciphertext TEXT,
  credentials_nonce TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organization_id, provider_code, integration_type)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Preserve the existing private demo while preparing every ticket for tenant isolation.
ALTER TABLE tickets ADD COLUMN organization_id TEXT REFERENCES organizations(id);
INSERT OR IGNORE INTO organizations (id, name, slug, organization_type)
VALUES ('org_vamsee_demo', 'VAMSEE Demo Workspace', 'vamsee-demo', 'platform');
UPDATE tickets SET organization_id = 'org_vamsee_demo' WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(organization_id, role, status);
CREATE INDEX IF NOT EXISTS idx_shipments_org_updated ON shipments(organization_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_shipments_org_tracking ON shipments(organization_id, tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipment_events_org_time ON shipment_events(organization_id, event_time);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment_time ON shipment_events(shipment_id, event_time);
CREATE INDEX IF NOT EXISTS idx_integrations_org_status ON api_integrations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_logs(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_org_created ON tickets(organization_id, created_at);
