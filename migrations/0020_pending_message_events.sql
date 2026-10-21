-- Shared MessageEvent metadata for the additive server transport.
-- Existing rows remain readable through the legacy message/recall contract.
ALTER TABLE pending_messages ADD COLUMN event_id TEXT;
ALTER TABLE pending_messages ADD COLUMN message_id TEXT;
ALTER TABLE pending_messages ADD COLUMN revision INTEGER;
ALTER TABLE pending_messages ADD COLUMN event_type TEXT;
ALTER TABLE pending_messages ADD COLUMN signature TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_event_id
  ON pending_messages (event_id)
  WHERE event_id IS NOT NULL;
