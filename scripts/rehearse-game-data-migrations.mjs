import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(repositoryRoot, 'migrations');
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));
const namespaceMigration = '0029_mini_royale_table_namespace.sql';
if (!migrationFiles.includes(namespaceMigration)) {
  throw new Error(`Missing migration ${namespaceMigration}.`);
}

const setup = (
  await Promise.all(
    migrationFiles
      .filter((name) => name.localeCompare(namespaceMigration) < 0)
      .map((name) => readFile(join(migrationsDirectory, name), 'utf8')),
  )
).join('\n');
const namespaceChange = await readFile(
  join(migrationsDirectory, namespaceMigration),
  'utf8',
);
const seed = `
PRAGMA foreign_keys = ON;
INSERT INTO users (id, name, email) VALUES
  (1, 'One', 'one@example.test'),
  (2, 'Two', 'two@example.test');
INSERT INTO sessions (id, user_id, expires_at)
  VALUES ('session-seed', 1, '2030-01-01');
INSERT INTO user_decks (id, user_id, name, slot)
  VALUES (11, 1, 'Seed deck', 1);
INSERT INTO user_deck_cards (deck_id, position, card_id)
  VALUES (11, 0, 'knight');
INSERT INTO match_history (
  id, room_code, player_one_user_id, player_two_user_id, reason,
  player_one_tower_hp, player_two_tower_hp
) VALUES ('match-seed', 'ROOM', 1, 2, 'finished', 100, 90);
INSERT INTO card_character_assets (card_id, asset_id)
  VALUES ('knight', 'seed-asset');
INSERT INTO user_deck_characters (deck_id, user_id) VALUES (11, 1);
INSERT INTO user_deck_character_events (id, deck_id, user_id, result)
  VALUES ('event-seed', 11, 1, 'win');
`;
const verify = `
SELECT
  (SELECT count(*) FROM mini_royale_cards WHERE id = 'knight') || ':' ||
  (SELECT count(*) FROM mini_royale_user_decks WHERE id = 11 AND user_id = 1) || ':' ||
  (SELECT count(*) FROM mini_royale_user_deck_cards WHERE deck_id = 11 AND card_id = 'knight') || ':' ||
  (SELECT count(*) FROM mini_royale_match_history WHERE id = 'match-seed') || ':' ||
  (SELECT count(*) FROM mini_royale_card_character_assets WHERE card_id = 'knight' AND asset_id = 'seed-asset') || ':' ||
  (SELECT count(*) FROM mini_royale_user_deck_characters WHERE deck_id = 11 AND user_id = 1) || ':' ||
  (SELECT count(*) FROM mini_royale_user_deck_character_events WHERE id = 'event-seed') || ':' ||
  (SELECT count(*) FROM users WHERE id IN (1, 2)) || ':' ||
  (SELECT count(*) FROM sessions WHERE id = 'session-seed');
SELECT count(*) FROM pragma_table_info('users') WHERE name = 'password';
SELECT count(*) FROM pragma_foreign_key_check;
`;

const result = spawnSync('sqlite3', ['-batch', '-bail', ':memory:'], {
  input: `${setup}\n${seed}\n${namespaceChange}\n${verify}`,
  encoding: 'utf8',
});
if (result.error) {
  throw new Error(
    `Could not execute migration rehearsal; install the SQLite CLI. ${result.error.message}`,
  );
}
if (result.status !== 0) {
  throw new Error(result.stderr.trim() || 'SQLite migration rehearsal failed.');
}

const [preservedRows, remainingPasswordColumns, foreignKeyViolations] =
  result.stdout.trim().split(/\r?\n/);
if (
  preservedRows !== '1:1:1:1:1:1:1:2:1' ||
  remainingPasswordColumns !== '0' ||
  foreignKeyViolations !== '0'
) {
  throw new Error(
    `Unexpected migration result: ${result.stdout.trim().replaceAll('\n', ', ')}`,
  );
}

console.log(
  'Game data migrations passed: 7 namespaced game rows, 2 users, 1 session preserved; password removed; 0 foreign-key violations.',
);
