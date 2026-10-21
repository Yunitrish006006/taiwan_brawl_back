-- Cursor-based offline relay reads filter by receiver, sender, and monotonic id.
-- Keep the legacy created_at index for history-compatible queries.
CREATE INDEX IF NOT EXISTS idx_pending_receiver_sender_id
  ON pending_messages (receiver_id, sender_id, id);
