-- Dues & Contributions — D1 schema.
--
-- periods and payments are managed by the Hub finance protocol: every member
-- may read them, while all writes go through trusted endpoints that enforce
-- Board membership, open/closed lifecycle rules, server-derived audit fields,
-- integer-cent arithmetic, idempotent reserve posting, and safe retries.
-- Assessments are readable by everyone and writable only by the configured
-- Board group. The group pointer is admin-managed through /api/admin-config.
--
-- Allocations post to reserve-fund's protected D1 ledger through the generic
-- /api/finance protocol. Configure both apps to the same Board group.

CREATE TABLE IF NOT EXISTS app_dues_contributions__settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_dues_contributions__periods (
  id               TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  due_date         TEXT,
  amount_due_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_due_cents >= 0),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'locked')),
  allocation_rules TEXT NOT NULL DEFAULT '[]',
  reconciliation   TEXT,
  closing_token_id TEXT,
  closing_started_at TEXT,
  closed_at        TEXT,
  closed_by_id     TEXT,
  visibility       TEXT NOT NULL DEFAULT 'everyone' CHECK (visibility = 'everyone'),
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_dues_contributions__payments (
  id          TEXT PRIMARY KEY,
  period_id   TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date        TEXT NOT NULL,
  allocation_rules TEXT NOT NULL DEFAULT '[]',
  posting_status TEXT NOT NULL DEFAULT 'pending' CHECK (posting_status IN ('pending', 'posted', 'deleting')),
  deletion_token_id TEXT,
  recorded_by_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'everyone' CHECK (visibility = 'everyone'),
  created_by  TEXT NOT NULL,
  FOREIGN KEY (period_id) REFERENCES app_dues_contributions__periods(id)
);

CREATE TABLE IF NOT EXISTS app_dues_contributions__assessments (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents > 0),
  due_date   TEXT,
  member_ids TEXT NOT NULL DEFAULT '["all"]',
  visibility TEXT NOT NULL DEFAULT 'everyone' CHECK (visibility = 'everyone'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dues_payments_period ON app_dues_contributions__payments (period_id);
CREATE INDEX IF NOT EXISTS idx_dues_payments_pending ON app_dues_contributions__payments (posting_status, period_id);
