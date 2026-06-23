-- Dues & Contributions — D1 schema.
--
-- periods / payments / assessments are board-managed financial records: every
-- household member may read them, but only the configured Board group may write
-- (owner_or_visibility row policies in manifest.json, member_column = created_by
-- so a paying member can never write their own payment row). The board-group
-- pointer lives in `settings` under an app_config policy — writable only via the
-- admin-only /api/admin-config endpoint.
--
-- Allocations still POST to reserve-fund's KV `transactions` export via
-- cross-write; that channel is now gated by reserve-fund's manifest.export_acls,
-- so configure BOTH apps' board group to the same Board for postings to succeed.

CREATE TABLE IF NOT EXISTS app_dues_contributions__settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_dues_contributions__periods (
  id               TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  due_date         TEXT,
  amount_due       REAL NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'open',
  allocation_rules TEXT NOT NULL DEFAULT '[]',
  reconciliation   TEXT,
  closed_at        TEXT,
  closed_by        TEXT,
  visibility       TEXT NOT NULL DEFAULT 'everyone',
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_dues_contributions__payments (
  id          TEXT PRIMARY KEY,
  period_id   TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  date        TEXT,
  recorded_by TEXT,
  recorded_at TEXT,
  visibility  TEXT NOT NULL DEFAULT 'everyone',
  created_by  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_dues_contributions__assessments (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  due_date   TEXT,
  member_ids TEXT NOT NULL DEFAULT '["all"]',
  visibility TEXT NOT NULL DEFAULT 'everyone',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dues_payments_period ON app_dues_contributions__payments (period_id);
