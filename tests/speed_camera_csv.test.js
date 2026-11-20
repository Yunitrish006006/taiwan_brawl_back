import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvRecords, parseCsvObjects } from '../src/speed_camera/csv.js';

test('handles BOM, Chinese text, quoted comma, escaped quotes and line breaks', () => {
  const raw = '\uFEFFCityName,Address,limit\r\n臺北市,"道路,一段",60\r\n新北市,"道路""二""段\n旁",50\r\n';
  const rows = parseCsvObjects(raw);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { CityName: '臺北市', Address: '道路,一段', limit: '60' });
  assert.equal(rows[1].Address, '道路"二"段\n旁');
});

test('rejects malformed CSV and mismatched row width', () => {
  assert.throws(() => parseCsvRecords('a,b\n"unfinished,b'), /Unclosed/);
  assert.throws(() => parseCsvObjects('a,b\n1'), /fields/);
  assert.throws(() => parseCsvObjects('a,a\n1,2'), /header/);
});
