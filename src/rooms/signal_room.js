// SignalRoom Durable Object — forwards WebRTC signaling messages between peers.
// No D1 persistence needed; signal state is transient.
// DO naming: signal:<low_id>:<high_id>

const LOG_CONTEXT = '[SignalRoom]';

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} ${LOG_CONTEXT}`;
  if (level === 'error') {
    console.error(`${prefix} ${message}`, data);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`, data);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export class SignalRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    /** @type {Map<number, WebSocket>} userId → socket */
    this.sockets = new Map();
    /** @type {number} Counter for forwarded messages */
    this._messageCount = 0;
    /** @type {number} Counter for failed forwards */
    this._failedCount = 0;
  }

  get connectionCount() {
    return this.sockets.size;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/internal/signal') {
      return this.handleWebSocket(request);
    }
    return json({ error: 'Not found' }, 404);
  }

  handleWebSocket(request) {
    const userId = Number(request.headers.get('x-user-id'));
    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      log('warn', 'Rejected WebSocket: invalid user id', {
        rawHeader: request.headers.get('x-user-id')
      });
      return json({ error: 'Missing or invalid user id' }, 400);
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    // Close existing socket for this user if any
    const existing = this.sockets.get(userId);
    if (existing) {
      try {
        existing.close(1000, 'replaced');
        log('info', 'Closed existing socket for user', { userId });
      } catch (err) {
        log('warn', 'Failed to close existing socket', {
          userId,
          error: err?.message
        });
      }
    }

    this.sockets.set(userId, server);
    log('info', 'Socket connected', {
      userId,
      connectionCount: this.connectionCount
    });

    server.addEventListener('message', (event) => {
      this._onMessage(userId, event.data);
    });

    server.addEventListener('close', (event) => {
      if (this.sockets.get(userId) === server) {
        this.sockets.delete(userId);
        log('info', 'Socket disconnected', {
          userId,
          code: event.code,
          reason: event.reason,
          connectionCount: this.connectionCount
        });
      }
    });

    server.addEventListener('error', (event) => {
      log('error', 'WebSocket error on server side', {
        userId,
        error: String(event?.message || 'unknown')
      });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  _onMessage(fromUserId, raw) {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch (err) {
      this._failedCount += 1;
      log('warn', 'Failed to parse incoming message', {
        fromUserId,
        raw: String(raw).slice(0, 100),
        error: err?.message,
        totalFailedCount: this._failedCount
      });
      return;
    }

    if (!payload || typeof payload !== 'object') {
      log('warn', 'Invalid payload type', {
        fromUserId,
        type: typeof payload
      });
      return;
    }

    const { type, targetUserId } = payload;
    if (!targetUserId) {
      log('warn', 'Message missing targetUserId', {
        fromUserId,
        type,
        hasType: Boolean(type)
      });
      return;
    }

    const targetUserIdNum = Number(targetUserId);
    if (!Number.isInteger(targetUserIdNum) || targetUserIdNum <= 0) {
      log('warn', 'Invalid targetUserId format', {
        fromUserId,
        targetUserId,
        targetUserIdType: typeof targetUserId
      });
      return;
    }

    const target = this.sockets.get(targetUserIdNum);
    if (!target) {
      log('info', 'Target peer not connected, skipping relay', {
        fromUserId,
        targetUserId: targetUserIdNum,
        connectedUsers: Array.from(this.sockets.keys())
      });
      return; // peer not connected yet; client must retry
    }

    // Relay: tag the original sender and forward as-is
    const relay = { ...payload, fromUserId };
    try {
      const relayString = JSON.stringify(relay);
      target.send(relayString);
      this._messageCount += 1;
      log('info', 'Message forwarded', {
        fromUserId,
        targetUserId: targetUserIdNum,
        type: type || 'unknown',
        totalForwarded: this._messageCount
      });
    } catch (err) {
      this._failedCount += 1;
      log('error', 'Failed to send relay message', {
        fromUserId,
        targetUserId: targetUserIdNum,
        error: err?.message,
        totalFailedCount: this._failedCount
      });
    }
  }
}
