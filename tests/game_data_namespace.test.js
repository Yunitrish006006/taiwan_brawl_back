import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/0029_mini_royale_table_namespace.sql', import.meta.url),
  'utf8',
);
const initialMigration = await readFile(
  new URL('../migrations/0001_init.sql', import.meta.url),
  'utf8',
);
const dropPasswordMigration = await readFile(
  new URL('../migrations/0008_drop_password.sql', import.meta.url),
  'utf8',
);
const repository = await readFile(
  new URL('../src/royale/royale_repository.js', import.meta.url),
  'utf8',
);
const progression = await readFile(
  new URL('../src/royale/royale_progression.js', import.meta.url),
  'utf8',
);

const gameTables = [
  'cards',
  'user_decks',
  'user_deck_cards',
  'match_history',
  'card_character_assets',
  'user_deck_characters',
  'user_deck_character_events',
];

test('fresh migration replay creates then removes the legacy password column', () => {
  assert.match(initialMigration, /password TEXT NOT NULL/);
  assert.match(dropPasswordMigration, /ALTER TABLE users DROP COLUMN password/);
});

test('D1 migration namespaces Mini Royale tables without changing row identity', () => {
  for (const table of gameTables) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE ${table}\\s+RENAME TO mini_royale_${table}`),
    );
  }
  assert.doesNotMatch(migration, /ALTER TABLE (users|sessions)\b/);
  assert.match(migration, /DROP INDEX IF EXISTS idx_user_deck_characters_user/);
  assert.match(migration, /CREATE INDEX idx_mini_royale_user_deck_characters_user/);
});

test('Mini Royale repositories query only game-namespaced data tables', () => {
  assert.doesNotMatch(repository, /\b(?:FROM|INTO|UPDATE|DELETE FROM) cards\b/);
  assert.doesNotMatch(repository, /\b(?:FROM|INTO|UPDATE|DELETE FROM) user_decks\b/);
  assert.doesNotMatch(repository, /\b(?:FROM|INTO|UPDATE|DELETE FROM) user_deck_cards\b/);
  assert.doesNotMatch(repository, /\b(?:FROM|INTO) match_history\b/);
  assert.doesNotMatch(progression, /\b(?:FROM|INTO|UPDATE) user_deck_(?:characters|character_events|decks)\b/);
  for (const table of gameTables) {
    assert.ok(repository.includes(`mini_royale_${table}`) || progression.includes(`mini_royale_${table}`));
  }
});
