CREATE UNIQUE INDEX idx_lifecycle_account_epoch ON lifecycle_outbox(user_id,epoch);
CREATE TABLE lifecycle_write_guards (id TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));
