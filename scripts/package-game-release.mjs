import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validatePublishedGameResourceCatalog } from '../src/api/game_resources_api.js';
import { canonicalCatalogMessage } from './sign-game-catalog.mjs';
import { canonicalResourceMessage } from './sign-game-resource.mjs';

const CATALOG_KEY = 'game-resource-catalog:v1';

export function buildGameReleaseAssets({
  payload,
  resource,
  catalogEnvelope,
  resourcePublicKeyPem,
  catalogPublicKeyPem,
}) {
  validatePublishedGameResourceCatalog(catalogEnvelope);
  if (!Buffer.isBuffer(payload)) throw new TypeError('Resource payload must be bytes.');
  if (createHash('sha256').update(payload).digest('hex') !== resource.sha256) {
    throw new Error('Resource payload digest does not match signed metadata.');
  }
  if (payload.byteLength !== resource.byteLength) {
    throw new Error('Resource payload length does not match signed metadata.');
  }

  const resourcePublicKey = createPublicKey(resourcePublicKeyPem);
  if (
    resourcePublicKey.asymmetricKeyType !== 'ed25519' ||
    typeof resource.signature !== 'string' ||
    !/^[A-Za-z0-9_-]{86}$/.test(resource.signature) ||
    !verify(
      null,
      canonicalResourceMessage({
        moduleId: resource.moduleId,
        resourceId: resource.resourceId,
        version: resource.version,
        sha256: resource.sha256,
        payload,
      }),
      resourcePublicKey,
      Buffer.from(resource.signature, 'base64url'),
    )
  ) {
    throw new Error('Resource payload signature does not verify against the supplied public key.');
  }

  const catalogPublicKey = createPublicKey(catalogPublicKeyPem);
  if (
    catalogPublicKey.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      canonicalCatalogMessage({
        publisher: catalogEnvelope.publisher,
        signingKeyId: catalogEnvelope.signingKeyId,
        issuedAt: catalogEnvelope.issuedAt,
        expiresAt: catalogEnvelope.expiresAt,
        payload: catalogEnvelope.payload,
      }),
      catalogPublicKey,
      Buffer.from(catalogEnvelope.signature, 'base64url'),
    )
  ) {
    throw new Error('Catalog signature does not verify against the supplied public key.');
  }

  const moduleId = resource.moduleId;
  const moduleKey = moduleId.replace(/^game\./, '');
  const suffix = `${moduleKey}:${resource.resourceId}:${resource.version}`;
  const expectedContentKey = `game-resource:${suffix}`;
  const expectedMetadataKey = `game-resource-meta:${suffix}`;
  const expectedDownloadUrl = `${new URL(resource.downloadUrl).origin}/game-resources/${moduleKey}/${resource.resourceId}/${resource.version}`;
  if (
    resource.contentKey !== expectedContentKey ||
    !Number.isSafeInteger(resource.payloadSchemaVersion) ||
    resource.payloadSchemaVersion < 1 ||
    resource.metadataKey !== expectedMetadataKey ||
    resource.downloadUrl !== expectedDownloadUrl ||
    resource.storageMetadata?.byteLength !== resource.byteLength ||
    resource.storageMetadata?.sha256 !== resource.sha256 ||
    resource.storageMetadata?.contentType !== resource.contentType
  ) {
    throw new Error('Signed resource metadata has inconsistent API/KV locations.');
  }

  const module = catalogEnvelope.payload.modules.find((item) => item.moduleId === moduleId);
  const manifest = module?.resources.find((item) => item.resourceId === resource.resourceId);
  if (!manifest ||
      manifest.version !== resource.version ||
      manifest.sha256.toLowerCase() !== resource.sha256 ||
      manifest.byteLength !== resource.byteLength ||
      manifest.downloadUrl !== resource.downloadUrl ||
      manifest.signature !== resource.signature ||
      manifest.signingKeyId !== resource.signingKeyId ||
      manifest.payloadSchemaVersion !== resource.payloadSchemaVersion) {
    throw new Error('Signed catalog does not reference this exact resource payload.');
  }

  return [
    {
      key: resource.contentKey,
      value: payload.toString('base64'),
      base64: true,
    },
    {
      key: resource.metadataKey,
      value: JSON.stringify(resource.storageMetadata),
    },
    {
      key: CATALOG_KEY,
      value: JSON.stringify(catalogEnvelope),
    },
  ];
}

