import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MODULE_ID = /^game\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const RESOURCE_ID = /^game\.[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9][a-z0-9._-]*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function canonicalResourceMessage({ moduleId, resourceId, version, sha256, payload }) {
  const header = `${moduleId}\n${resourceId}\n${version}\n${sha256.toLowerCase()}\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), payload]);
}

export function signGameResource({
  moduleId,
  resourceId,
  version,
  payload,
  privateKeyPem,
  signingKeyId,
  contentType,
  baseUrl,
  payloadSchemaVersion,
}) {
  if (!MODULE_ID.test(moduleId) || !RESOURCE_ID.test(resourceId) || !resourceId.startsWith(`${moduleId}.`)) {
    throw new TypeError('Resource ID must be owned by a valid game module.');
  }
  if (!SEMVER.test(version)) throw new TypeError('Resource version must be semantic versioning.');
  if (payloadSchemaVersion != null &&
      (!Number.isSafeInteger(payloadSchemaVersion) || payloadSchemaVersion < 1)) {
    throw new TypeError('Payload schema version must be a positive integer.');
  }
  if (typeof signingKeyId !== 'string' || !signingKeyId.trim()) {
    throw new TypeError('Resource signing key ID is required.');
  }
  if (typeof contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w=.+-]+)*$/.test(contentType)) {
    throw new TypeError('A valid resource content type is required.');
  }
  let origin;
  try {
    origin = new URL(baseUrl);
  } catch (_) {
    throw new TypeError('A valid HTTPS resource base URL is required.');
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password) {
    throw new TypeError('A valid HTTPS resource base URL is required.');
  }
  if (!Buffer.isBuffer(payload)) throw new TypeError('Resource payload must be bytes.');
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Resource signing key must be Ed25519.');
  }
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const signature = sign(null, canonicalResourceMessage({
    moduleId,
    resourceId,
    version,
    sha256,
    payload,
  }), privateKey).toString('base64url');
  const objectSuffix = `${moduleId.replace(/^game\./, '')}:${resourceId}:${version}`;
  const downloadPath = `/game-resources/${moduleId.replace(/^game\./, '')}/${resourceId}/${version}`;
  return {
    moduleId,
    resourceId,
    version,
    ...(payloadSchemaVersion == null ? {} : { payloadSchemaVersion }),
    sha256,
    byteLength: payload.byteLength,
    signature,
    signingKeyId,
    contentType,
    downloadUrl: new URL(downloadPath, origin.origin).toString(),
    contentKey: `game-resource:${objectSuffix}`,
    metadataKey: `game-resource-meta:${objectSuffix}`,
    storageMetadata: {
      byteLength: payload.byteLength,
      contentType,
      sha256,
    },
  };
}

function parseArgs(args) {
  const names = ['--file', '--private-key', '--module-id', '--resource-id', '--version', '--key-id', '--content-type', '--base-url', '--payload-schema-version'];
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!names.includes(name)) throw new Error(`Unknown option: ${name}`);
    const value = args[++index];
    if (!value || value.startsWith('--') || values.has(name)) {
      throw new Error(`Missing or duplicate value for ${name}`);
    }
    values.set(name, value);
  }
  for (const name of names.filter((item) => item !== '--payload-schema-version')) {
    if (!values.has(name)) throw new Error(`Required option: ${name}`);
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await readFile(args.get('--file'));
  const privateKeyPem = await readFile(args.get('--private-key'), 'utf8');
  const resource = signGameResource({
    moduleId: args.get('--module-id'),
    resourceId: args.get('--resource-id'),
    version: args.get('--version'),
    payload,
    privateKeyPem,
    signingKeyId: args.get('--key-id'),
    contentType: args.get('--content-type'),
    baseUrl: args.get('--base-url'),
    payloadSchemaVersion: args.has('--payload-schema-version')
      ? Number(args.get('--payload-schema-version'))
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(resource, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Resource signing failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
