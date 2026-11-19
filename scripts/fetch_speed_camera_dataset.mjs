// Download verified official NPA dataset 7320 and build an atomic JSON snapshot.
// Usage: node scripts/fetch_speed_camera_dataset.mjs [output-file]
// No secret keys; no production publish. Download source may change over time.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchOfficialCsv, normalizeOfficialCsv } from '../src/speed_camera/sync.js';

export { OFFICIAL_CSV_URL, fetchOfficialCsv } from '../src/speed_camera/sync.js';

export function buildVerifiedSnapshot(csv, generatedAt = new Date().toISOString()) {
  const snapshot = normalizeOfficialCsv(csv, generatedAt);
  snapshot.contentSha256 = createHash('sha256').update(JSON.stringify(snapshot.points)).digest('hex');
  return snapshot;
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
