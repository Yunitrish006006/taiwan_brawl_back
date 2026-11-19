import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSpeedLimit, normalizeNpaRow, buildNpaSnapshot,
  distanceMeters, findAheadCandidates
} from '../src/speed_camera/camera_core.js';

const official = {
  CityName: '臺北市', RegionName: '大安區', Address: '測試路一段',
  DeptNm: '警察局', BranchNm: '分局',
  Longitude: '121.535000', Latitude: '25.025000',
  direct: '往東', limit: '60公里/小時'
};

test('normalizes published columns, keeps raw direction, and parses speed', () => {
  const row = normalizeNpaRow(official);
  assert.equal(row.speedLimitKmh, 60);
  assert.equal(row.directionRaw, '往東');
  assert.equal(row.longitude, 121.535);
  assert.equal(row.type, 'speed_enforcement_point');
  assert.equal(parseSpeedLimit('60/70'), null);
  assert.equal(parseSpeedLimit('速限 50'), 50);
});

test('rejects missing or invalid coordinates and deduplicates', () => {
  const snapshot = buildNpaSnapshot([
    official, { ...official }, { ...official, Latitude: '200' },
  ]);
  assert.equal(snapshot.recordCount, 1);
  assert.equal(snapshot.duplicateCount, 1);
  assert.equal(snapshot.rejectedCount, 1);
});

test('only returns location and heading candidates, not verified alerts', () => {
  const camera = normalizeNpaRow(official);
  const user = {
    latitude: 25.025, longitude: 121.532,
    accuracyMeters: 8, headingDegrees: 90
  };
  assert.equal(findAheadCandidates([camera], user).length, 1);
  assert.equal(findAheadCandidates([camera], { ...user, headingDegrees: 270 }).length, 0);
  assert.equal(findAheadCandidates([camera], { ...user, accuracyMeters: 250 }).length, 0);
  assert.equal(findAheadCandidates([camera], user)[0].matchStatus, 'candidate_only');
  assert.ok(distanceMeters(user, camera) > 200);
});
