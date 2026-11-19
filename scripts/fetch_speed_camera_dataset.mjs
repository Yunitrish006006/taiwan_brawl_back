// Download verified official NPA dataset 7320 and build an atomic JSON snapshot.
// Usage: node scripts/fetch_speed_camera_dataset.mjs [output-file]
// No secret keys; no production publish. Download source may change over time.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseCsvObjects } from '../src/speed_camera/csv.js';
import { buildNpaSnapshot } from '../src/speed_camera/camera_core.js';

export const OFFICIAL_CSV_URL =
  'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/EA5E6FCD-B82D-43B7-A5CF-E9893253187E/resource/E7893FD4-EBB1-4949-B42A-F3978085D7D6/download';

const EXPECTED_FIELDS = ['CityName', 'RegionName', 'Address', 'Longitude', 'Latitude', 'direct', 'limit'];
const MAX_CSV_BYTES = 15 * 1024 * 1024;
const MIN_POINTS = 500;

export function buildVerifiedSnapshot(csv, generatedAt = new Date().toISOString()) {
  const rows = parseCsvObjects(csv);
  if (rows.length === 0 || !EXPECTED_FIELDS.every(field => Object.hasOwn(rows[0], field))) {
    throw new Error('NPA CSV schema missing required columns');
  }
  const snapshot = buildNpaSnapshot(rows, { generatedAt });
  if (snapshot.recordCount < MIN_POINTS ||
      snapshot.rejectedCount > rows.length * 0.1) {
    throw new Error('NPA CSV data quality threshold not met; previous snapshot retained');
  }
  // Deterministic hash of normalized records, independent of refresh timestamp.
  snapshot.contentSha256 = createHash('sha256')
    .update(JSON.stringify(snapshot.points)).digest('hex');
  return snapshot;
}

export async function fetchOfficialCsv(fetcher = fetch) {
  const response = await fetcher(OFFICIAL_CSV_URL, {
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
    headers: { Accept: 'text/csv,application/octet-stream,*/*' },
  });
  if (!response.ok) throw new Error('Government CSV download failed: HTTP ' + response.status);
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > MAX_CSV_BYTES) {
    throw new Error('Government CSV exceeds size limit');
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_CSV_BYTES) throw new Error('Government CSV exceeds size limit');
  return new TextDecoder('utf-8', { fatal: true }).decode(buf);
}

export async function writeSnapshotAtomically(outputPath, snapshot) {
  const path = resolve(outputPath);
  const tmp = path + '.tmp';
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(tmp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + resolve(process.argv[1])).href) {
  const destination = process.argv[2] ?? 'dist/speed-camera/npa7320.json';
  try {
    const csv = await fetchOfficialCsv();
    const snapshot = buildVerifiedSnapshot(csv);
    await writeSnapshotAtomically(destination, snapshot);
    console.log(JSON.stringify({
      output: destination, count: snapshot.recordCount,
      rejected: snapshot.rejectedCount, sha256: snapshot.contentSha256,
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
