import { corsHeaders, jsonResponse } from '../core/utils.js';

const KEY = 'npa7320:snapshot';
const MAX_POINTS = 30000;

export function validateCameraSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 ||
      snapshot.source !== 'NPA-7320' ||
      !Array.isArray(snapshot.points) ||
      snapshot.recordCount !== snapshot.points.length ||
      snapshot.points.length < 1 || snapshot.points.length > MAX_POINTS) {
    return false;
  }
  return snapshot.points.every((point) =>
    typeof point.id === 'string' && point.id.startsWith('npa7320:') &&
    Number.isFinite(point.latitude) && point.latitude >= 18 && point.latitude <= 27 &&
    Number.isFinite(point.longitude) && point.longitude >= 115 && point.longitude <= 124 &&
    typeof point.address === 'string' && point.address.length > 0
  );
}

export async function handleSpeedCameraRequest(request, env, url) {
  const mode = url.pathname === '/api/speed-cameras/manifest' ? 'manifest' :
    url.pathname === '/api/speed-cameras/snapshot' ? 'snapshot' : null;
  if (request.method !== 'GET' || !mode) return null;

  if (!env.SPEED_CAMERA_DATA || typeof env.SPEED_CAMERA_DATA.get !== 'function') {
    return jsonResponse({ error: 'Speed-camera dataset is not configured' }, 503, request);
  }

  let raw;
  try {
    raw = await env.SPEED_CAMERA_DATA.get(KEY);
  } catch (_) {
    return jsonResponse({ error: 'Speed-camera dataset temporarily unavailable' }, 503, request);
  }
  if (!raw) return jsonResponse({ error: 'Speed-camera dataset not published yet' }, 503, request);

  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch (_) {
    return jsonResponse({ error: 'Speed-camera dataset invalid' }, 503, request);
  }
  if (!validateCameraSnapshot(snapshot)) {
    return jsonResponse({ error: 'Speed-camera dataset invalid' }, 503, request);
  }

  const metadata = {
    schemaVersion: snapshot.schemaVersion,
    source: snapshot.source,
    sourceUrl: snapshot.sourceUrl,
    generatedAt: snapshot.generatedAt,
    recordCount: snapshot.recordCount,
    // JSON string for clients to compare; changing content requires new generatedAt.
    version: snapshot.contentSha256 ?? snapshot.generatedAt,
  };

  return new Response(JSON.stringify(mode === 'manifest' ? metadata : snapshot), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
