-- Add index on sessions.user_id for faster lookups
-- This improves login performance when many users are active

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
