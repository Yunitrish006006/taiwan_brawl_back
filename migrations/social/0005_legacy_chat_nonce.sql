-- Preserve encrypted-chat metadata present in older production schemas.
ALTER TABLE chat_messages ADD COLUMN nonce TEXT;
