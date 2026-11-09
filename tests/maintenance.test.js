import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';
import { ChatRoom } from '../src/rooms/chat_room.js';
import { SignalRoom } from '../src/rooms/signal_room.js';
import { RoyaleRoom } from '../src/royale/royale_room.js';

const paused = { MAINTENANCE_MODE: 'true', DB: { prepare() { throw Error('Unexpected database access'); } } };

test('maintenance blocks authenticated and unauthenticated APIs before any database access', async () => {
  for (const [method, path] of [['POST', '/api/google-login'], ['GET', '/api/couples/overview'], ['POST', '/api/friends/requests']]) {
    const response = await worker.fetch(new Request(`https://site.test${path}`, { method }), paused, {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal((await response.json()).code, 'MAINTENANCE');
  }
  const health = await worker.fetch(new Request('https://site.test/api/health'), paused, {});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  await worker.scheduled({}, paused, { waitUntil() { throw Error('Background writer must not run'); } });
});

test('maintenance rejects Durable Object requests and closes existing chat and signal sockets', async () => {
  const chat = new ChatRoom({}, paused);
  const signal = new SignalRoom({}, paused);
  for (const room of [chat, signal]) {
    assert.equal((await room.fetch(new Request('https://internal.test/internal/history'))).status, 503);
  }
  let closes = 0;
  const socket = { close(code) { assert.equal(code, 1012); closes++; } };
  await chat.handleSocketMessage(1, { type: 'send_message', receiverId: 2, text: 'must not write' }, socket);
  signal.webSocketMessage(socket, '{}');
  assert.equal(closes, 2);
});

test('maintenance pauses Royale ticks, queued writes and existing socket commands', async () => {
  const room = new RoyaleRoom({ storage: { async get() { return null; } } }, paused);
  await room.initialized;
  room.ensureTicking();
  assert.equal(room.tickHandle, null);
  assert.equal(await room.enqueueMutation(() => { throw Error('Must not mutate'); }), false);
  assert.equal((await room.fetch(new Request('https://internal.test/internal/create'))).status, 503);
  let closed = false;
  room.sockets.set('1', { close(code) { assert.equal(code, 1012); closed = true; } });
  await room.handleSocketMessage(1, { type: 'play_combo' });
  assert.equal(closed, true);
});
