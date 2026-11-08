import assert from 'node:assert/strict';
import test from 'node:test';

import { SignalRoom } from '../src/rooms/signal_room.js';

test('SignalRoom accepts hibernatable sockets and relays after instance recreation', async (t) => {
  const originalPair = globalThis.WebSocketPair;
  const originalResponse = globalThis.Response;
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
    }
  };
  globalThis.Response = class {
    constructor(body, init) {
      this.body = body;
      this.status = init.status;
      this.webSocket = init.webSocket;
    }
  };
  t.after(() => {
    globalThis.WebSocketPair = originalPair;
    globalThis.Response = originalResponse;
  });

  const state = new FakeDurableObjectState();
  const firstInstance = new SignalRoom(state, {});
  const aliceResponse = await firstInstance.fetch(signalRequest(1));
  const bobResponse = await firstInstance.fetch(signalRequest(2));
  const aliceSocket = state.sockets[0];
  const bobSocket = state.sockets[1];

  assert.equal(aliceResponse.status, 101);
  assert.equal(bobResponse.status, 101);
  assert.deepEqual(aliceSocket.deserializeAttachment(), { userId: 1 });
  assert.deepEqual(bobSocket.deserializeAttachment(), { userId: 2 });

  // A hibernated instance is recreated with only the runtime-owned sockets.
  const resumedInstance = new SignalRoom(state, {});
  assert.equal(resumedInstance.connectionCount, 2);
  await resumedInstance.webSocketMessage(aliceSocket, JSON.stringify({
    type: 'offer',
    targetUserId: 2,
    sdp: 'offer-after-wake',
  }));

  assert.deepEqual(JSON.parse(bobSocket.sent[0]), {
    type: 'offer',
    targetUserId: 2,
    sdp: 'offer-after-wake',
    fromUserId: 1,
  });
});

test('a replacement connection closes the previous socket for the same user', async (t) => {
  const originalPair = globalThis.WebSocketPair;
  const originalResponse = globalThis.Response;
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
    }
  };
  globalThis.Response = class {
    constructor(body, init) {
      this.body = body;
      this.status = init.status;
      this.webSocket = init.webSocket;
    }
  };
  t.after(() => {
    globalThis.WebSocketPair = originalPair;
    globalThis.Response = originalResponse;
  });

  const state = new FakeDurableObjectState();
  const room = new SignalRoom(state, {});
  await room.fetch(signalRequest(7));
  const previousSocket = state.sockets[0];
  await room.fetch(signalRequest(7));

  assert.equal(previousSocket.readyState, 3);
  assert.equal(room.connectionCount, 1);
  assert.deepEqual(state.sockets[1].deserializeAttachment(), { userId: 7 });
});

test('webSocketClose replies to close frames for the current Worker compatibility date', () => {
  const socket = new FakeSocket();
  socket.serializeAttachment({ userId: 9 });
  const room = new SignalRoom(new FakeDurableObjectState(), {});

  room.webSocketClose(socket, 1000, 'client closed', true);

  assert.deepEqual(socket.closedWith, { code: 1000, reason: 'client closed' });
});

test('SignalRoom relays only bounded offer, answer, and ICE fields', async () => {
  const sender = new FakeSocket();
  sender.serializeAttachment({ userId: 1 });
  const receiver = new FakeSocket();
  receiver.serializeAttachment({ userId: 2 });
  const room = new SignalRoom(new FakeDurableObjectState([sender, receiver]), {});

  await room.webSocketMessage(sender, JSON.stringify({
    type: 'offer', targetUserId: 2, sdp: 'offer-sdp',
  }));
  await room.webSocketMessage(sender, JSON.stringify({
    type: 'answer', targetUserId: 2, sdp: 'answer-sdp',
  }));
  await room.webSocketMessage(sender, JSON.stringify({
    type: 'ice_candidate',
    targetUserId: 2,
    candidate: { candidate: 'candidate-1', sdpMid: '0', sdpMLineIndex: 0 },
  }));

  assert.deepEqual(receiver.sent.map(JSON.parse), [
    { type: 'offer', targetUserId: 2, sdp: 'offer-sdp', fromUserId: 1 },
    { type: 'answer', targetUserId: 2, sdp: 'answer-sdp', fromUserId: 1 },
    {
      type: 'ice_candidate', targetUserId: 2,
      candidate: { candidate: 'candidate-1', sdpMid: '0', sdpMLineIndex: 0 },
      fromUserId: 1,
    },
  ]);

  for (const invalid of [
    { type: 'message', targetUserId: 2, body: 'not signaling' },
    { type: 'offer', targetUserId: 2, sdp: 'offer-sdp', body: 'extra data' },
    { type: 'offer', targetUserId: 1, sdp: 'self-targeted' },
    { type: 'answer', targetUserId: 2, sdp: 'x'.repeat(64 * 1024 + 1) },
    { type: 'ice_candidate', targetUserId: 2, candidate: {
      candidate: 'candidate-2', secret: 'extra data',
    } },
  ]) {
    await room.webSocketMessage(sender, JSON.stringify(invalid));
  }
  await room.webSocketMessage(sender, 'x'.repeat(128 * 1024 + 1));

  assert.equal(receiver.sent.length, 3, 'rejected application payloads must not reach the peer');
});

function signalRequest(userId) {
  return new Request('https://signal-room/internal/signal', {
    headers: { 'x-user-id': String(userId) },
  });
}

class FakeDurableObjectState {
  constructor(sockets = []) {
    this.sockets = sockets;
  }

  acceptWebSocket(socket) {
    this.sockets.push(socket);
  }

  getWebSockets() {
    return this.sockets.filter((socket) => socket.readyState !== 3);
  }
}

class FakeSocket {
  readyState = 1;
  sent = [];
  attachment = null;

  serializeAttachment(attachment) {
    this.attachment = structuredClone(attachment);
  }

  deserializeAttachment() {
    return this.attachment === null ? null : structuredClone(this.attachment);
  }

  send(message) {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(message);
  }

  close(code, reason) {
    this.readyState = 3;
    this.closedWith = { code, reason };
  }
}
