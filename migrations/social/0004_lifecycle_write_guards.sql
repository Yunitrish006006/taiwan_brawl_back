-- Reject late writes after lifecycle delivery. Ending/invalidation updates remain allowed.
CREATE TRIGGER guard_friend_requests_insert BEFORE INSERT ON friend_requests
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.sender_user_id,NEW.receiver_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_friend_requests_update BEFORE UPDATE ON friend_requests
WHEN NEW.status IN ('pending','accepted') AND EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.sender_user_id,NEW.receiver_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_friendships_insert BEFORE INSERT ON friendships
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_one_id,NEW.user_two_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_friendships_update BEFORE UPDATE ON friendships
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_one_id,NEW.user_two_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_user_blocks_insert BEFORE INSERT ON user_blocks
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.blocker_user_id,NEW.blocked_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_user_blocks_update BEFORE UPDATE ON user_blocks
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.blocker_user_id,NEW.blocked_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_room_invites_insert BEFORE INSERT ON room_invites
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.inviter_user_id,NEW.invitee_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_room_invites_update BEFORE UPDATE ON room_invites
WHEN NEW.status IN ('pending','accepted') AND EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.inviter_user_id,NEW.invitee_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_chat_messages_insert BEFORE INSERT ON chat_messages
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.sender_id,NEW.receiver_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_chat_messages_update BEFORE UPDATE ON chat_messages
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.sender_id,NEW.receiver_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_pending_messages_insert BEFORE INSERT ON pending_messages
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.sender_id,NEW.receiver_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_pending_messages_update BEFORE UPDATE ON pending_messages
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.sender_id,NEW.receiver_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_chat_devices_insert BEFORE INSERT ON chat_devices
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_chat_devices_update BEFORE UPDATE ON chat_devices
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_chat_pending_message_acks_insert BEFORE INSERT ON chat_pending_message_acks
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.receiver_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_chat_pending_message_acks_update BEFORE UPDATE ON chat_pending_message_acks
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.receiver_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_couple_active_members_insert BEFORE INSERT ON couple_active_members
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_couple_active_members_update BEFORE UPDATE ON couple_active_members
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_couple_relationships_insert BEFORE INSERT ON couple_relationships
WHEN NEW.status='active' AND EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_a_id,NEW.user_b_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_couple_relationships_update BEFORE UPDATE ON couple_relationships
WHEN NEW.status='active' AND EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_a_id,NEW.user_b_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_couple_requests_insert BEFORE INSERT ON couple_requests
WHEN NEW.status='pending' AND EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.requester_id,NEW.recipient_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_couple_requests_update BEFORE UPDATE ON couple_requests
WHEN NEW.status='pending' AND EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.requester_id,NEW.recipient_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_date_proposal_insert BEFORE INSERT ON couple_date_proposals
WHEN NEW.status='pending' AND EXISTS(SELECT 1 FROM couple_relationships r JOIN account_tombstones t ON t.user_id IN(r.user_a_id,r.user_b_id) WHERE r.id=NEW.relationship_id)
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_date_proposal_update BEFORE UPDATE ON couple_date_proposals
WHEN NEW.status='pending' AND EXISTS(SELECT 1 FROM couple_relationships r JOIN account_tombstones t ON t.user_id IN(r.user_a_id,r.user_b_id) WHERE r.id=NEW.relationship_id)
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
