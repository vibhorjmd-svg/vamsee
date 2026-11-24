CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('HIGH','MEDIUM','NORMAL')),
  assigned_queue TEXT NOT NULL,
  next_action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  customer_reply TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status_priority ON tickets(status, priority);