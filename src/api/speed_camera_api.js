import { corsHeaders, jsonResponse } from '../core/utils.js';

import { readPublication, snapshotVersion } from '../speed_camera/snapshots.js';

export { validateCameraSnapshot } from '../speed_camera/snapshots.js';

export async function handleSpeedCameraRequest(request, env, url) {
  const mode = url.pathname === '/api/speed-cameras/manifest' ? 'manifest' :
    url.pathname === '/api/speed-cameras/snapshot' ? 'snapshot' : null;
  if (request.method !== 'GET' || !mode) return null;

  if (!env.SPEED_CAMERA_DATA || typeof env.SPEED_CAMERA_DATA.get !== 'function') {
    return jsonResponse({ error: 'Speed-camera dataset is not configured' }, 503, request);
  }

  const version = mode === 'snapshot' ? url.searchParams.get('version') : null;
  if (version !== null && (!version || version.length > 64)) {
    return jsonResponse({ error: 'Invalid speed-camera version' }, 400, request);
  }

  let snapshot;
  try {
    ({ snapshot } = await readPublication(env.SPEED_CAMERA_DATA, version));
  } catch {
    return jsonResponse({ error: 'Speed-camera dataset temporarily unavailable' }, 503, request);
  }
  if (!snapshot) return jsonResponse({
    error: version === null ? 'Speed-camera dataset unavailable' : 'Requested speed-camera version unavailable',
  }, version === null ? 503 : 404, request);

  const metadata = {
    schemaVersion: snapshot.schemaVersion,
    source: snapshot.source,
    sourceUrl: snapshot.sourceUrl,
    generatedAt: snapshot.generatedAt,
    recordCount: snapshot.recordCount,
    version: snapshotVersion(snapshot),
  };

  return new Response(JSON.stringify(mode === 'manifest' ? metadata : snapshot), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
