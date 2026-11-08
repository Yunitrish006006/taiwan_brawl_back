CREATE TABLE account_tombstones (
  user_id INTEGER PRIMARY KEY,
  epoch INTEGER NOT NULL CHECK(epoch > 0),
  status TEXT NOT NULL CHECK(status IN ('deleting','disabled')),
  updated_at TEXT NOT NULL
);
CREATE TABLE lifecycle_receipts (
  event_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  epoch INTEGER NOT NULL CHECK(epoch > 0),
  completed_at TEXT NOT NULL
);
