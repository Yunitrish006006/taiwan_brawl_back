import { env } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { expect, test } from 'vitest';

test('SignalRoom relays negotiation after runtime eviction with sockets hibernated', async () => {
  const id = env.SIGNAL_ROOM.idFromName('signal:41:42');
  const room = env.SIGNAL_ROOM.get(id);
  const sender = await connect(room, 41);
  const receiver = await connect(room, 42);

  try {
    await evictDurableObject(room);

    const incoming = nextMessage(receiver);
    sender.send(JSON.stringify({
      type: 'offer',
      targetUserId: 42,
      sdp: 'v=0\r\no=hibernation-test'
    }));

    expect(await incoming).toEqual({
      type: 'offer',
      targetUserId: 42,
      sdp: 'v=0\r\no=hibernation-test',
      fromUserId: 41
    });
  } finally {
    sender.close(1000, 'test complete');
    receiver.close(1000, 'test complete');
  }
});

async function connect(room, userId) {
  const response = await room.fetch('https://signal.test/internal/signal', {
    headers: {
      Upgrade: 'websocket',
      'x-user-id': String(userId)
    }
  });
  const socket = response.webSocket;
  if (!socket) throw new Error(`Expected WebSocket for user ${userId}`);
  socket.accept();
  return socket;
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for relayed signal')), 5000);
    socket.addEventListener('message', (event) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(event.data));
      } catch (error) {
        reject(error);
      }
    }, { once: true });
  });
}
