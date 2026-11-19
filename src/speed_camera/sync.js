import { parseCsvObjects } from './csv.js';
import { buildNpaSnapshot } from './camera_core.js';
import { CATALOG_KEY, MAX_BYTES, hashPoints, readPublication, validateCameraSnapshot } from './snapshots.js';

export const OFFICIAL_CSV_URL =
  'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/EA5E6FCD-B82D-43B7-A5CF-E9893253187E/resource/E7893FD4-EBB1-4949-B42A-F3978085D7D6/download';

const REQUIRED_COLUMNS = ['CityName', 'RegionName', 'Address', 'Latitude', 'Longitude', 'direct', 'limit'];

export function normalizeOfficialCsv(csv, generatedAt) {
  if (typeof csv !== 'string' || new TextEncoder().encode(csv).length > MAX_BYTES) {
    throw new Error('CSV size exceeds safe limit');
  }
  const rows = parseCsvObjects(csv);
  if (!rows.length || !REQUIRED_COLUMNS.every(column => Object.hasOwn(rows[0], column))) {
    throw new Error('Official CSV schema has changed');
  }
  const snapshot = buildNpaSnapshot(rows, { generatedAt });
  if (snapshot.recordCount < 500 ||
      (snapshot.rejectedCount + snapshot.duplicateCount) > rows.length * 0.1 ||
      !validateCameraSnapshot(snapshot)) {
    throw new Error('Official CSV data quality threshold not met');
  }
  return snapshot;
}

export async function createValidatedSnapshotFromCsv(csv, generatedAt = new Date().toISOString()) {
  const snapshot = normalizeOfficialCsv(csv, generatedAt);
  snapshot.contentSha256 = await hashPoints(snapshot.points);
  return snapshot;
}

export async function fetchOfficialCsv(fetcher = fetch) {
  const response = await fetcher(OFFICIAL_CSV_URL, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: { Accept: 'text/csv,application/octet-stream,*/*' },
  });
  if (!response.ok) throw new Error('Official CSV unavailable: HTTP ' + response.status);
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) {
    throw new Error('Official CSV missing or exceeds size limit');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let csv = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error('Official CSV exceeds size limit');
      csv += decoder.decode(value, { stream: true });
    }
    return csv + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

// A single scheduled writer publishes the current and last-good versions together.
export async function syncOfficialSpeedCameraData(env, fetcher = fetch) {
  const kv = env?.SPEED_CAMERA_DATA;
  if (typeof kv?.get !== 'function' || typeof kv?.put !== 'function') {
    throw new Error('SPEED_CAMERA_DATA KV namespace not configured');
  }
  const snapshot = await createValidatedSnapshotFromCsv(await fetchOfficialCsv(fetcher));
  const { snapshot: previous, current } = await readPublication(kv);
  if (previous && snapshot.recordCount < previous.recordCount * 0.8) {
    throw new Error('Official CSV record count dropped by more than 20%');
  }
  const oldHash = previous && (previous.contentSha256 ?? await hashPoints(previous.points));
  const unchanged = current && oldHash === snapshot.contentSha256;
  if (!unchanged) {
    const backup = previous && oldHash !== snapshot.contentSha256
      ? { ...previous, contentSha256: oldHash }
      : null;
    const payload = JSON.stringify({ format: 1, current: snapshot, previous: backup });
    if (new TextEncoder().encode(payload).length > MAX_BYTES) {
      throw new Error('Camera catalog exceeds safe KV size');
    }
    await kv.put(CATALOG_KEY, payload);
  }

  const { recordCount, rejectedCount, contentSha256, generatedAt } = unchanged ? previous : snapshot;
  return { recordCount, rejectedCount, contentSha256, generatedAt, updated: !unchanged };
}
