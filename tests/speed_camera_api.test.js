import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNpaSnapshot } from '../src/speed_camera/camera_core.js';
import { handleSpeedCameraRequest, validateCameraSnapshot } from '../src/api/speed_camera_api.js';

const base = 'https://example.com';
const row = {
  CityName: '臺北市', RegionName: '大安區', Address: '測試路一號',
  Longitude: '121.535', Latitude: '25.025', direct: '往東', limit: '60'
};
const snapshot = buildNpaSnapshot([row], { generatedAt: '2026-11-19T12:00:00.000Z' });

test('snapshot/manifest are read-only and return the published version', async () => {
  const env = { SPEED_CAMERA_DATA: { get: async key => key === 'npa7320:snapshot' ? JSON.stringify(snapshot) : null } };
  const manifest = await handleSpeedCameraRequest(
    new Request(base + '/api/speed-cameras/manifest'), env, new URL(base + '/api/speed-cameras/manifest')
  );
  assert.equal(manifest.status, 200);
  const data = await manifest.json();
  assert.equal(data.recordCount, 1);
  assert.equal(data.version, snapshot.generatedAt);
  assert.equal('points' in data, false);

  const response = await handleSpeedCameraRequest(
    new Request(base + '/api/speed-cameras/snapshot'), env, new URL(base + '/api/speed-cameras/snapshot')
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).points, snapshot.points);
});

test('missing storage and invalid/corrupt datasets fail closed, not empty', async () => {
  const url = new URL(base + '/api/speed-cameras/snapshot');
  const request = new Request(url);
  assert.equal((await handleSpeedCameraRequest(request, {}, url)).status, 503);
  assert.equal((await handleSpeedCameraRequest(request, { SPEED_CAMERA_DATA: { get: async () => null } }, url)).status, 503);
  assert.equal((await handleSpeedCameraRequest(request, { SPEED_CAMERA_DATA: { get: async () => 'not json' } }, url)).status, 503);
  assert.equal(validateCameraSnapshot({ ...snapshot, recordCount: 2 }), false);
  assert.equal(validateCameraSnapshot(snapshot), true);
});

test('rejects unsupported method and unrelated route', async () => {
  const url = new URL(base + '/api/speed-cameras/manifest');
  assert.equal(await handleSpeedCameraRequest(new Request(url, { method: 'POST' }), {}, url), null);
  const other = new URL(base + '/api/other');
  assert.equal(await handleSpeedCameraRequest(new Request(other), {}, other), null);
});
