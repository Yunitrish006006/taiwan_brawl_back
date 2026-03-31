import { withAuthenticatedUser } from './request_helpers.js';
import { jsonResponse } from './utils.js';

export function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => {
    const index = Math.floor(Math.random() * alphabet.length);
    return alphabet[index];
  }).join('');
}

export function getRoomStub(env, code) {
  return env.ROYALE_ROOM.get(env.ROYALE_ROOM.idFromName(code));
}

export async function proxyRoomJson(stub, path, payload, request) {
  const upstream = await stub.fetch(
    new Request(`https://royale-room${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  );

  const data = await upstream.json();
  return jsonResponse(data, upstream.status, request);
}

export async function proxyRoomAction(request, env, code, path, payloadBuilder) {
  return withAuthenticatedUser(request, env, async (user) => {
    const stub = getRoomStub(env, code);
    const payload = await payloadBuilder(user);
    return proxyRoomJson(stub, path, payload, request);
  });
}
