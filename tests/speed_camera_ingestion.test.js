import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildVerifiedSnapshot, writeSnapshotAtomically, fetchOfficialCsv, OFFICIAL_CSV_URL
} from '../scripts/fetch_speed_camera_dataset.mjs';

const heading = 'CityName,RegionName,Address,DeptNm,BranchNm,Longitude,Latitude,direct,limit\n';
function csv(count) {
  return heading + Array.from({ length: count }, (_, i) =>
    `臺北市,大安區,測試路${i},警察局,分局,121.${String(i).padStart(6, '0')},25.025,往東,60`
  ).join('\n') + '\n';
}

test('validates official schema, hashes and guards against partial snapshots', () => {
  const one = buildVerifiedSnapshot(csv(520), '2026-11-19T00:00:00Z');
  const two = buildVerifiedSnapshot(csv(520), '2026-11-20T00:00:00Z');
  assert.equal(one.recordCount, 520);
  assert.equal(one.contentSha256, two.contentSha256);
  assert.throws(() => buildVerifiedSnapshot(csv(10)), /threshold/);
  assert.throws(() => buildVerifiedSnapshot('a,b\n1,2\n'), /schema/);
});

test('rejects incomplete snapshot while retaining previous file', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'npa7320-'));
  const target = join(temp, 'snapshot.json');
  try {
    await writeFile(target, 'old validated version', 'utf8');
    assert.throws(() => buildVerifiedSnapshot(csv(4)), /threshold/);
    assert.equal(await readFile(target, 'utf8'), 'old validated version');
    await writeSnapshotAtomically(target, buildVerifiedSnapshot(csv(510)));
    assert.equal(JSON.parse(await readFile(target, 'utf8')).recordCount, 510);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('only fetches explicitly pinned government URL and requires success', async () => {
  let requestedUrl = null;
  const mock = async (url, options) => {
    requestedUrl = url;
    assert.equal(options.redirect, 'manual');
    return new Response('test', { status: 200, headers: { 'content-length': '4' } });
  };
  assert.equal(await fetchOfficialCsv(mock), 'test');
  assert.equal(requestedUrl, OFFICIAL_CSV_URL);
  await assert.rejects(() => fetchOfficialCsv(async () => new Response('', { status: 503 })), /HTTP 503/);
  await assert.rejects(
    () => fetchOfficialCsv(async () => Response.redirect('https://example.test', 302)),
    /HTTP 302/
  );
});
