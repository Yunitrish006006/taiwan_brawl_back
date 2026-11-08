import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatRoom } from '../src/rooms/chat_room.js';

test('history pages expose a stable compound cursor and hasMore', async () => {
  const db = new FakeHistoryDb(
    Array.from({ length: 51 }, (_, index) => ({
      id: 51 - index,
      sender_id: index % 2 === 0 ? 1 : 2,
      receiver_id: index % 2 === 0 ? 2 : 1,
      text: `message-${51 - index}`,
      created_at: '2026-10-28T00:00:00.000Z',
    })),
  );
  const room = new ChatRoom({}, { DB: db });

  const firstResponse = await room.fetch(
    new Request('https://chat-room/internal/history?userA=1&userB=2'),
  );
  const firstPage = await firstResponse.json();

  assert.equal(firstPage.messages.length, 50);
  assert.deepEqual(firstPage.messages.map((message) => message.text), [
    ...Array.from({ length: 50 }, (_, index) => `message-${index + 2}`),
  ]);
  assert.equal(firstPage.hasMore, true);
  assert.deepEqual(firstPage.nextCursor, {
    createdAt: '2026-10-28T00:00:00.000Z',
    id: 2,
  });
  assert.match(db.sql, /ORDER BY created_at DESC, id DESC/);

  db.rows = [
    {
      id: 1,
      sender_id: 1,
      receiver_id: 2,
      text: 'last older row',
      created_at: '2026-10-28T00:00:00.000Z',
    },
  ];
  const secondResponse = await room.fetch(
    new Request(
      `https://chat-room/internal/history?userA=1&userB=2&before=${encodeURIComponent(firstPage.nextCursor.createdAt)}&beforeId=${firstPage.nextCursor.id}`,
    ),
  );
  const secondPage = await secondResponse.json();

  assert.match(db.sql, /created_at = \?3 AND id < \?4/);
  assert.deepEqual(db.args, [1, 2, '2026-10-28T00:00:00.000Z', 2]);
  assert.deepEqual(secondPage.messages.map((message) => message.text), [
    'last older row',
  ]);
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.nextCursor, null);
});

class FakeHistoryDb {
  constructor(rows) {
    this.rows = rows;
    this.sql = '';
    this.args = [];
  }

  prepare(sql) {
    this.sql = sql;
    return {
      bind: (...args) => {
        this.args = args;
        return { all: async () => ({ results: this.rows }) };
      },
    };
  }
}
