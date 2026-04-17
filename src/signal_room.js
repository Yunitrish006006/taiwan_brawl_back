// SignalRoom Durable Object — forwards WebRTC signaling messages between peers.
// No D1 persistence needed; signal state is transient.
// DO naming: signal:<low_id>:<high_id>

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
    if (!userId) {
      return json({ error: 'Missing user id' }, 400);
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    // Close existing socket for this user if any
    const existing = this.sockets.get(userId);
    if (existing) {
      try { existing.close(1000, 'replaced'); } catch (_) {}
    }
    this.sockets.set(userId, server);

    server.addEventListener('message', ({ data }) => {
      this._onMessage(userId, data);
    });

    server.addEventListener('close', () => {
      if (this.sockets.get(userId) === server) {
        this.sockets.delete(userId);
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  _onMessage(fromUserId, raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      return;
    }

    const { type, targetUserId } = payload;
    if (!targetUserId) return;

    const target = this.sockets.get(Number(targetUserId));
    if (!target) return; // peer not connected yet; client must retry

    // Relay: tag the original sender and forward as-is
    const relay = JSON.stringify({ ...payload, fromUserId });
    try {
      target.send(relay);
    } catch (_) {}
  }
}
