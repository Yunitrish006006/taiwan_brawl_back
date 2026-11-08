import { spawnSync } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const KEY_ID = 'catalog-prod-2026-10';
const PUBLISHER = 'taiwan-brawl';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyCatalogKeyPair(privateKeyPem, publicKeyBase64Url) {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Keychain item is not an Ed25519 private key.');
  }
  const configuredPublicKey = Buffer.from(publicKeyBase64Url, 'base64url');
  if (configuredPublicKey.length !== 32) {
    throw new TypeError('Configured Ed25519 public key must be 32 bytes.');
  }

  const derivedPublicKey = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(ED25519_SPKI_PREFIX.length);
  if (!derivedPublicKey.equals(configuredPublicKey)) {
    throw new Error('Keychain private key does not match the configured public key.');
  }

  const challenge = randomBytes(32);
  const signature = sign(null, challenge, privateKey);
  if (!verify(null, challenge, createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, configuredPublicKey]),
    format: 'der',
    type: 'spki',
  }), signature)) {
    throw new Error('Random challenge signature verification failed.');
  }
  return true;
}

export function readCatalogTrustRoot(wranglerJsonc) {
  const match = /"GAME_CATALOG_TRUST_KEYS"\s*:\s*("(?:\\.|[^"\\])*")/s.exec(wranglerJsonc);
  if (!match) throw new Error('GAME_CATALOG_TRUST_KEYS is missing from wrangler.jsonc.');
  const roots = JSON.parse(JSON.parse(match[1]));
  const root = roots[KEY_ID];
  if (!root || root.publisher !== PUBLISHER || typeof root.publicKey !== 'string') {
    throw new Error(`Configured trust root ${KEY_ID} is missing or invalid.`);
  }
  return root;
}

export function readKeychainGenericPassword({ service, account }) {
  const result = spawnSync('security', [
    'find-generic-password', '-s', service, '-a', account, '-w',
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || !result.stdout?.trim()) {
    throw new Error('Could not read the specified Keychain item. Check service/account and unlock login Keychain.');
  }
  return result.stdout.trim();
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!['--service', '--account'].includes(name)) throw new Error(`Unknown option: ${name}`);
    const value = args[++index];
    if (!value || value.startsWith('--') || values.has(name)) {
      throw new Error(`Missing or duplicate value for ${name}`);
    }
    values.set(name, value);
  }
  for (const name of ['--service', '--account']) {
    if (!values.has(name)) throw new Error(`Required option: ${name}`);
  }
  return values;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const privateKeyPem = readKeychainGenericPassword({
      service: args.get('--service'),
      account: args.get('--account'),
    });
    const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const trustRoot = readCatalogTrustRoot(wrangler);
    verifyCatalogKeyPair(privateKeyPem, trustRoot.publicKey);
    process.stdout.write(`Verified ${PUBLISHER}/${KEY_ID}: Keychain private key matches the configured public key.\n`);
  } catch (error) {
    process.stderr.write(`Keychain catalog-key verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
