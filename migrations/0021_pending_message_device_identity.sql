-- Optional device identity metadata for shared MessageEvent envelopes.
-- Account actor_id remains the authorization identity; device_id is only
-- forwarded metadata until peer key distribution is separately defined.
ALTER TABLE pending_messages ADD COLUMN device_id TEXT;
