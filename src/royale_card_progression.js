export const DEFAULT_CARD_USE_LIMIT = 8;

const CARD_UNLOCK_AGE_BY_ID = Object.freeze({
  delinquent_89: 14
});

const LOW_VALUE_ITEM_CARD_IDS = new Set([
  'gua_pi_helmet',
  'umbrella',
  'betel_nut',
  'florida_water'
]);

function normalizedType(card = {}) {
  return String(card.type || '').trim().toLowerCase();
}

export function isEventCard(card = {}) {
  return normalizedType(card) === 'event';
}

export function isUnitCard(card = {}) {
  const type = normalizedType(card);
  return (
    type !== 'equipment' &&
    type !== 'spell' &&
    type !== 'event' &&
    type !== 'job' &&
    type !== 'building'
  );
}

export function cardUnlockAge(card = {}) {
  const explicit = CARD_UNLOCK_AGE_BY_ID[String(card.id || '')];
  if (Number.isFinite(explicit)) {
    return explicit;
  }

  const type = normalizedType(card);
  if (type === 'equipment') {
    return 0;
  }
  if (type === 'event') {
    return 3;
  }
  if (type === 'spell' || type === 'skill') {
    return 5;
  }
  if (type === 'job') {
    return 16;
  }
  return 8;
}

export function cardUnlockTier(card = {}) {
  const age = cardUnlockAge(card);
  if (age >= 16) return 'job';
  if (age >= 14) return 'teenUnit';
  if (age >= 8) return 'unit';
  if (age >= 5) return 'skill';
  if (age >= 3) return 'event';
  return 'item';
}

export function cardUseLimit(card = {}) {
  const explicitLimit = Math.round(Number(card.useLimit ?? card.maxUses ?? 0));
  if (explicitLimit > 0) {
    return Math.min(99, explicitLimit);
  }
  return DEFAULT_CARD_USE_LIMIT;
}

export function cardUsesFor(battlePlayer = {}, cardId) {
  return Math.max(0, Math.round(Number(battlePlayer.cardUses?.[cardId] || 0)));
}

export function cardUseLimitFor(battlePlayer = {}, card) {
  const cardId = String(card?.id || '');
  const limit = Math.round(Number(battlePlayer.cardUseLimits?.[cardId] || 0));
  return limit > 0 ? limit : cardUseLimit(card);
}

export function remainingCardUses(battlePlayer = {}, card = {}) {
  const cardId = String(card.id || '');
  return Math.max(0, cardUseLimitFor(battlePlayer, card) - cardUsesFor(battlePlayer, cardId));
}

export function cardHasUsesRemaining(battlePlayer = {}, card = {}) {
  return remainingCardUses(battlePlayer, card) > 0;
}

export function ensureBattleCardUseState(battlePlayer = {}, deckCards = []) {
  if (!battlePlayer.cardUses || typeof battlePlayer.cardUses !== 'object') {
    battlePlayer.cardUses = {};
  }
  if (!battlePlayer.cardUseLimits || typeof battlePlayer.cardUseLimits !== 'object') {
    battlePlayer.cardUseLimits = {};
  }

  for (const card of deckCards) {
    const cardId = String(card?.id || '');
    if (!cardId) {
      continue;
    }
    battlePlayer.cardUses[cardId] = cardUsesFor(battlePlayer, cardId);
    if (!battlePlayer.cardUseLimits[cardId]) {
      battlePlayer.cardUseLimits[cardId] = cardUseLimit(card);
    }
  }
}

export function recordCardUses(battlePlayer = {}, cards = []) {
  if (!battlePlayer.cardUses || typeof battlePlayer.cardUses !== 'object') {
    battlePlayer.cardUses = {};
  }
  for (const card of cards) {
    const cardId = String(card?.id || '');
    if (!cardId) {
      continue;
    }
    battlePlayer.cardUses[cardId] = cardUsesFor(battlePlayer, cardId) + 1;
  }
}

export function swapCardUseDurability(battlePlayer = {}, deckCards = []) {
  ensureBattleCardUseState(battlePlayer, deckCards);
  const changed = [];
  for (const card of deckCards) {
    const cardId = String(card?.id || '');
    if (!cardId) {
      continue;
    }
    const limit = cardUseLimitFor(battlePlayer, card);
    const used = cardUsesFor(battlePlayer, cardId);
    battlePlayer.cardUses[cardId] = Math.max(0, limit - used);
    changed.push({
      cardId,
      usedBefore: used,
      remainingBefore: Math.max(0, limit - used),
      remainingAfter: Math.max(0, limit - battlePlayer.cardUses[cardId])
    });
  }
  return changed;
}

export function isLowValueItemCard(card = {}) {
  return (
    normalizedType(card) === 'equipment' &&
    LOW_VALUE_ITEM_CARD_IDS.has(String(card.id || ''))
  );
}

export function stealLowValueItemUse(battlePlayer = {}, deckCards = []) {
  ensureBattleCardUseState(battlePlayer, deckCards);
  const target = deckCards.find(
    (card) => isLowValueItemCard(card) && remainingCardUses(battlePlayer, card) > 0
  );
  if (!target) {
    return null;
  }
  const cardId = String(target.id);
  battlePlayer.cardUses[cardId] = cardUsesFor(battlePlayer, cardId) + 1;
  return {
    cardId,
    cardName: target.name,
    remaining: remainingCardUses(battlePlayer, target)
  };
}
