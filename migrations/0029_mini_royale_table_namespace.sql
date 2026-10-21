-- Keep the existing rows and keys while making Mini Royale's D1 storage
-- namespaced. Authentication tables (users, sessions) remain shared.
ALTER TABLE cards RENAME TO mini_royale_cards;
ALTER TABLE user_decks RENAME TO mini_royale_user_decks;
ALTER TABLE user_deck_cards RENAME TO mini_royale_user_deck_cards;
ALTER TABLE match_history RENAME TO mini_royale_match_history;
ALTER TABLE card_character_assets RENAME TO mini_royale_card_character_assets;
ALTER TABLE user_deck_characters RENAME TO mini_royale_user_deck_characters;
ALTER TABLE user_deck_character_events
  RENAME TO mini_royale_user_deck_character_events;

DROP INDEX IF EXISTS idx_card_character_assets_card_animation;
CREATE INDEX idx_mini_royale_card_character_assets_card_animation
  ON mini_royale_card_character_assets (
    card_id, animation, direction, frame_index
  );

DROP INDEX IF EXISTS idx_user_deck_characters_user;
CREATE INDEX idx_mini_royale_user_deck_characters_user
  ON mini_royale_user_deck_characters (user_id, updated_at);

DROP INDEX IF EXISTS idx_user_deck_character_events_deck;
CREATE INDEX idx_mini_royale_user_deck_character_events_deck
  ON mini_royale_user_deck_character_events (deck_id, created_at);
