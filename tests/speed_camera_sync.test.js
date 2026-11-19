import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createValidatedSnapshotFromCsv, syncOfficialSpeedCameraData, OFFICIAL_CSV_URL
} from '../src/speed_camera/sync.js';

const header = 'CityName,RegionName,Address,DeptNm,BranchNm,Longitude,Latitude,direct,limit\n';
const csv = header + Array.from({ length: 510 }, (_, i) =>
  `臺北市,大安區,某路${i},警察局,分局,121.${String(i).padStart(6, '0')},25.025,往東,60`
).join('\n');

test('Cron build yields deterministic normalized point hash', async () => {
  const one = await createValidatedSnapshotFromCsv(csv, '2026-11-19');
  const two = await createValidatedSnapshotFromCsv(csv, '2026-11-20');
  assert.equal(one.recordCount, 510);
  assert.equal(one.contentSha256, two.contentSha256);
  assert.equal(one.contentSha256.length, 64);
});

test('does not replace last-good KV value when official data is corrupt', async () => {
  const writes = [];
  const env = { SPEED_CAMERA_DATA: { put: async (key, payload) => writes.push([key, payload]) } };
  await assert.rejects(
    () => syncOfficialSpeedCameraData(env, async () => new Response('bad,bad\n1,2')),
    /schema|header/
  );
  assert.equal(writes.length, 0);
  await assert.rejects(() => syncOfficialSpeedCameraData({}, async () => {
    throw new Error('must not download');
  }), /not configured/);
});

test('publishes validated snapshot exactly once using official URL', async () => {
  const writes = [];
  let requestedUrl;
  const env = { SPEED_CAMERA_DATA: {
    put: async (key, payload) => writes.push([key, JSON.parse(payload)])
  }};
  const result = await syncOfficialSpeedCameraData(env, async url => {
    requestedUrl = url;
    return new Response(csv, { status: 200 });
  });
  assert.equal(requestedUrl, OFFICIAL_CSV_URL);
  assert.equal(result.recordCount, 510);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'npa7320:snapshot');
  assert.equal(writes[0][1].recordCount, 510);
});
