-- Reject late writes after lifecycle delivery. Ending/invalidation updates remain allowed.
CREATE TRIGGER guard_mini_royale_user_decks_insert BEFORE INSERT ON mini_royale_user_decks
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_mini_royale_user_decks_update BEFORE UPDATE ON mini_royale_user_decks
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_mini_royale_user_deck_characters_insert BEFORE INSERT ON mini_royale_user_deck_characters
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_mini_royale_user_deck_characters_update BEFORE UPDATE ON mini_royale_user_deck_characters
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_mini_royale_user_deck_character_events_insert BEFORE INSERT ON mini_royale_user_deck_character_events
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_mini_royale_user_deck_character_events_update BEFORE UPDATE ON mini_royale_user_deck_character_events
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_mini_royale_match_history_insert BEFORE INSERT ON mini_royale_match_history
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.player_one_user_id,NEW.player_two_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
CREATE TRIGGER guard_mini_royale_match_history_update BEFORE UPDATE ON mini_royale_match_history
WHEN EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (NEW.player_one_user_id,NEW.player_two_user_id))
BEGIN SELECT RAISE(ABORT,'ACCOUNT_INACTIVE'); END;
