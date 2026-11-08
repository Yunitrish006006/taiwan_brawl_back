import { socialDatabase } from '../core/databases.js';
import { splitMode, socialPairAllowed } from '../core/databases.js';
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
    const receiverId=Number(request.headers.get('x-receiver-id'));
    if(splitMode(this.env) && !(await socialPairAllowed(this.env,userId,receiverId))) return new Response('Forbidden',{status:403});

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
        if(splitMode(this.env) && payload?.type==='send_message' && Number(payload.receiverId)!==receiverId) throw new Error('Wrong recipient');
        void this.handleSocketMessage(userId, payload, server).catch(()=>{
          server.send(JSON.stringify({type:'error',message:'Conversation unavailable'}));
          server.close(1008,'Conversation unavailable');
        });
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
    if(splitMode(this.env) && !(await socialPairAllowed(this.env,senderId,Number(payload.receiverId)))) throw new Error('Conversation unavailable');
    const text = String(payload?.text ?? '').trim();
    if (!text) {
      return;
    }

    const createdAt = new Date().toISOString();

    // Persist to D1
    await socialDatabase(this.env).prepare(
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
    if(splitMode(this.env) && !(await socialPairAllowed(this.env,userA,userB))) return json({error:'Conversation unavailable'},403);
    const before = url.searchParams.get('before');
    const beforeId = Number(url.searchParams.get('beforeId'));

    let query;
    let args;

    if (before) {
      if (Number.isSafeInteger(beforeId) && beforeId > 0) {
        query = `
          SELECT id, sender_id, receiver_id, text, created_at
          FROM chat_messages
          WHERE ((sender_id = ?1 AND receiver_id = ?2) OR (sender_id = ?2 AND receiver_id = ?1))
            AND (created_at < ?3 OR (created_at = ?3 AND id < ?4))
          ORDER BY created_at DESC, id DESC
          LIMIT ${HISTORY_LIMIT + 1}
        `;
        args = [userA, userB, before, beforeId];
      } else {
        // Keep timestamp-only cursors readable for older clients.
        query = `
          SELECT id, sender_id, receiver_id, text, created_at
          FROM chat_messages
          WHERE ((sender_id = ?1 AND receiver_id = ?2) OR (sender_id = ?2 AND receiver_id = ?1))
            AND created_at < ?3
          ORDER BY created_at DESC, id DESC
          LIMIT ${HISTORY_LIMIT + 1}
        `;
        args = [userA, userB, before];
      }
    } else {
      query = `
        SELECT id, sender_id, receiver_id, text, created_at
        FROM chat_messages
        WHERE (sender_id = ?1 AND receiver_id = ?2) OR (sender_id = ?2 AND receiver_id = ?1)
        ORDER BY created_at DESC, id DESC
        LIMIT ${HISTORY_LIMIT + 1}
      `;
      args = [userA, userB];
    }

    const result = await socialDatabase(this.env).prepare(query)
      .bind(...args)
      .all();

    const rows = result.results ?? [];
    const hasMore = rows.length > HISTORY_LIMIT;
    const selectedRows = rows.slice(0, HISTORY_LIMIT);
    selectedRows.reverse();
    const oldest = selectedRows[0];
    const messages = selectedRows.map((row) => ({
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      text: row.text,
      createdAt: row.created_at
    }));

    const nextCursor = hasMore && oldest
      ? { createdAt: oldest.created_at, id: oldest.id }
      : null;

    return json({ ok: true, messages, hasMore, nextCursor });
  }
}
