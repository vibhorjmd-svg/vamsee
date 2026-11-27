-- VAMSEE SaaS tenant onboarding, plans and secure invitations
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'starter' CHECK (plan_code IN ('starter','growth','scale','enterprise')),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled','suspended')),
  billing_provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  trial_ends_at TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('org_admin','seller_admin','seller_operator','logistics_manager','logistics_agent','courier_manager','courier_operator','viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_invitations_org ON organization_invitations(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invitations_expiry ON organization_invitations(expires_at, accepted_at);

INSERT OR IGNORE INTO subscriptions(id, organization_id, plan_code, status, trial_ends_at)
SELECT 'sub_' || lower(hex(randomblob(16))), id, 'starter', 'trialing',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','+14 days')
FROM organizations;
