import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const socialTables = ['friend_requests', 'friendships', 'user_blocks', 'room_invites',
  'chat_messages', 'pending_messages', 'chat_devices', 'chat_pending_message_acks'];
export const gameTables = ['mini_royale_cards', 'mini_royale_user_decks',
  'mini_royale_user_deck_cards', 'mini_royale_match_history',
  'mini_royale_card_character_assets', 'mini_royale_user_deck_characters',
  'mini_royale_user_deck_character_events'];

export function sqlite(sql, json = false) {
  const result = spawnSync('sqlite3', ['-batch', '-bail', ...(json ? ['-json'] : []), ':memory:'],
    { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return json ? JSON.parse(result.stdout || '[]') : result.stdout;
}

// Freeze only the existing source schema; new lifecycle migrations are separate.
export function legacySql() {
  return readdirSync(`${root}/migrations`).filter(n => /^\d+.*\.sql$/.test(n) && n < '0031')
    .sort((a, b) => a.localeCompare(b)).map(n => readFileSync(`${root}/migrations/${n}`, 'utf8')).join('\n');
}

export function baseline(tables) {
  const rows = sqlite(`PRAGMA foreign_keys=ON;\n${legacySql()}\nSELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE sql IS NOT NULL AND type IN ('table','index') ORDER BY type DESC,name;`, true);
  const order = new Map(tables.map((t, i) => [t, i]));
  const selected = rows.filter(r => order.has(r.tbl_name)).sort((a, b) =>
    (a.type === 'table' ? 0 : 1) - (b.type === 'table' ? 0 : 1) || order.get(a.tbl_name) - order.get(b.tbl_name));
  if (selected.filter(r => r.type === 'table').length !== tables.length) throw new Error('Missing source table');
  return '-- Frozen from migrations 0001–0030. User IDs are cross-database logical references.\n' + selected.map(r => {
    // Existing schema uses one-line account FKs. Fail verification below if any survive.
    let sql = r.sql.replace(/^\s*FOREIGN KEY[^\n]*REFERENCES\s+["`]?users["`]?\s*\(id\)[^\n]*\n?/gmi, '')
      .replace(/\s+REFERENCES\s+users\(id\)\s+ON DELETE CASCADE/gi, '')
      .replace(/,\s*\)/g, '\n)');
    if (/REFERENCES\s+["`]?users/i.test(sql)) throw new Error(`Unremoved account FK: ${r.name}`);
    return `${sql};`;
  }).join('\n\n') + '\n';
}
