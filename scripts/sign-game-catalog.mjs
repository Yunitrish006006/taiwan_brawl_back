import { readFile } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { validatePublishedGameResourceCatalog } from '../src/api/game_resources_api.js';

export function canonicalCatalogJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Catalog numbers must be finite.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalCatalogJson).join(',')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalCatalogJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('Catalog must contain only JSON values.');
}

export function canonicalCatalogMessage({ publisher, signingKeyId, issuedAt, expiresAt, payload }) {
  const header = `game-catalog-v1\n${publisher}\n${signingKeyId}\n${issuedAt}\n${expiresAt}\n`;
  return Buffer.from(header + canonicalCatalogJson(payload), 'utf8');
}

export function signGameCatalog({ payload, publisher, signingKeyId, privateKeyPem, now = new Date(), expiresInHours = 24 }) {
  if (!publisher?.trim() || !signingKeyId?.trim()) {
    throw new TypeError('Publisher and signing key ID are required.');
  }
  if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > 24 * 30) {
    throw new RangeError('Catalog expiry must be between 0 and 720 hours.');
  }
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Catalog signing key must be Ed25519.');
  }
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString();
  const envelope = {
    envelopeVersion: 1,
    publisher,
    signingKeyId,
    issuedAt,
    expiresAt,
    payload,
    signature: sign(null, canonicalCatalogMessage({
      publisher,
      signingKeyId,
      issuedAt,
      expiresAt,
      payload,
    }), privateKey).toString('base64url'),
  };
  validatePublishedGameResourceCatalog(envelope);
  return envelope;
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!['--input', '--private-key', '--publisher', '--key-id', '--expires-in-hours'].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    const value = args[++index];
    if (!value || value.startsWith('--') || values.has(name)) {
      throw new Error(`Missing or duplicate value for ${name}`);
    }
    values.set(name, value);
  }
  for (const required of ['--input', '--private-key', '--publisher', '--key-id']) {
    if (!values.has(required)) throw new Error(`Required option: ${required}`);
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(await readFile(args.get('--input'), 'utf8'));
  const privateKeyPem = await readFile(args.get('--private-key'), 'utf8');
  const expiresInHours = Number(args.get('--expires-in-hours') ?? 24);
  const envelope = signGameCatalog({
    payload,
    publisher: args.get('--publisher'),
    signingKeyId: args.get('--key-id'),
    privateKeyPem,
    expiresInHours,
  });
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Catalog signing failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
