CREATE TABLE couple_relationships (
  id TEXT PRIMARY KEY,
  user_a_id INTEGER NOT NULL CHECK(user_a_id > 0),
  user_b_id INTEGER NOT NULL CHECK(user_b_id > user_a_id),
  started_on TEXT NOT NULL CHECK(length(started_on)=10),
  status TEXT NOT NULL CHECK(status IN ('active','ended')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT,
  CHECK((status='active' AND ended_at IS NULL) OR (status='ended' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX idx_couple_active_pair ON couple_relationships(user_a_id,user_b_id) WHERE status='active';
CREATE TABLE couple_active_members (
  user_id INTEGER PRIMARY KEY CHECK(user_id > 0),
  relationship_id TEXT NOT NULL REFERENCES couple_relationships(id)
);
CREATE INDEX idx_couple_members_relationship ON couple_active_members(relationship_id);
CREATE TABLE couple_requests (
  id TEXT PRIMARY KEY,
  user_a_id INTEGER NOT NULL,
  user_b_id INTEGER NOT NULL CHECK(user_b_id > user_a_id),
  requester_id INTEGER NOT NULL,
  recipient_id INTEGER NOT NULL,
  proposed_started_on TEXT NOT NULL CHECK(length(proposed_started_on)=10),
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled','expired','invalidated')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(expires_at > created_at),
  responded_at TEXT,
  relationship_id TEXT REFERENCES couple_relationships(id),
  CHECK((requester_id=user_a_id AND recipient_id=user_b_id) OR (requester_id=user_b_id AND recipient_id=user_a_id))
);
CREATE UNIQUE INDEX idx_couple_pending_pair ON couple_requests(user_a_id,user_b_id) WHERE status='pending';
CREATE INDEX idx_couple_incoming ON couple_requests(recipient_id,status,expires_at);
CREATE INDEX idx_couple_outgoing ON couple_requests(requester_id,status,expires_at);
CREATE TABLE couple_date_proposals (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES couple_relationships(id),
  requester_id INTEGER NOT NULL,
  proposed_started_on TEXT NOT NULL CHECK(length(proposed_started_on)=10),
  base_version INTEGER NOT NULL CHECK(base_version > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled','expired','invalidated')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(expires_at > created_at),
  responded_at TEXT
);
CREATE UNIQUE INDEX idx_couple_pending_date ON couple_date_proposals(relationship_id) WHERE status='pending';
CREATE TABLE couple_operations (
  actor_id INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY(actor_id,operation_id)
);
CREATE TABLE couple_write_guards (
  operation_id TEXT PRIMARY KEY,
  passed INTEGER NOT NULL CHECK(passed=1)
);
CREATE TABLE couple_audit (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES couple_relationships(id),
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
