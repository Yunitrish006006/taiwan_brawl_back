export const ROYALE_GAME_CONTRACT = Object.freeze({
  gameId: 'game.mini-royale',
  moduleVersion: '0.1.0',
  protocolVersion: 1,
  compatibleProtocolRange: '>=1 <2',
  rulesetId: 'mini-royale-ranked',
  rulesetVersion: 1,
  gameplayContentDigest: 'builtin-royale-rules-v1',
  gameplayResources: Object.freeze([]),
});

function normalizeGameplayResources(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 4) return null;
  const resources = [];
  const ids = new Set();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const keys = Object.keys(item).sort();
    if (keys.join(',') !== 'resourceId,sha256,version' ||
        typeof item.resourceId !== 'string' ||
        !/^game\.mini-royale\.[a-z0-9][a-z0-9._-]*$/.test(item.resourceId) ||
        typeof item.version !== 'string' ||
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(item.version) ||
        typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256) ||
        ids.has(item.resourceId)) return null;
    ids.add(item.resourceId);
    resources.push(Object.freeze({
      resourceId: item.resourceId,
      version: item.version,
      sha256: item.sha256.toLowerCase(),
    }));
  }
  return resources.sort((left, right) => left.resourceId.localeCompare(right.resourceId));
}

export function normalizeRoyaleGameContract(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  const moduleVersion = typeof candidate.moduleVersion === 'string' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(candidate.moduleVersion)
    ? candidate.moduleVersion
    : null;
  const protocolVersion = Number.isSafeInteger(candidate.protocolVersion)
    ? candidate.protocolVersion
    : null;
  // Older persisted rooms predate range metadata. Preserve their previous
  // exact-version behavior rather than granting an inferred wider range.
  const compatibleProtocolRange = candidate.compatibleProtocolRange ??
    (protocolVersion == null ? null : `>=${protocolVersion} <${protocolVersion + 1}`);
  const range = typeof compatibleProtocolRange === 'string'
    ? /^>=(\d+) <(\d+)$/.exec(compatibleProtocolRange)
    : null;
  const rangeMinimum = range ? Number(range[1]) : null;
  const rangeMaximum = range ? Number(range[2]) : null;
  if (
    candidate.gameId !== ROYALE_GAME_CONTRACT.gameId ||
    moduleVersion == null ||
    protocolVersion == null || protocolVersion < 1 ||
    !range || rangeMinimum < 1 || rangeMinimum >= rangeMaximum ||
    protocolVersion < rangeMinimum || protocolVersion >= rangeMaximum ||
    candidate.rulesetId !== ROYALE_GAME_CONTRACT.rulesetId ||
    candidate.rulesetVersion !== ROYALE_GAME_CONTRACT.rulesetVersion
  ) {
    return null;
  }
  const digest = candidate.gameplayContentDigest;
  const gameplayResources = normalizeGameplayResources(candidate.gameplayResources);
  if (
    digest !== ROYALE_GAME_CONTRACT.gameplayContentDigest &&
    !(typeof digest === 'string' && /^[a-f0-9]{64}$/i.test(digest)) ||
    gameplayResources == null
  ) {
    return null;
  }
  return Object.freeze({
    ...ROYALE_GAME_CONTRACT,
    moduleVersion,
    protocolVersion,
    compatibleProtocolRange: `>=${rangeMinimum} <${rangeMaximum}`,
    gameplayContentDigest: digest,
    gameplayResources: Object.freeze(gameplayResources),
  });
}

function rangeIncludes(range, version) {
  const match = /^>=(\d+) <(\d+)$/.exec(range);
  return Boolean(match && version >= Number(match[1]) && version < Number(match[2]));
}

export function isCompatibleRoyaleProtocol(candidate, supported = ROYALE_GAME_CONTRACT) {
  const actual = normalizeRoyaleGameContract(candidate);
  const required = normalizeRoyaleGameContract(supported);
  return Boolean(actual && required) &&
    rangeIncludes(required.compatibleProtocolRange, actual.protocolVersion) &&
    rangeIncludes(actual.compatibleProtocolRange, required.protocolVersion);
}

export function isCompatibleRoyaleClient(candidate, required = ROYALE_GAME_CONTRACT) {
  const actualContract = normalizeRoyaleGameContract(candidate);
  const requiredContract = normalizeRoyaleGameContract(required);
  return Boolean(actualContract && requiredContract) &&
    isCompatibleRoyaleProtocol(actualContract, requiredContract) &&
    actualContract.rulesetId === requiredContract.rulesetId &&
    actualContract.rulesetVersion === requiredContract.rulesetVersion &&
    actualContract.gameplayContentDigest === requiredContract.gameplayContentDigest &&
    JSON.stringify(actualContract.gameplayResources) ===
      JSON.stringify(requiredContract.gameplayResources);
}
