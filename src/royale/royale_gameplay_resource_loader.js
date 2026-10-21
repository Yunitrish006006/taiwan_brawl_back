import { validatePublishedGameResourceCatalog } from '../api/game_resources_api.js';
import {
  DEFAULT_MINI_ROYALE_GAMEPLAY_RULES,
  normalizeMiniRoyaleGameplayRules,
} from './royale_gameplay_rules.js';
import { ROYALE_GAME_CONTRACT } from './royale_compatibility.js';

const CATALOG_KEY = 'game-resource-catalog:v1';
const RULES_RESOURCE_ID = 'game.mini-royale.gameplay-rules';
const textEncoder = new TextEncoder();

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (_) {
    return null;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('Unsupported canonical JSON value');
}

function trustedKeyFor(env, keyId, publisher) {
  try {
    const trust = JSON.parse(env.GAME_CATALOG_TRUST_KEYS || '{}');
    const entry = trust[keyId];
    if (!entry || entry.publisher !== publisher) return null;
    const publicKey = decodeBase64Url(entry.publicKey);
    return publicKey?.length === 32 ? publicKey : null;
  } catch (_) {
    return null;
  }
}

async function verifyEd25519(publicKeyBytes, signatureEncoded, message) {
  const signature = decodeBase64Url(signatureEncoded);
  if (!signature || signature.length !== 64 || publicKeyBytes.length !== 32) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify('Ed25519', key, signature, message);
  } catch (_) {
    return false;
  }
}

function catalogSignedMessage(envelope) {
  const header = `game-catalog-v1\n${envelope.publisher}\n${envelope.signingKeyId}\n${envelope.issuedAt}\n${envelope.expiresAt}\n`;
  return textEncoder.encode(header + canonicalJson(envelope.payload));
}

function resourceSignedMessage({ moduleId, resourceId, version, sha256, bytes }) {
  const header = `${moduleId}\n${resourceId}\n${version}\n${sha256.toLowerCase()}\n`;
  const encodedHeader = textEncoder.encode(header);
  const message = new Uint8Array(encodedHeader.length + bytes.length);
  message.set(encodedHeader);
  message.set(bytes, encodedHeader.length);
  return message;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function gameplayDigest(resources) {
  if (resources.length === 0) return ROYALE_GAME_CONTRACT.gameplayContentDigest;
  return [ROYALE_GAME_CONTRACT.gameplayContentDigest, ...resources
    .map((resource) => `${resource.resourceId}@${resource.version}:${resource.sha256}`)
  ].join('\n');
}

async function loadCatalog(env) {
  const raw = await env.STATIC_ASSETS?.get?.(CATALOG_KEY);
  if (!raw) return null;
  let envelope;
  try {
    envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
    validatePublishedGameResourceCatalog(envelope);
  } catch (_) {
    return null;
  }
  const trustedKey = trustedKeyFor(env, envelope.signingKeyId, envelope.publisher);
  if (!trustedKey || !(await verifyEd25519(
    trustedKey,
    envelope.signature,
    catalogSignedMessage(envelope),
  ))) return null;
  return envelope;
}

/** Resolves a contract only when every declared gameplay byte is catalogued,
 * signed by the trusted publisher, digest-verified and understood by schema v1.
 */
export async function resolveMiniRoyaleGameplayRules(gameContract, env) {
  const resources = gameContract.gameplayResources;
  if (resources.length === 0) {
    return gameContract.gameplayContentDigest === ROYALE_GAME_CONTRACT.gameplayContentDigest
      ? { ok: true, rules: DEFAULT_MINI_ROYALE_GAMEPLAY_RULES }
      : { ok: false, reason: 'Unknown gameplay digest.' };
  }
  if (resources.length !== 1 || resources[0].resourceId !== RULES_RESOURCE_ID) {
    return { ok: false, reason: 'Unsupported gameplay resource set.' };
  }
  if (!env.STATIC_ASSETS) return { ok: false, reason: 'Gameplay resource storage is unavailable.' };

  const expectedDigest = await sha256Hex(textEncoder.encode(gameplayDigest(resources)));
  if (expectedDigest !== gameContract.gameplayContentDigest.toLowerCase()) {
    return { ok: false, reason: 'Gameplay resource digest does not match its contract.' };
  }

  const envelope = await loadCatalog(env);
  if (!envelope) return { ok: false, reason: 'No trusted, valid game catalog is available.' };
  const module = envelope.payload.modules.find((item) => item.moduleId === ROYALE_GAME_CONTRACT.gameId);
  const [requested] = resources;
  const manifest = module?.resources?.find((item) => item.resourceId === requested.resourceId);
  if (!module || module.publisher !== envelope.publisher ||
      manifest?.version !== requested.version ||
      manifest?.sha256?.toLowerCase() !== requested.sha256 ||
      manifest?.kind !== 'gameplayData' || manifest?.affectsGameplay !== true ||
      manifest?.signingKeyId == null || manifest?.signature == null) {
    return { ok: false, reason: 'Gameplay resource is not in the trusted catalog.' };
  }

  const resourceKey = trustedKeyFor(env, manifest.signingKeyId, module.publisher);
  if (!resourceKey) return { ok: false, reason: 'Gameplay resource signing key is not trusted.' };
  const storageSuffix = `mini-royale:${manifest.resourceId}:${manifest.version}`;
  const [rawBytes, rawMetadata] = await Promise.all([
    env.STATIC_ASSETS.get(`game-resource:${storageSuffix}`, { type: 'arrayBuffer' }),
    env.STATIC_ASSETS.get(`game-resource-meta:${storageSuffix}`),
  ]);
  if (!rawBytes || !rawMetadata) return { ok: false, reason: 'Gameplay resource bytes are unavailable.' };

  let metadata;
  try {
    metadata = typeof rawMetadata === 'string' ? JSON.parse(rawMetadata) : rawMetadata;
  } catch (_) {
    return { ok: false, reason: 'Gameplay resource metadata is invalid.' };
  }
  const bytes = new Uint8Array(rawBytes);
  if (bytes.length !== manifest.byteLength ||
      metadata.sha256?.toLowerCase() !== requested.sha256 ||
      await sha256Hex(bytes) !== requested.sha256) {
    return { ok: false, reason: 'Gameplay resource content digest mismatch.' };
  }
  if (!(await verifyEd25519(
    resourceKey,
    manifest.signature,
    resourceSignedMessage({
      moduleId: module.moduleId,
      resourceId: manifest.resourceId,
      version: manifest.version,
      sha256: requested.sha256,
      bytes,
    }),
  ))) return { ok: false, reason: 'Gameplay resource signature is invalid.' };

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (_) {
    return { ok: false, reason: 'Gameplay rules JSON is invalid.' };
  }
  const rules = normalizeMiniRoyaleGameplayRules(parsed);
  if (!rules || rules.rulesetId !== gameContract.rulesetId ||
      rules.rulesetVersion !== gameContract.rulesetVersion) {
    return { ok: false, reason: 'Gameplay rules do not match the room ruleset.' };
  }
  return { ok: true, rules };
}
