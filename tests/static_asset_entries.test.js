import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import { staticAssetEntries } from '../tool/static_asset_entries.js';

test('known browser assets keep their existing KV keys without duplicates', () => {
  const files = ['index.html', 'main.dart.js', 'renderer.wasm', 'image.png', 'version.json']
    .map((key) => ({ key, value: 'AA==', base64: true }));
  assert.deepEqual(staticAssetEntries(files), files);
});

test('unrecognized Flutter asset paths retain originals and add handler aliases', () => {
  for (const key of ['assets/shaders/ink_sparkle.frag', 'assets/NOTICES', '.last_build_id', 'canvaskit/canvaskit.js.symbols']) {
    const original = { key, value: 'AP9/gA==', base64: true };
    assert.deepEqual(staticAssetEntries([original]), [original, { ...original, key: `${key}/index.html` }]);
  }
});

test('the real KV handler serves exact binary shader bytes through the alias', async () => {
  const bytes = Buffer.from([0, 255, 127, 128, 10]);
  const files = staticAssetEntries([{ key: 'assets/shaders/ink_sparkle.frag', value: bytes.toString('base64'), base64: true }]);
  const previousCaches = globalThis.caches;
  globalThis.caches = { default: {} };
  try {
    const response = await getAssetFromKV(
      { request: new Request('https://static.invalid/assets/shaders/ink_sparkle.frag') },
      { ASSET_NAMESPACE: { async get(key, type) {
        assert.equal(type, 'arrayBuffer');
        const entry = files.find((file) => file.key === key);
        return entry ? Uint8Array.from(Buffer.from(entry.value, 'base64')).buffer : null;
      } } },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});
