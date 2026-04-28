const HISTORY_LIMIT = 50;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ChatRoom Durable Object — manages the WebSocket connections and message
 * persistence for a single DM conversation between two users.
 *
 * DO name convention: `dm:<low_id>:<high_id>` (lower userId always first so
 * the two participants always resolve to the same DO).
 */
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<string, WebSocket>} userId -> socket */
    this.sockets = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    if (request.method === 'GET' && url.pathname === '/internal/history') {
      return this.handleHistory(request);
    }

    return json({ error: 'Not Found' }, 404);
  }

  // ── WebSocket ────────────────────────────────────────────────────────────

  async handleWebSocket(request) {
    const userId = Number(request.headers.get('x-user-id'));
    if (!userId) {
      return new Response('Forbidden', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const existing = this.sockets.get(String(userId));
    if (existing) {
      existing.close(1012, 'replaced');
    }

    this.sockets.set(String(userId), server);

    server.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        void this.handleSocketMessage(userId, payload, server);
      } catch (_) {
        server.send(JSON.stringify({ type: 'error', message: 'Invalid payload' }));
      }
    });

    server.addEventListener('close', () => {
      if (this.sockets.get(String(userId)) === server) {
        this.sockets.delete(String(userId));
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSocketMessage(userId, payload, socket) {
    switch (payload?.type) {
      case 'ping':
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      case 'send_message':
        await this.handleSendMessage(userId, payload);
        return;
      default:
        return;
    }
  }

  async handleSendMessage(senderId, payload) {
    const text = String(payload?.text ?? '').trim();
    if (!text) {
      return;
    }

    const createdAt = new Date().toISOString();

    // Persist to D1
    await this.env.DB.prepare(
      'INSERT INTO chat_messages (sender_id, receiver_id, text, created_at) VALUES (?1, ?2, ?3, ?4)'
    )
      .bind(senderId, payload.receiverId, text, createdAt)
      .run();

    // Broadcast to all connected participants
    const message = {
      type: 'new_message',
      message: {
        senderId,
        receiverId: Number(payload.receiverId),
        text,
        createdAt
      }
    };
    const encoded = JSON.stringify(message);
    for (const socket of this.sockets.values()) {
      socket.send(encoded);
    }
  }

  // ── History ──────────────────────────────────────────────────────────────

  async handleHistory(request) {
    const url = new URL(request.url);
    const userA = Number(url.searchParams.get('userA'));
    const userB = Number(url.searchParams.get('userB'));
    const before = url.searchParams.get('before');

    let query;
    let args;

    if (before) {
      query = `
        SELECT sender_id, receiver_id, text, created_at
        FROM chat_messages
        WHERE ((sender_id = ?1 AND receiver_id = ?2) OR (sender_id = ?2 AND receiver_id = ?1))
          AND created_at < ?3
        ORDER BY created_at DESC
        LIMIT ${HISTORY_LIMIT}
      `;
      args = [userA, userB, before];
    } else {
      query = `
        SELECT sender_id, receiver_id, text, created_at
        FROM chat_messages
        WHERE (sender_id = ?1 AND receiver_id = ?2) OR (sender_id = ?2 AND receiver_id = ?1)
        ORDER BY created_at DESC
        LIMIT ${HISTORY_LIMIT}
      `;
      args = [userA, userB];
    }

    const result = await this.env.DB.prepare(query)
      .bind(...args)
      .all();

    const messages = (result.results ?? []).reverse().map((row) => ({
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      text: row.text,
      createdAt: row.created_at
    }));

    return json({ ok: true, messages });
  }
}
