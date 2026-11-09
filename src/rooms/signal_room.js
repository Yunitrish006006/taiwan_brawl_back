import { splitMode, socialPairAllowed } from '../core/databases.js';
import { maintenanceEnabled, maintenanceResponse, closeForMaintenance } from '../core/maintenance.js';
// SignalRoom Durable Object — forwards WebRTC signaling messages between peers.
// No D1 persistence needed; signal state is transient.
// DO naming: signal:<low_id>:<high_id>

const LOG_CONTEXT = '[SignalRoom]';
const MAX_SIGNAL_BYTES = 128 * 1024;
const MAX_SDP_BYTES = 64 * 1024;
const MAX_CANDIDATE_BYTES = 8 * 1024;
const encoder = new TextEncoder();

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
    /** @type {number} Counter for forwarded messages */
    this._messageCount = 0;
    /** @type {number} Counter for failed forwards */
    this._failedCount = 0;
  }

  get connectionCount() {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === 1).length;
  }

  _userIdFor(socket) {
    try {
      const userId = Number(socket.deserializeAttachment()?.userId);
      return Number.isInteger(userId) && userId > 0 ? userId : null;
    } catch {
      return null;
    }
  }

  async fetch(request) {
    if (maintenanceEnabled(this.env)) return maintenanceResponse();
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
    server.serializeAttachment({ userId });

    // Socket attachments and getWebSockets survive Durable Object hibernation.
    // Rebuild the user's active connection set from the runtime on every request.
    for (const existing of this.ctx.getWebSockets()) {
      if (existing === server || this._userIdFor(existing) !== userId) continue;
      try {
        if (existing.readyState < 2) existing.close(1000, 'replaced');
        log('info', 'Closed existing socket for user', { userId });
      } catch (err) {
        log('warn', 'Failed to close existing socket', {
          userId,
          error: err?.message
        });
      }
    }

    log('info', 'Socket connected', {
      userId,
      connectionCount: this.connectionCount
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Cloudflare's hibernation WebSocket API dispatches messages through these
  // Durable Object handlers; standard addEventListener callbacks do not run.
  webSocketMessage(socket, message) {
    if (closeForMaintenance(this.env, socket)) return;
    const userId = this._userIdFor(socket);
    if (userId === null) {
      log('warn', 'Rejected signal from socket with invalid attachment');
      try { socket.close(1008, 'invalid connection state'); } catch {}
      return;
    }
    if(splitMode(this.env)) return this._authorizedMessage(userId,message,socket);
    this._onMessage(userId, message);
  }

  async _authorizedMessage(userId,message,socket) {
    try {
      const payload=JSON.parse(String(message));
      const signal=normalizeSignalPayload(payload,userId);
      if(!signal || !(await socialPairAllowed(this.env,userId,signal.targetUserId))) throw new Error('Unavailable');
      this._onMessage(userId,message);
    } catch { try {socket.close(1008,'Conversation unavailable');} catch {} }
  }

  webSocketClose(socket, code, reason, wasClean) {
    log('info', 'Socket disconnected', {
      userId: this._userIdFor(socket),
      code,
      reason,
      wasClean,
      connectionCount: this.connectionCount
    });
    // The Worker compatibility date predates automatic close-frame replies.
    try { socket.close(code, reason); } catch {}
  }

  webSocketError(socket, error) {
    log('error', 'WebSocket error on server side', {
      userId: this._userIdFor(socket),
      error: String(error?.message || 'unknown')
    });
  }

  _onMessage(fromUserId, raw) {
    const rawText = String(raw);
    if (rawText.length > MAX_SIGNAL_BYTES ||
        encoder.encode(rawText).byteLength > MAX_SIGNAL_BYTES) {
      this._rejectSignal(fromUserId, 'Signal payload exceeds size limit');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawText);
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

    const signal = normalizeSignalPayload(payload, fromUserId);
    if (!signal) {
      this._rejectSignal(fromUserId, 'Invalid negotiation signal payload');
      return;
    }

    const target = this.ctx.getWebSockets().find((socket) =>
      socket.readyState === 1 && this._userIdFor(socket) === signal.targetUserId
    );
    if (!target) {
      log('info', 'Target peer not connected, skipping relay', {
        fromUserId,
        targetUserId: signal.targetUserId,
        connectedUsers: this.ctx.getWebSockets()
          .filter((socket) => socket.readyState === 1)
          .map((socket) => this._userIdFor(socket))
          .filter((id) => id !== null)
      });
      return; // peer not connected yet; client must retry
    }

    // Relay only normalized SDP/ICE fields; never carry application messages.
    const relay = { ...signal, fromUserId };
    try {
      const relayString = JSON.stringify(relay);
      target.send(relayString);
      this._messageCount += 1;
      log('info', 'Message forwarded', {
        fromUserId,
        targetUserId: signal.targetUserId,
        type: signal.type,
        totalForwarded: this._messageCount
      });
    } catch (err) {
      this._failedCount += 1;
      log('error', 'Failed to send relay message', {
        fromUserId,
        targetUserId: signal.targetUserId,
        error: err?.message,
        totalFailedCount: this._failedCount
      });
    }
  }

  _rejectSignal(fromUserId, reason) {
    this._failedCount += 1;
    log('warn', reason, { fromUserId, totalFailedCount: this._failedCount });
  }
}

function normalizeSignalPayload(payload, fromUserId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const targetUserId = Number(payload.targetUserId);
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || targetUserId === fromUserId) return null;

  if (payload.type === 'offer' || payload.type === 'answer') {
    if (!hasOnlyKeys(payload, ['type', 'targetUserId', 'sdp'])) return null;
    if (typeof payload.sdp !== 'string' || payload.sdp.trim().length === 0 ||
        encoder.encode(payload.sdp).byteLength > MAX_SDP_BYTES) return null;
    return { type: payload.type, targetUserId, sdp: payload.sdp };
  }

  if (payload.type === 'ice_candidate') {
    if (!hasOnlyKeys(payload, ['type', 'targetUserId', 'candidate'])) return null;
    const candidate = payload.candidate;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
        !hasOnlyKeys(candidate, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'])) return null;
    if (typeof candidate.candidate !== 'string' ||
        encoder.encode(candidate.candidate).byteLength > MAX_CANDIDATE_BYTES) return null;
    if (candidate.sdpMid !== undefined && candidate.sdpMid !== null &&
        (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 256)) return null;
    if (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null &&
        (!Number.isSafeInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 ||
            candidate.sdpMLineIndex > 1024)) return null;
    if (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null &&
        (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256)) return null;
    return { type: payload.type, targetUserId, candidate };
  }

  return null;
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}
