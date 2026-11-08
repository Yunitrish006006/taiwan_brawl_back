import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseline, gameTables, legacySql, root, socialTables, sqlite } from './split-database-schema.mjs';

const schemas = Object.fromEntries(['social','games'].map(domain => [domain,
  readFileSync(`${root}/migrations/${domain}/0001_baseline.sql`,'utf8')]));
assert.equal(schemas.social,baseline(socialTables),'Social snapshot drift');
assert.equal(schemas.games,baseline(gameTables),'Game snapshot drift');
const seed = `
INSERT INTO users(id,name,email) VALUES(1,'One','one@example.test'),(2,'Two','two@example.test');
INSERT INTO sessions(id,user_id,expires_at) VALUES('session',1,'2030-01-01');
INSERT INTO friend_requests(id,sender_user_id,receiver_user_id) VALUES(41,1,2);
INSERT INTO friendships VALUES(1,2,'2026-11-04');
INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES(2,1);
INSERT INTO room_invites(id,room_code,inviter_user_id,invitee_user_id) VALUES(51,'ROOM',1,2);
INSERT INTO chat_messages(id,sender_id,receiver_id,text) VALUES(71,1,2,'history');
INSERT INTO pending_messages(id,sender_id,receiver_id,text,event_id,device_id,revision)
 VALUES(81,1,2,'ciphertext','event-preserve','phone',3);
INSERT INTO chat_devices(user_id,device_id,created_at,last_seen_at) VALUES(2,'phone','2026-11-04','2026-11-04');
INSERT INTO chat_pending_message_acks VALUES(81,2,'phone','2026-11-04');
INSERT INTO mini_royale_user_decks(id,user_id,name,slot) VALUES(11,1,'Deck',1);
INSERT INTO mini_royale_user_deck_cards VALUES(11,0,'knight');
INSERT INTO mini_royale_match_history(id,room_code,player_one_user_id,player_two_user_id,reason,player_one_tower_hp,player_two_tower_hp)
 VALUES('match','ROOM',1,2,'finished',100,90);
INSERT INTO mini_royale_card_character_assets(card_id,asset_id) VALUES('knight','asset');
INSERT INTO mini_royale_user_deck_characters(deck_id,user_id) VALUES(11,1);
INSERT INTO mini_royale_user_deck_character_events(id,deck_id,user_id,result) VALUES('event',11,1,'win');
`;
function attachSchema(sql,domain) {
  return sql.replace(/CREATE TABLE\s+("?\w+"?)/g,`CREATE TABLE ${domain}.$1`)
    .replace(/CREATE (UNIQUE )?INDEX\s+(\w+)/g,(_,unique='',name)=>`CREATE ${unique}INDEX ${domain}.${name}`);
}
const copies = [['social',socialTables],['games',gameTables]];
let sql = `PRAGMA foreign_keys=ON;\n${legacySql()}\n${seed}\n`;
for(const [domain,tables] of copies) {
  sql += `ATTACH ':memory:' AS ${domain};\n${attachSchema(schemas[domain],domain)}\n`;
  for(const table of tables) sql += `INSERT INTO ${domain}.${table} SELECT * FROM main.${table};\n`;
  // Preserve AUTOINCREMENT high water marks, including IDs of deleted messages.
  sql += `UPDATE main.sqlite_sequence SET seq=999 WHERE name='pending_messages';\n`;
  sql += `UPDATE ${domain}.sqlite_sequence SET seq=(SELECT seq FROM main.sqlite_sequence s WHERE s.name=${domain}.sqlite_sequence.name);\n`;
}
sql += readFileSync(`${root}/migrations/0031_account_lifecycle.sql`,'utf8')+'\n';
const checks=[];
for(const [domain,tables] of copies) for(const table of tables) {
  checks.push(`SELECT '${domain}.${table}' AS item, (SELECT count(*) FROM ${domain}.${table}) AS rows,
    (SELECT count(*) FROM (SELECT * FROM main.${table} EXCEPT SELECT * FROM ${domain}.${table}))
    +(SELECT count(*) FROM (SELECT * FROM ${domain}.${table} EXCEPT SELECT * FROM main.${table})) AS mismatches`);
}
const results=sqlite(sql+checks.join(' UNION ALL ')+';',true);
assert.equal(results.length,15);
for(const r of results) { assert.ok(r.rows>0,r.item); assert.equal(r.mismatches,0,r.item); }
const integrity=sqlite(sql+`SELECT (SELECT count(*) FROM social.pragma_foreign_key_check) AS social_fk,
 (SELECT count(*) FROM games.pragma_foreign_key_check) AS game_fk,
 (SELECT seq FROM social.sqlite_sequence WHERE name='pending_messages') AS cursor_high_water,
 (SELECT count(*) FROM users WHERE lifecycle_status='active' AND lifecycle_epoch=1) AS users_preserved,
 (SELECT count(*) FROM sessions WHERE id='session') AS sessions_preserved;`,true)[0];
assert.deepEqual(integrity,{social_fk:0,game_fk:0,cursor_high_water:999,users_preserved:2,sessions_preserved:1});
console.log('Split rehearsal passed: 8 social + 7 game tables, all row contents preserved; cursor high water 999; 0 FK violations; 2 users + session retained. Source tables retained.');
