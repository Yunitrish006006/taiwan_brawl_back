const GAME_API_OWNERS = new Map([
  ['mini-royale', {
    gameId: 'game.mini-royale',
    resources: new Set(['cards', 'heroes', 'progression', 'decks', 'rooms']),
  }],
]);

export function resolveGameApiPath(pathname) {
  const match = pathname.match(/^\/api\/games\/([a-z0-9]+(?:-[a-z0-9]+)*)\/v1\/(.+)$/);
  if (!match) return null;
  const [, slug, suffix] = match;
  const owner = GAME_API_OWNERS.get(slug);
  if (!owner || !owner.resources.has(suffix.split('/')[0])) return null;
  return { gameId: owner.gameId, pathname: `/api/${suffix}` };
}

/// Map the versioned game-owned contract onto existing route handlers during
/// migration. Legacy paths remain supported for older clients and admin tools.
export function mapMiniRoyaleApiPath(pathname) {
  const resolved = resolveGameApiPath(pathname);
  return resolved?.gameId === 'game.mini-royale' ? resolved.pathname : null;
}
