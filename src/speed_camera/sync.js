import { parseCsvObjects } from './csv.js';
import { buildNpaSnapshot } from './camera_core.js';

export const OFFICIAL_CSV_URL =
  'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/EA5E6FCD-B82D-43B7-A5CF-E9893253187E/resource/E7893FD4-EBB1-4949-B42A-F3978085D7D6/download';

const KEY = 'npa7320:snapshot';
const MAX_BYTES = 15 * 1024 * 1024;
const REQUIRED_COLUMNS = ['CityName', 'RegionName', 'Address', 'Latitude', 'Longitude', 'direct', 'limit'];

async function hashPoints(points) {
  const bytes = new TextEncoder().encode(JSON.stringify(points));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function createValidatedSnapshotFromCsv(csv, generatedAt = new Date().toISOString()) {
  if (typeof csv !== 'string' || new TextEncoder().encode(csv).length > MAX_BYTES) {
    throw new Error('CSV size exceeds safe limit');
  }
  const rows = parseCsvObjects(csv);
  if (!rows.length || !REQUIRED_COLUMNS.every(column => Object.hasOwn(rows[0], column))) {
    throw new Error('Official CSV schema has changed');
  }
  const snapshot = buildNpaSnapshot(rows, { generatedAt });
  if (snapshot.recordCount < 500 ||
      snapshot.rejectedCount > rows.length * 0.1) {
    throw new Error('Official CSV rejected by data-quality guard');
  }
  snapshot.contentSha256 = await hashPoints(snapshot.points);
  return snapshot;
}

/// Cloudflare Worker Cron task. No HTTP request or user location is required.
/// It only writes after all validations have succeeded.
export async function syncOfficialSpeedCameraData(env, fetcher = fetch) {
  if (!env?.SPEED_CAMERA_DATA || typeof env.SPEED_CAMERA_DATA.put !== 'function') {
    throw new Error('SPEED_CAMERA_DATA KV namespace not configured');
  }
  const response = await fetcher(OFFICIAL_CSV_URL, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Official CSV unavailable: HTTP ' + response.status);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    throw new Error('Official CSV is too large');
  }
  const csv = await response.text();
  const snapshot = await createValidatedSnapshotFromCsv(csv);
  // One atomic KV put: a rejected refresh never clears a previously published snapshot.
  await env.SPEED_CAMERA_DATA.put(KEY, JSON.stringify(snapshot));
  return { recordCount: snapshot.recordCount, rejectedCount: snapshot.rejectedCount,
    contentSha256: snapshot.contentSha256, generatedAt: snapshot.generatedAt };
}
