import test from 'node:test';
import assert from 'node:assert/strict';

import {
  respondToRoomInvite,
  sendRoomInvite,
} from '../src/features/friends_repository.js';

function createDb({ invite } = {}) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (sql.includes('SELECT id FROM users')) return { id: this.args[0] };
          if (sql.includes('FROM friendships')) return { ok: 1 };
          if (sql.includes('FROM user_blocks')) return null;
          if (sql.includes('FROM room_invites')) return invite;
          return null;
        },
        async run() {
          statements.push({ sql, args: this.args });
          return { success: true };
        },
      };
    },
  };
}

test('room invitations persist and return their owning game ID', async () => {
  const DB = createDb();
  await sendRoomInvite(4, 9, 'ROOM42', { DB }, 'game.archery');
  const insert = DB.statements.find(({ sql }) => sql.includes('INSERT INTO room_invites'));
  assert.ok(insert);
  assert.match(insert.sql, /game_id/);
  assert.equal(insert.args[0], 'game.archery');
  assert.equal(insert.args[1], 'ROOM42');

  const result = await respondToRoomInvite(
    9,
    12,
    'accept',
    { DB: createDb({ invite: {
      id: 12,
      game_id: 'game.archery',
      room_code: 'ROOM42',
      invitee_user_id: 9,
      status: 'pending',
    } }) },
  );
  assert.equal(result.gameId, 'game.archery');
  assert.equal(result.roomCode, 'ROOM42');
});

test('room invitations reject malformed game IDs before database mutation', async () => {
  const DB = createDb();
  await assert.rejects(
    sendRoomInvite(4, 9, 'ROOM42', { DB }, '../rooms'),
    /valid gameId/,
  );
  assert.deepEqual(DB.statements, []);
});
