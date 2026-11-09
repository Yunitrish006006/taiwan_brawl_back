import { mapRequestToAsset } from '@cloudflare/kv-asset-handler';

// The deployed KV handler treats unrecognized file extensions as directories.
// Preserve the normal key and supply the exact key that handler requests too.
export function staticAssetEntries(files) {
  const entries = new Map(files.map((file) => [file.key, file]));
  for (const file of files) {
    const request = new Request(new URL(file.key, 'https://static.invalid/'));
    const mapped = new URL(mapRequestToAsset(request).url).pathname.slice(1);
    if (!entries.has(mapped)) entries.set(mapped, { ...file, key: mapped });
  }
  return [...entries.values()];
}
