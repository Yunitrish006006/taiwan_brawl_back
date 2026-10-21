import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conversationIdFor,
  eventFromPendingRow,
  normalizeChatEvent,
  pendingRowMatchesEvent,
  pendingTypeForEvent
} from '../src/api/chat_event_contract.js';

test('normalizes a valid shared event for the participant pair', () => {
  const result = normalizeChatEvent({
    eventId: 'e1',
    messageId: 'm1',
    conversationId: '2:9',
    type: 'created',
    revision: 0,
    createdAt: '2026-10-20T00:00:00.000Z',
    body: 'hello'
  }, { actorId: 9, friendId: 2 });

  assert.equal(result.error, undefined);
  assert.equal(result.event.actorId, '9');
  assert.equal(result.event.type, 'created');
});

test('normalizes read events without requiring a message body', () => {
  const result = normalizeChatEvent({
    eventId: 'read-e1',
    messageId: 'm1',
    conversationId: '2:9',
    type: 'read',
    revision: 1,
    createdAt: '2026-10-20T00:01:00.000Z',
    body: null,
  }, { actorId: 9, friendId: 2 });

  assert.equal(result.error, undefined);
  assert.equal(result.event.type, 'read');
  assert.equal(result.event.body, null);
  assert.equal(pendingTypeForEvent(result.event.type), 'read');
});

test('rejects invalid conversation and created revision', () => {
  assert.match(
    normalizeChatEvent({
      eventId: 'e1', messageId: 'm1', conversationId: '1:2',
      type: 'created', revision: 1,
      createdAt: '2026-10-20T00:00:00.000Z', body: 'hello'
    }, { actorId: 9, friendId: 2 }).error,
    /conversationId/
  );
});

test('maps pending rows back to the shared event envelope', () => {
  assert.equal(conversationIdFor(9, 2), '2:9');
  assert.equal(pendingTypeForEvent('recalled'), 'recall');
  assert.deepEqual(eventFromPendingRow({
    event_id: 'e1', message_id: 'm1', event_type: 'created',
    sender_id: 9, receiver_id: 2, revision: 0,
    created_at: '2026-10-20T00:00:00.000Z', body: 'hello', signature: null
  }), {
    eventId: 'e1', messageId: 'm1', conversationId: '2:9', actorId: '9',
    type: 'created', revision: 0,
    createdAt: '2026-10-20T00:00:00.000Z', body: 'hello', signature: null
  });
});

test('only treats an identical pending row as idempotent', () => {
  const event = {
    eventId: 'e1',
    messageId: 'm1',
    actorId: '9',
    type: 'created',
    revision: 0,
    createdAt: '2026-10-20T00:00:00.000Z',
    body: 'hello',
    signature: null
  };
  const row = {
    event_id: 'e1',
    message_id: 'm1',
    sender_id: 9,
    receiver_id: 2,
    text: 'hello',
    created_at: '2026-10-20T00:00:00.000Z',
    revision: 0,
    event_type: 'created',
    signature: null
  };

  assert.equal(
    pendingRowMatchesEvent(row, event, { actorId: 9, friendId: 2 }),
    true
  );
  assert.equal(
    pendingRowMatchesEvent(
      { ...row, text: 'tampered' },
      event,
      { actorId: 9, friendId: 2 }
    ),
    false
  );
});
