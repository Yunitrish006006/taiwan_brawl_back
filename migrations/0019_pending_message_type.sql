-- Add type column to pending_messages to support recall events.
-- type='message' (default) = normal chat message
-- type='recall'            = recall notification, text = messageKey (createdAt_senderId)
ALTER TABLE pending_messages ADD COLUMN type TEXT NOT NULL DEFAULT 'message';