/**
 * Builds one atomic Wrangler bulk-put file for multiple immutable resources
 * and the single signed catalog that advertises their exact versions.
 */
export function buildGameReleaseAssetsBatch({
  resources,
  catalogEnvelope,
  resourcePublicKeyPem,
  catalogPublicKeyPem,
}) {
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new TypeError('At least one signed resource is required.');
  }
  const entries = [];
  const keys = new Set();
  for (const item of resources) {
    if (!item || !Buffer.isBuffer(item.payload) || !item.resource) {
      throw new TypeError('Each release resource needs payload bytes and metadata.');
    }
    const resourceEntries = buildGameReleaseAssets({
      payload: item.payload,
      resource: item.resource,
      catalogEnvelope,
      resourcePublicKeyPem,
      catalogPublicKeyPem,
    });
    for (const entry of resourceEntries) {
      if (entry.key === CATALOG_KEY) continue;
      if (keys.has(entry.key)) {
        throw new Error(`Duplicate release KV key: ${entry.key}`);
      }
      keys.add(entry.key);
      entries.push(entry);
    }
  }
  entries.push({ key: CATALOG_KEY, value: JSON.stringify(catalogEnvelope) });
  return entries;
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (![
      '--file',
      '--resource-metadata',
      '--catalog-envelope',
      '--resource-public-key',
      '--catalog-public-key',
      '--output',
      '--resources-manifest',
    ].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    const value = args[++index];
    if (!value || value.startsWith('--') || values.has(name)) {
      throw new Error(`Missing or duplicate value for ${name}`);
    }
    values.set(name, value);
  }
  for (const name of [
    '--catalog-envelope',
    '--resource-public-key',
    '--catalog-public-key',
    '--output',
  ]) {
    if (!values.has(name)) throw new Error(`Required option: ${name}`);
  }
  const hasSingleResource = values.has('--file') || values.has('--resource-metadata');
  if (hasSingleResource && (!values.has('--file') || !values.has('--resource-metadata'))) {
    throw new Error('--file and --resource-metadata must be used together.');
  }
  if (hasSingleResource === values.has('--resources-manifest')) {
    throw new Error('Provide either one resource or --resources-manifest, but not both.');
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [catalogRaw, resourceKey, catalogKey] = await Promise.all([
    readFile(args.get('--catalog-envelope'), 'utf8'),
    readFile(args.get('--resource-public-key'), 'utf8'),
    readFile(args.get('--catalog-public-key'), 'utf8'),
  ]);
  const catalogEnvelope = JSON.parse(catalogRaw);
  let entries;
  if (args.has('--resources-manifest')) {
    const manifestPath = args.get('--resources-manifest');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(manifest) || manifest.length === 0) {
      throw new TypeError('Resources manifest must be a non-empty JSON array.');
    }
    const baseDirectory = dirname(resolve(manifestPath));
    const resources = await Promise.all(manifest.map(async (item) => {
      if (!item || typeof item.file !== 'string' || typeof item.metadata !== 'string') {
        throw new TypeError('Each manifest entry needs file and metadata paths.');
      }
      const filePath = resolve(baseDirectory, item.file);
      const metadataPath = resolve(baseDirectory, item.metadata);
      const [payload, metadata] = await Promise.all([
        readFile(filePath),
        readFile(metadataPath, 'utf8'),
      ]);
      return { payload, resource: JSON.parse(metadata) };
    }));
    entries = buildGameReleaseAssetsBatch({
      resources,
      catalogEnvelope,
      resourcePublicKeyPem: resourceKey,
      catalogPublicKeyPem: catalogKey,
    });
  } else {
    const [payload, resourceRaw] = await Promise.all([
      readFile(args.get('--file')),
      readFile(args.get('--resource-metadata'), 'utf8'),
    ]);
    entries = buildGameReleaseAssets({
      payload,
      resource: JSON.parse(resourceRaw),
      catalogEnvelope,
      resourcePublicKeyPem: resourceKey,
      catalogPublicKeyPem: catalogKey,
    });
  }
  await writeFile(args.get('--output'), `${JSON.stringify(entries, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(`Wrote ${entries.length} KV records to ${args.get('--output')} (not uploaded).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Game release packaging failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
