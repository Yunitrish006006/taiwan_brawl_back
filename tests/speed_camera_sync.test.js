import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {
  createValidatedSnapshotFromCsv, syncOfficialSpeedCameraData, OFFICIAL_CSV_URL
} from '../src/speed_camera/sync.js';

const header = 'CityName,RegionName,Address,DeptNm,BranchNm,Longitude,Latitude,direct,limit\n';
const csv = header + Array.from({ length: 510 }, (_, i) =>
  `臺北市,大安區,某路${i},警察局,分局,121.${String(i).padStart(6, '0')},25.025,往東,60`
).join('\n');

test('the integrated Worker refreshes only on the configured camera schedule', async t => {
  const writes = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(csv));
  const env = {
    SPEED_CAMERA_SYNC_CRON: '17 2 * * *',
    SPEED_CAMERA_DATA: {
      get: async () => null,
      put: async (key, payload) => writes.push([key, JSON.parse(payload)])
    }
  };
  const scheduled = async (cron, bindings = env) => {
    const tasks = [];
    await worker.scheduled({ cron }, bindings, { waitUntil: task => tasks.push(task) });
    await Promise.all(tasks);
  };

  await scheduled('* * * * *');
  await scheduled(env.SPEED_CAMERA_SYNC_CRON, { ...env, MAINTENANCE_MODE: 'true' });
  assert.equal(fetch.mock.callCount(), 0);
  await scheduled(env.SPEED_CAMERA_SYNC_CRON);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[0], OFFICIAL_CSV_URL);
  assert.equal(writes[0][1].current.recordCount, 510);
});

test('Cron build yields deterministic normalized point hash', async () => {
  const one = await createValidatedSnapshotFromCsv(csv, '2026-11-19');
  const two = await createValidatedSnapshotFromCsv(csv, '2026-11-20');
  assert.equal(one.recordCount, 510);
  assert.equal(one.contentSha256, two.contentSha256);
  assert.equal(one.contentSha256.length, 64);
});

test('does not replace last-good KV value when official data is corrupt', async () => {
  const writes = [];
  const env = { SPEED_CAMERA_DATA: { get: async () => null, put: async (key, payload) => writes.push([key, payload]) } };
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
    get: async () => null,
    put: async (key, payload) => writes.push([key, JSON.parse(payload)])
  }};
  const result = await syncOfficialSpeedCameraData(env, async url => {
    requestedUrl = url;
    return new Response(csv, { status: 200 });
  });
  assert.equal(requestedUrl, OFFICIAL_CSV_URL);
  assert.equal(result.recordCount, 510);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'npa7320:catalog:v1');
  assert.equal(writes[0][1].current.recordCount, 510);
});

test('retains the last valid version, skips unchanged data and recovers a corrupt current value', async () => {
  const { handleSpeedCameraRequest } = await import('../src/api/speed_camera_api.js');
  const { CATALOG_KEY } = await import('../src/speed_camera/snapshots.js');
  const entries = new Map();
  let writes = 0;
  let failWrite = false;
  const env = { SPEED_CAMERA_DATA: {
    get: async key => entries.get(key),
    put: async (key, value) => {
      if (failWrite) throw new Error('KV write failed');
      writes++;
      entries.set(key, value);
    },
  }};
  const refresh = content => syncOfficialSpeedCameraData(env, async () => new Response(content));
  const api = path => {
    const url = new URL('https://example.test/api/speed-cameras/' + path);
    return handleSpeedCameraRequest(new Request(url), env, url);
  };
  const first = await refresh(csv);
  assert.equal((await refresh(csv)).updated, false);
  assert.equal(writes, 1);
  const next = csv.replace('某路0,', '新路0,');
  failWrite = true;
  await assert.rejects(refresh(next), /KV write failed/);
  failWrite = false;
  assert.equal((await (await api('manifest')).json()).version, first.contentSha256);
  const second = await refresh(next);
  assert.notEqual(second.contentSha256, first.contentSha256);
  assert.equal((await (await api('manifest')).json()).version, second.contentSha256);
  assert.equal((await api('snapshot?version=' + first.contentSha256)).status, 200);
  const catalog = JSON.parse(entries.get(CATALOG_KEY));
  catalog.current.points[0].address = 'corrupt';
  entries.set(CATALOG_KEY, JSON.stringify(catalog));
  assert.equal((await api('snapshot?version=' + second.contentSha256)).status, 404);
  assert.equal((await (await api('manifest')).json()).version, first.contentSha256);
  assert.equal((await refresh(next)).updated, true);
  assert.equal((await (await api('manifest')).json()).version, second.contentSha256);
});

test('rejects oversize and invalid UTF-8 downloads before writing', async () => {
  const env = { SPEED_CAMERA_DATA: {
    get: async () => null,
    put: async () => assert.fail('invalid payload was written'),
  }};
  const chunks = [new Uint8Array(15 * 1024 * 1024), new Uint8Array(1)];
  const oversized = new ReadableStream({
    pull(controller) { controller.enqueue(chunks.shift()); },
  });
  await assert.rejects(syncOfficialSpeedCameraData(env, async () => new Response(oversized)), /size limit/);
  await assert.rejects(
    syncOfficialSpeedCameraData(env, async () => new Response(Uint8Array.of(255))),
    /UTF-8/i
  );
});
