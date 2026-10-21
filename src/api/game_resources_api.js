import { corsHeaders, jsonResponse } from '../core/utils.js';

const CATALOG_KEY = 'game-resource-catalog:v1';
const PRERELEASE_IDENTIFIER = String.raw`(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_PATTERN = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const RESOURCE_PATH = new RegExp(`^/game-resources/([a-z0-9][a-z0-9._-]{0,63})/([a-z0-9][a-z0-9._-]{0,63})/(${SEMVER_PATTERN})$`);
const MODULE_ID = /^game\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SEMVER = new RegExp(`^${SEMVER_PATTERN}$`);
const VERSION_RANGE = /^>=(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*) <(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const RESOURCE_KINDS = new Set(['gameplayData', 'presentation', 'localization']);
const GAME_PLATFORMS = new Set(['web', 'android', 'ios', 'windows', 'macos', 'linux']);
const ALL_GAME_PLATFORMS = [...GAME_PLATFORMS];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function compareVersionParts(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].length !== right[index].length) {
      return left[index].length - right[index].length;
    }
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function validatePlatforms(value, fallback, owner) {
  if (value == null) return fallback;
  requireValue(Array.isArray(value) && value.length > 0, `Invalid ${owner} platforms`);
  requireValue(value.every((platform) => typeof platform === 'string' && GAME_PLATFORMS.has(platform)), `Unknown ${owner} platform`);
  requireValue(new Set(value).size === value.length, `Duplicate ${owner} platform`);
  return value;
}

function validateDependencies(dependencies, moduleId) {
  requireValue(Array.isArray(dependencies), 'Invalid dependency list');
  const ids = new Set();
  for (const dependency of dependencies) {
    requireValue(dependency && typeof dependency === 'object' && !Array.isArray(dependency), 'Invalid dependency');
    requireValue(['module', 'resource'].includes(dependency.kind), 'Invalid dependency kind');
    const validId = dependency.kind === 'module'
      ? MODULE_ID.test(dependency.id)
      : typeof dependency.id === 'string' && /^game\.[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9][a-z0-9._-]*$/.test(dependency.id);
    requireValue(validId && dependency.id !== moduleId, 'Invalid dependency ID');
    requireValue(typeof dependency.optional === 'boolean', 'Invalid dependency optional flag');
    const range = typeof dependency.versionRange === 'string'
      ? VERSION_RANGE.exec(dependency.versionRange)
      : null;
    requireValue(range, 'Invalid dependency version range');
    const min = range.slice(1, 4);
    const max = range.slice(4, 7);
    requireValue(compareVersionParts(min, max) < 0, 'Empty dependency version range');
    requireValue(!ids.has(`${dependency.kind}:${dependency.id}`), 'Duplicate dependency');
    ids.add(`${dependency.kind}:${dependency.id}`);
  }
}

function validateMultiplayerContract(contract) {
  requireValue(contract && typeof contract === 'object' && !Array.isArray(contract), 'Invalid multiplayer contract');
  requireValue(Number.isSafeInteger(contract.protocolVersion) && contract.protocolVersion > 0, 'Invalid protocol version');
  requireValue(Number.isSafeInteger(contract.rulesetVersion) && contract.rulesetVersion > 0, 'Invalid ruleset version');
  requireValue(typeof contract.rulesetId === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(contract.rulesetId), 'Invalid ruleset ID');
  requireValue(typeof contract.gameplayContentDigest === 'string' && (/^builtin-[a-z0-9-]+$/.test(contract.gameplayContentDigest) || SHA256.test(contract.gameplayContentDigest)), 'Invalid gameplay digest');
  const range = typeof contract.compatibleProtocolRange === 'string'
    ? /^>=(\d+) <(\d+)$/.exec(contract.compatibleProtocolRange)
    : null;
  requireValue(range, 'Invalid protocol range');
  const minimum = Number(range[1]);
  const maximum = Number(range[2]);
  requireValue(minimum < maximum && contract.protocolVersion >= minimum && contract.protocolVersion < maximum, 'Protocol range excludes declared version');
}

function validateResource(moduleId, resource, modulePlatforms) {
  requireValue(resource && typeof resource === 'object' && !Array.isArray(resource), 'Invalid resource manifest');
  requireValue(typeof resource.resourceId === 'string' && resource.resourceId.startsWith(`${moduleId}.`), 'Resource ID is not module-owned');
  requireValue(typeof resource.version === 'string' && SEMVER.test(resource.version), 'Invalid resource version');
  requireValue(typeof resource.kind === 'string' && RESOURCE_KINDS.has(resource.kind), 'Invalid resource kind');
  requireValue(typeof resource.sha256 === 'string' && SHA256.test(resource.sha256), 'Invalid resource digest');
  requireValue(resource.affectsGameplay == null || typeof resource.affectsGameplay === 'boolean', 'Invalid gameplay-affecting flag');
  requireValue(resource.payloadSchemaVersion == null || (Number.isSafeInteger(resource.payloadSchemaVersion) && resource.payloadSchemaVersion > 0), 'Invalid payload schema version');
  requireValue(resource.activationGroup == null || (typeof resource.activationGroup === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(resource.activationGroup)), 'Invalid resource activation group');
  requireValue(!resource.affectsGameplay || resource.kind === 'gameplayData', 'Only gameplay data may affect gameplay');
  requireValue(resource.required == null || typeof resource.required === 'boolean', 'Invalid required flag');
  validateDependencies(resource.dependencies, moduleId);
  requireValue(!resource.dependencies.some((dependency) => dependency.id === resource.resourceId), 'Resource cannot depend on itself');
  const platforms = validatePlatforms(resource.platforms, modulePlatforms, 'resource');
  requireValue(platforms.every((platform) => modulePlatforms.includes(platform)), 'Resource targets an unsupported module platform');

  if (resource.downloadUrl != null) {
    let downloadUrl;
    try {
      downloadUrl = new URL(resource.downloadUrl);
    } catch (_) {
      throw new Error('Invalid resource download URL');
    }
    requireValue(downloadUrl.protocol === 'https:', 'Resource download must use HTTPS');
    requireValue(Number.isSafeInteger(resource.byteLength) && resource.byteLength >= 0, 'Invalid resource byte length');
    requireValue(typeof resource.signature === 'string' && resource.signature.length > 0, 'Missing resource signature');
    requireValue(typeof resource.signingKeyId === 'string' && resource.signingKeyId.length > 0, 'Missing resource signing key ID');
  }
}

export function validatePublishedGameResourceCatalog(catalog) {
  requireValue(catalog && typeof catalog === 'object' && !Array.isArray(catalog), 'Invalid catalog object');
  requireValue(catalog.envelopeVersion === 1, 'Unsigned game catalog');
  requireValue(typeof catalog.publisher === 'string' && catalog.publisher.trim().length > 0, 'Missing catalog publisher');
  requireValue(typeof catalog.signingKeyId === 'string' && catalog.signingKeyId.trim().length > 0, 'Missing catalog signing key ID');
  requireValue(typeof catalog.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(catalog.signature), 'Invalid catalog signature encoding');
  const issuedAt = Date.parse(catalog.issuedAt);
  const expiresAt = Date.parse(catalog.expiresAt);
  requireValue(Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt > issuedAt, 'Expired or invalid catalog envelope');
  const payload = catalog.payload;
  requireValue(payload && typeof payload === 'object' && !Array.isArray(payload), 'Invalid catalog payload');
  requireValue(payload.catalogVersion === 1 && Array.isArray(payload.modules), 'Unsupported catalog shape');
  const moduleIds = new Set();
  for (const module of payload.modules) {
    requireValue(module && typeof module === 'object' && !Array.isArray(module), 'Invalid module manifest');
    requireValue(typeof module.moduleId === 'string' && MODULE_ID.test(module.moduleId), 'Invalid module ID');
    requireValue(!moduleIds.has(module.moduleId), 'Duplicate module ID');
    moduleIds.add(module.moduleId);
    requireValue(typeof module.displayName === 'string' && module.displayName.trim().length > 0, 'Missing module display name');
    requireValue(typeof module.description === 'string' && module.description.trim().length > 0, 'Missing module description');
    requireValue(module.manifestVersion === 1, 'Unsupported module manifest version');
    requireValue(module.kind === 'game', 'Unsupported module kind');
    requireValue(typeof module.publisher === 'string' && module.publisher.trim().length > 0, 'Missing module publisher');
    requireValue(module.publisher === catalog.publisher, 'Module publisher does not match catalog publisher');
    requireValue(typeof module.packageVersion === 'string' && SEMVER.test(module.packageVersion), 'Invalid package version');
    requireValue(typeof module.minimumShellVersion === 'string' && SEMVER.test(module.minimumShellVersion), 'Invalid minimum shell version');
    const hostApiRange = typeof module.hostApiRange === 'string' ? VERSION_RANGE.exec(module.hostApiRange) : null;
    requireValue(hostApiRange, 'Invalid host API range');
    const hostApiMinimum = hostApiRange.slice(1, 4);
    const hostApiMaximum = hostApiRange.slice(4, 7);
    requireValue(compareVersionParts(hostApiMinimum, hostApiMaximum) < 0, 'Empty host API range');
    requireValue(Number.isSafeInteger(module.dataSchemaVersion) && module.dataSchemaVersion >= 1, 'Invalid data schema version');
    validateDependencies(module.dependencies, module.moduleId);
    const modulePlatforms = validatePlatforms(module.platforms, ALL_GAME_PLATFORMS, 'module');
    if (module.multiplayer != null) validateMultiplayerContract(module.multiplayer);
    requireValue(Array.isArray(module.resources), 'Invalid resource list');
    const resourceIds = new Set();
    for (const resource of module.resources) {
      validateResource(module.moduleId, resource, modulePlatforms);
      requireValue(!resourceIds.has(resource.resourceId), 'Duplicate resource ID');
      resourceIds.add(resource.resourceId);
    }
  }
  return catalog;
}

export function exactGameResourcesApiRouteHandler(request, env, url) {
  if (`${request.method} ${url.pathname}` !== 'GET /api/games/catalog') {
    return null;
  }
  return () => handleGameResourceCatalog(request, env);
}

async function handleGameResourceCatalog(request, env) {
  if (!env.STATIC_ASSETS) {
    return jsonResponse({ error: 'Resource catalog unavailable' }, 503, request);
  }

  const raw = await env.STATIC_ASSETS.get(CATALOG_KEY);
  if (raw == null) {
    const response = jsonResponse({ catalogVersion: 1, modules: [] }, 200, request);
    response.headers.set('Cache-Control', 'public, max-age=60');
    return response;
  }

  try {
    const catalog = validatePublishedGameResourceCatalog(JSON.parse(raw));
    const response = jsonResponse(catalog, 200, request);
    response.headers.set('Cache-Control', 'public, max-age=60');
    return response;
  } catch (_) {
    return jsonResponse({ error: 'Resource catalog is invalid' }, 503, request);
  }
}

export async function handleGameResourceMediaRequest(request, env, url) {
  const match = RESOURCE_PATH.exec(url.pathname);
  if (!match || request.method !== 'GET') return null;

  const [, moduleId, resourceId, version] = match;
  const keySuffix = `${moduleId}:${resourceId}:${version}`;
  const contentKey = `game-resource:${keySuffix}`;
  const metadataKey = `game-resource-meta:${keySuffix}`;
  if (!env.STATIC_ASSETS) return jsonResponse({ error: 'Not Found' }, 404, request);

  const [metadataRaw, body] = await Promise.all([
    env.STATIC_ASSETS.get(metadataKey),
    env.STATIC_ASSETS.get(contentKey, { type: 'arrayBuffer' }),
  ]);
  if (metadataRaw == null || body == null) {
    return jsonResponse({ error: 'Not Found' }, 404, request);
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch (_) {
    return jsonResponse({ error: 'Resource metadata is invalid' }, 503, request);
  }
  const bytes = new Uint8Array(body);
  if (
    !metadata || !Number.isSafeInteger(metadata.byteLength) ||
    metadata.byteLength !== bytes.byteLength ||
    typeof metadata.contentType !== 'string' ||
    typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.sha256)
  ) {
    return jsonResponse({ error: 'Resource metadata is invalid' }, 503, request);
  }

  const headers = new Headers({
    ...corsHeaders(request),
    'Content-Type': metadata.contentType,
    'Content-Length': String(bytes.byteLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': `"${metadata.sha256.toLowerCase()}"`,
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length, ETag',
  });
  const range = request.headers.get('Range');
  if (!range) return new Response(bytes, { status: 200, headers });

  const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(range);
  const start = rangeMatch ? Number(rangeMatch[1]) : NaN;
  const requestedEnd = rangeMatch && rangeMatch[2] ? Number(rangeMatch[2]) : bytes.byteLength - 1;
  if (
    !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) ||
    start < 0 || start >= bytes.byteLength || requestedEnd < start
  ) {
    headers.set('Content-Range', `bytes */${bytes.byteLength}`);
    return new Response(null, { status: 416, headers });
  }

  const end = Math.min(requestedEnd, bytes.byteLength - 1);
  const chunk = bytes.slice(start, end + 1);
  headers.set('Content-Length', String(chunk.byteLength));
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
  return new Response(chunk, { status: 206, headers });
}
