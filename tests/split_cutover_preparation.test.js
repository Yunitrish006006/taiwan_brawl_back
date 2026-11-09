import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('cutover preparation preserves encrypted chat metadata, rows and deleted cursor high water', () => {
  const directory = mkdtempSync(join(tmpdir(), 'split-cutover-test-'));
  try {
    const migrations = readdirSync('migrations').filter(n => /^\d.*\.sql$/.test(n) && n < '0028').sort();
    const source = 'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);\n' +
      migrations.map(name => readFileSync(join('migrations', name), 'utf8') + `\nINSERT INTO d1_migrations(name) VALUES('${name}');`).join('\n') +
      `\nALTER TABLE chat_messages ADD COLUMN nonce TEXT;
      INSERT INTO users(id,name,email) VALUES(1,'Synthetic one','one@example.invalid'),(2,'Synthetic two','two@example.invalid');
      INSERT INTO sessions(id,user_id,expires_at) VALUES('synthetic-session',1,'2099-01-01');
      INSERT INTO friendships(user_one_id,user_two_id) VALUES(1,2);
      INSERT INTO chat_messages(id,sender_id,receiver_id,text,nonce) VALUES(7,1,2,CAST(X'4100ff' AS BLOB),'preserved-nonce');
      INSERT INTO pending_messages(id,sender_id,receiver_id,text) VALUES(999,1,2,'deleted');
      DELETE FROM pending_messages WHERE id=999;`;
    const input = join(directory, 'source.sql'), output = join(directory, 'plan');
    writeFileSync(input, source);
    const prepared = spawnSync('python3', ['scripts/prepare-split-cutover.py', '--source-sql', input, '--output-dir', output], { encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr);
    const summary = JSON.parse(readFileSync(join(output, 'summary.json')));
    assert.equal(summary.users, 2);
    assert.equal(summary.sessions, 1);
    assert.equal(summary.domains.social.find(t => t.table === 'pending_messages').sequence, 999);
    const query = spawnSync('sqlite3', ['-json', join(output, 'social.sqlite'), 'SELECT hex(text) payload,nonce FROM chat_messages'], { encoding: 'utf8' });
    assert.equal(query.status, 0, query.stderr);
    assert.deepEqual(JSON.parse(query.stdout), [{ payload: '4100FF', nonce: 'preserved-nonce' }]);
    const guardedDb = join(directory, 'guarded.sqlite');
    const freeze = spawnSync('sqlite3', ['-bail', guardedDb], { input: source + readFileSync(join(output, 'freeze-source.sql')), encoding: 'utf8' });
    assert.equal(freeze.status, 0, freeze.stderr);
    const paused = spawnSync('sqlite3', [guardedDb, "UPDATE users SET name='blocked' WHERE id=1"], { encoding: 'utf8' });
    assert.notEqual(paused.status, 0);
    assert.match(paused.stderr, /CUTOVER_WRITE_PAUSED/);
    const release = spawnSync('sqlite3', ['-bail', guardedDb], { input: readFileSync(join(output, 'release-retained.sql')), encoding: 'utf8' });
    assert.equal(release.status, 0, release.stderr);
    assert.equal(spawnSync('sqlite3', [guardedDb, "UPDATE users SET name='allowed' WHERE id=1"]).status, 0);
    const staleWriter = spawnSync('sqlite3', [guardedDb, 'DELETE FROM friendships'], { encoding: 'utf8' });
    assert.notEqual(staleWriter.status, 0);
    assert.match(staleWriter.stderr, /CUTOVER_WRITE_PAUSED/);
    const driftInput = join(directory, 'drift.sql'), driftOutput = join(directory, 'drift-plan');
    writeFileSync(driftInput, source + '\nALTER TABLE pending_messages ADD COLUMN unplanned_metadata TEXT;');
    const drift = spawnSync('python3', ['scripts/prepare-split-cutover.py', '--source-sql', driftInput, '--output-dir', driftOutput], { encoding: 'utf8' });
    assert.notEqual(drift.status, 0);
    assert.match(drift.stderr, /Column drift in pending_messages/);
    assert.equal(existsSync(join(driftOutput, 'social-data.sql')), false);
    const dumps = spawnSync('python3', ['-c', 'import sqlite3,pathlib,sys;p=pathlib.Path(sys.argv[1]);[(p/(n+"-export.sql")).write_text("\\n".join(sqlite3.connect(p/(n+".sqlite")).iterdump())) for n in ["social","games"]]', output], { encoding: 'utf8' });
    assert.equal(dumps.status, 0, dumps.stderr);
    const verifyArgs = ['scripts/verify-split-cutover.py', '--plan-dir', output, '--social-sql', join(output, 'social-export.sql'), '--games-sql', join(output, 'games-export.sql')];
    const verified = spawnSync('python3', verifyArgs, { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).verified, true);
    const socialDump = join(output, 'social-export.sql');
    writeFileSync(socialDump, readFileSync(socialDump, 'utf8').replace('preserved-nonce', 'changed-nonce'));
    const corrupted = spawnSync('python3', verifyArgs, { encoding: 'utf8' });
    assert.notEqual(corrupted.status, 0);
    assert.match(corrupted.stderr, /Row checksum mismatch in chat_messages/);
    const refuse = spawnSync('python3', ['scripts/prepare-split-cutover.py', '--source-sql', input, '--output-dir', output], { encoding: 'utf8' });
    assert.notEqual(refuse.status, 0, 'existing private preparation must not be overwritten');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
