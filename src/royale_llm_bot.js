import {
  CENTER_LATERAL,
  FIELD_ASPECT_RATIO,
  LEFT_TOWER_X,
  MAX_COMBO_CARDS,
  RIGHT_TOWER_X,
  WORLD_SCALE,
  distanceBetweenPoints,
  sanitizeLanePosition,
  sanitizeLateralPosition,
  sideDirection
} from './royale_battle_rules.js';

export const DEFAULT_LLM_BOT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_LLM_BOT_MODEL = 'gpt-4o-mini';

const LLM_BOT_SPEC_VERSION = 'ghost-island-brawl-llm-bot/v1';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_SERVER_INFO = {
  name: 'ghost-island-brawl-llm-bot',
  version: '1.0.0'
};

function metric(value, digits = 1) {
  return Number((Number(value) || 0).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function positiveInteger(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.max(0, Math.round(normalized)) : fallback;
}

function normalizeEnergyCostType(card = {}) {
  if (card.type === 'equipment') {
    return 'money';
  }
  if (card.energyCostType === 'money') {
    return 'money';
  }
  if (card.energyCostType === 'spirit' || card.type === 'spell') {
    return 'spirit';
  }
  return 'physical';
}

function normalizeCard(card = {}) {
  return {
    id: String(card.id || ''),
    name: String(card.name || card.nameEn || card.nameZhHant || card.nameJa || card.id || ''),
    type: String(card.type || 'melee'),
    energyCost: positiveInteger(card.energyCost ?? card.elixirCost, 0),
    energyCostType: normalizeEnergyCostType(card),
    hp: positiveInteger(card.hp, 0),
    damage: positiveInteger(card.damage, 0),
    attackRange: positiveInteger(card.attackRange, 0),
    bodyRadius: positiveInteger(card.bodyRadius, 0),
    moveSpeed: positiveInteger(card.moveSpeed, 0),
    attackSpeed: metric(card.attackSpeed || 0, 2),
    spawnCount: positiveInteger(card.spawnCount, 1) || 1,
    spellRadius: positiveInteger(card.spellRadius, 0),
    spellDamage: positiveInteger(card.spellDamage, 0),
    targetRule: String(card.targetRule || 'ground'),
    effectKind: String(card.effectKind || 'none'),
    effectValue: metric(card.effectValue || 0),
    isJob: card.type === 'job'
  };
}

function normalizePlayerState(player = {}, side) {
  return {
    side,
    userId: Number(player.userId || 0),
    name: String(player.name || side),
    heroId: String(player.heroId || player.hero?.id || 'ordinary_person'),
    isBot: Boolean(player.isBot || Number(player.userId || 0) <= 0),
    botController: normalizeBotController(player.botController),
    deckCards: Array.isArray(player.deckCards)
      ? player.deckCards.map(normalizeCard).filter((card) => card.id)
      : [],
    handCardIds: Array.isArray(player.handCardIds ?? player.hand)
      ? (player.handCardIds ?? player.hand).map(String)
      : [],
    queueCardIds: Array.isArray(player.queueCardIds ?? player.queue)
      ? (player.queueCardIds ?? player.queue).map(String)
      : [],
    towerHp: positiveInteger(player.towerHp, 0),
    maxTowerHp: positiveInteger(player.maxTowerHp, 0),
    physicalHealth: metric(player.physicalHealth),
    maxPhysicalHealth: metric(player.maxPhysicalHealth),
    physicalHealthRegen: metric(player.physicalHealthRegen),
    spiritHealth: metric(player.spiritHealth),
    maxSpiritHealth: metric(player.maxSpiritHealth),
    spiritHealthRegen: metric(player.spiritHealthRegen),
    physicalEnergy: metric(player.physicalEnergy),
    maxPhysicalEnergy: metric(player.maxPhysicalEnergy),
    physicalEnergyRegen: metric(player.physicalEnergyRegen),
    spiritEnergy: metric(player.spiritEnergy),
    maxSpiritEnergy: metric(player.maxSpiritEnergy),
    spiritEnergyRegen: metric(player.spiritEnergyRegen),
    money: metric(player.money),
    maxMoney: metric(player.maxMoney),
    moneyPerSecond: metric(player.moneyPerSecond)
  };
}

function normalizeUnit(unit = {}) {
  return {
    id: String(unit.id || ''),
    cardId: String(unit.cardId || ''),
    side: unit.side === 'right' ? 'right' : 'left',
    type: String(unit.type || 'melee'),
    progress: metric(unit.progress),
    lateralPosition: metric(unit.lateralPosition || CENTER_LATERAL),
    hp: positiveInteger(unit.hp, 0),
    maxHp: positiveInteger(unit.maxHp, 0),
    damage: positiveInteger(unit.damage, 0),
    attackRange: positiveInteger(unit.attackRange, 0),
    bodyRadius: positiveInteger(unit.bodyRadius, 0),
    moveSpeed: metric(unit.moveSpeed),
    attackSpeed: metric(unit.attackSpeed || 0, 2),
    targetRule: String(unit.targetRule || 'ground')
  };
}

function normalizeEvent(event = {}) {
  return {
    id: String(event.id || ''),
    kind: String(event.kind || ''),
    side: event.side === 'right' ? 'right' : 'left',
    title: String(event.title || event.titleEn || ''),
    description: String(event.description || event.descriptionEn || ''),
    tone: String(event.tone || 'mixed')
  };
}

function assertValidDecisionState(state) {
  if (!state.players.left.deckCards.length || !state.players.right.deckCards.length) {
    throw new Error('Decision state must include deckCards for both players');
  }
  if (!['left', 'right'].includes(state.playerSide)) {
    throw new Error('playerSide must be left or right');
  }
}

export function normalizeLlmBotBaseUrl(value) {
  const normalized = String(value ?? '').trim().replace(/\/+$/, '');
  return normalized || DEFAULT_LLM_BOT_BASE_URL;
}

export function normalizeLlmBotModel(value) {
  const normalized = String(value ?? '').trim();
  return normalized || DEFAULT_LLM_BOT_MODEL;
}

export function normalizeBotController(value) {
  return String(value ?? '').trim().toLowerCase() === 'llm' ? 'llm' : 'heuristic';
}

export function maskLlmBotApiKey(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= 4) {
    return '*'.repeat(normalized.length);
  }
  return `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
}

export function buildLlmBotSettingsSnapshot(row = {}) {
  const apiKey = String(row.llm_api_key ?? '').trim();
  return {
    llm_base_url: normalizeLlmBotBaseUrl(row.llm_base_url),
    llm_model: normalizeLlmBotModel(row.llm_model),
    llm_has_api_key: apiKey.length > 0,
    llm_api_key_mask: apiKey.length > 0 ? maskLlmBotApiKey(apiKey) : ''
  };
}

export async function fetchUserLlmBotSettings(env, userId) {
  const row =
    (await env.DB.prepare(
      `SELECT llm_base_url, llm_model, llm_api_key
       FROM users
       WHERE id = ?`
    )
      .bind(userId)
      .first()) ?? {};

  return {
    baseUrl: normalizeLlmBotBaseUrl(row.llm_base_url),
    model: normalizeLlmBotModel(row.llm_model),
    apiKey: String(row.llm_api_key ?? '').trim()
  };
}

export function normalizeLlmBotDecisionState(payload = {}) {
  const playerSide = payload.playerSide === 'left' ? 'left' : 'right';
  const state = {
    roomCode: String(payload.roomCode || ''),
    playerSide,
    timeRemainingMs: positiveInteger(payload.timeRemainingMs, 0),
    players: {
      left: normalizePlayerState(payload.players?.left, 'left'),
      right: normalizePlayerState(payload.players?.right, 'right')
    },
    units: Array.isArray(payload.units) ? payload.units.map(normalizeUnit) : [],
    events: Array.isArray(payload.events) ? payload.events.map(normalizeEvent) : []
  };
  assertValidDecisionState(state);
  return state;
}

function cardEnergyCost(card) {
  return positiveInteger(card.energyCost, 0);
}

function cardEnergyType(card) {
  return normalizeEnergyCostType(card);
}

function playerResourceForType(player, resourceType) {
  if (resourceType === 'money') {
    return Number(player.money || 0);
  }
  return resourceType === 'spirit'
    ? Number(player.spiritEnergy || 0)
    : Number(player.physicalEnergy || 0);
}

function canAffordCard(player, card) {
  return playerResourceForType(player, cardEnergyType(card)) + 1e-6 >= cardEnergyCost(card);
}

function actionCost(cards) {
  return cards.reduce(
    (cost, card) => {
      if (cardEnergyType(card) === 'money') {
        cost.money += cardEnergyCost(card);
      } else if (cardEnergyType(card) === 'spirit') {
        cost.spirit += cardEnergyCost(card);
      } else {
        cost.physical += cardEnergyCost(card);
      }
      return cost;
    },
    { physical: 0, spirit: 0, money: 0 }
  );
}

function ownTowerProgress(side) {
  return side === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
}

function averageLateralPosition(units) {
  if (!units.length) {
    return CENTER_LATERAL;
  }
  return units.reduce((sum, unit) => sum + unit.lateralPosition, 0) / units.length;
}

function distanceToOwnTower(side, progress) {
  return Math.abs(progress - ownTowerProgress(side));
}

function selectPriorityThreat(side, enemyUnits) {
  if (!enemyUnits.length) {
    return null;
  }

  return enemyUnits
    .slice()
    .sort((a, b) => {
      const aScore =
        (1000 - distanceToOwnTower(side, a.progress)) +
        Number(a.damage || 0) * 0.7 +
        Number(a.maxHp || a.hp || 0) * 0.08 +
        (a.targetRule === 'tower' ? 180 : 0) +
        (a.type === 'swarm' ? 70 : 0);
      const bScore =
        (1000 - distanceToOwnTower(side, b.progress)) +
        Number(b.damage || 0) * 0.7 +
        Number(b.maxHp || b.hp || 0) * 0.08 +
        (b.targetRule === 'tower' ? 180 : 0) +
        (b.type === 'swarm' ? 70 : 0);
      return bScore - aScore;
    })[0];
}

function selectAlliedFront(side, alliedUnits) {
  if (!alliedUnits.length) {
    return null;
  }
  const direction = sideDirection(side);
  return alliedUnits
    .slice()
    .sort((a, b) => b.progress * direction - a.progress * direction)[0];
}

function isUrgentThreat(side, threat) {
  if (!threat) {
    return false;
  }
  return distanceToOwnTower(side, threat.progress) < 260;
}

function cardPowerScore(card) {
  return (
    Number(card.damage || 0) * 1.25 +
    Number(card.hp || 0) * 0.06 +
    Number(card.attackRange || 0) * 0.18 +
    Number(card.moveSpeed || 0) * 0.1 +
    Math.max(1, Number(card.spawnCount || 1)) * 55
  );
}

function evaluateSpellTarget(state, side, spellCard) {
  const enemyUnits = state.units.filter((unit) => unit.side !== side && unit.hp > 0);
  if (!enemyUnits.length) {
    return null;
  }

  let bestTarget = null;
  for (const candidate of enemyUnits) {
    const hitUnits = enemyUnits.filter(
      (unit) =>
        distanceBetweenPoints(
          unit.progress,
          unit.lateralPosition,
          candidate.progress,
          candidate.lateralPosition
        ) <= Number(spellCard.spellRadius || 0)
    );

    if (!hitUnits.length) {
      continue;
    }

    const totalDamage = hitUnits.reduce(
      (sum, unit) => sum + Math.min(Number(unit.hp || 0), Number(spellCard.spellDamage || 0)),
      0
    );
    const killCount = hitUnits.filter(
      (unit) => Number(unit.hp || 0) <= Number(spellCard.spellDamage || 0)
    ).length;
    const minimumThreatDistance = Math.min(
      ...hitUnits.map((unit) => distanceToOwnTower(side, unit.progress))
    );
    const score =
      totalDamage +
      hitUnits.length * 110 +
      killCount * 160 +
      (minimumThreatDistance < 260 ? 120 : 0);

    if (!bestTarget || score > bestTarget.score) {
      bestTarget = {
        score,
        progress: hitUnits.reduce((sum, unit) => sum + unit.progress, 0) / hitUnits.length,
        lateralPosition: averageLateralPosition(hitUnits),
        hits: hitUnits.length,
        kills: killCount
      };
    }
  }

  return bestTarget;
}

function scorePrimaryCard(state, side, player, card, alliedFront, threat) {
  const urgentThreat = isUrgentThreat(side, threat);
  const enemySide = side === 'left' ? 'right' : 'left';
  const ownTowerHp = Number(state.players[side]?.towerHp || 0);
  const enemyTowerHp = Number(state.players[enemySide]?.towerHp || 0);

  if (card.isJob) {
    const currentMoney = Number(player.money || 0);
    const maxMoney = Math.max(1, Number(player.maxMoney || 1));
    let score = Number(card.effectValue || 0) * 12 - cardEnergyCost(card) * 6;
    if (currentMoney <= maxMoney * 0.25) {
      score += 180;
    } else if (currentMoney <= maxMoney * 0.5) {
      score += 90;
    } else {
      score -= 40;
    }
    if (urgentThreat) {
      score -= 70;
    }
    return score;
  }

  if (card.type === 'spell') {
    const spellTarget = evaluateSpellTarget(state, side, card);
    if (!spellTarget) {
      return -220;
    }
    let score = spellTarget.score - cardEnergyCost(card) * 12;
    if (spellTarget.kills >= 2) {
      score += 120;
    }
    if (urgentThreat) {
      score += 80;
    }
    return score;
  }

  let score = cardPowerScore(card) - cardEnergyCost(card) * 32;
  if (Number(card.attackRange || 0) >= 200) {
    score += 80;
  }
  if (card.targetRule === 'tower') {
    score += urgentThreat ? -140 : 180;
  }
  if (urgentThreat) {
    score += Number(card.attackRange || 0) >= 200 ? 120 : 50;
    score += Number(card.spawnCount || 1) >= 3 ? 110 : 0;
    score += cardEnergyCost(card) <= 3 ? 70 : 0;
  } else {
    score += alliedFront && Number(card.attackRange || 0) >= 200 ? 130 : 0;
    score += alliedFront && card.targetRule === 'tower' ? 60 : 0;
    score += !alliedFront && card.type === 'tank' ? 90 : 0;
  }

  if (ownTowerHp < enemyTowerHp - 500) {
    score += card.targetRule === 'tower' ? -80 : 90;
  } else if (ownTowerHp > enemyTowerHp + 400) {
    score += card.targetRule === 'tower' ? 60 : 0;
  }

  if (player.physicalEnergy + player.spiritEnergy >= 8 && card.type === 'tank') {
    score += 40;
  }

  return score;
}

function scoreEquipmentCard(primaryCard, equipmentCard) {
  let score = 40 - cardEnergyCost(equipmentCard) * 8;
  switch (equipmentCard.effectKind) {
    case 'damage_boost':
      score +=
        Number(primaryCard.damage || 0) * 0.18 +
        Math.max(1, Number(primaryCard.spawnCount || 1)) * 40;
      break;
    case 'health_boost':
      score += Number(primaryCard.hp || 0) * 0.07 + (primaryCard.type === 'tank' ? 80 : 0);
      break;
    case 'speed_boost':
      score += Number(primaryCard.moveSpeed || 0) * 0.18;
      score += primaryCard.targetRule === 'tower' ? 90 : 20;
      break;
    default:
      score -= 40;
      break;
  }
  return score;
}

function buildBotDropPoint(state, side, primaryCard) {
  const enemyUnits = state.units.filter((unit) => unit.side !== side && unit.hp > 0);
  const alliedUnits = state.units.filter((unit) => unit.side === side && unit.hp > 0);
  const threat = selectPriorityThreat(side, enemyUnits);
  const alliedFront = selectAlliedFront(side, alliedUnits);
  const defaultLateral = averageLateralPosition(enemyUnits);

  if (primaryCard.type === 'spell') {
    const spellTarget = evaluateSpellTarget(state, side, primaryCard);
    if (spellTarget) {
      return {
        progress: sanitizeLanePosition(side, spellTarget.progress),
        lateralPosition: sanitizeLateralPosition(spellTarget.lateralPosition)
      };
    }
  }

  let progress =
    primaryCard.targetRule === 'tower'
      ? side === 'left'
        ? 360
        : 640
      : side === 'left'
        ? 280
        : 720;
  let lateralPosition = defaultLateral;

  if (isUrgentThreat(side, threat)) {
    const defensiveOffset = Number(primaryCard.attackRange || 0) >= 200 ? 130 : 70;
    progress = threat.progress - sideDirection(side) * defensiveOffset;
    lateralPosition = threat.lateralPosition;
  } else if (alliedFront) {
    const supportOffset =
      Number(primaryCard.attackRange || 0) >= 200
        ? 110
        : primaryCard.targetRule === 'tower'
          ? 30
          : 75;
    progress = alliedFront.progress - sideDirection(side) * supportOffset;
    lateralPosition = alliedFront.lateralPosition;
  } else if (threat) {
    progress = threat.progress - sideDirection(side) * 90;
    lateralPosition = threat.lateralPosition;
  }

  return {
    progress: sanitizeLanePosition(side, progress),
    lateralPosition: sanitizeLateralPosition(lateralPosition)
  };
}

function pickBestEquipmentCombo(player, primaryCard, playableEquipment) {
  const comboCards = [primaryCard];
  const remainingPools = {
    physical: Number(player.physicalEnergy || 0),
    spirit: Number(player.spiritEnergy || 0),
    money: Number(player.money || 0)
  };
  remainingPools[cardEnergyType(primaryCard)] -= cardEnergyCost(primaryCard);

  const scoredEquipment = playableEquipment
    .map((card) => ({
      card,
      score: scoreEquipmentCard(primaryCard, card)
    }))
    .filter((entry) => entry.score > 45)
    .sort((a, b) => b.score - a.score);

  for (const entry of scoredEquipment) {
    if (comboCards.length >= MAX_COMBO_CARDS) {
      break;
    }
    if (cardEnergyCost(entry.card) > remainingPools[cardEnergyType(entry.card)] + 1e-6) {
      continue;
    }
    comboCards.push(entry.card);
    remainingPools[cardEnergyType(entry.card)] -= cardEnergyCost(entry.card);
  }

  return comboCards;
}

function actionLabel(cards) {
  return cards.map((card) => card.name || card.id).join(' + ');
}

function serializeAction(state, side, cards, score) {
  const primaryCard = cards.find((card) => card.type !== 'equipment') ?? cards[0];
  const dropPoint = buildBotDropPoint(state, side, primaryCard);
  const jitter = primaryCard.type === 'spell' ? 0 : 28 / FIELD_ASPECT_RATIO;
  const lateralPosition = sanitizeLateralPosition(dropPoint.lateralPosition + jitter * 0.2);
  const progress = sanitizeLanePosition(side, dropPoint.progress);
  const dropY = side === 'left' ? WORLD_SCALE - progress : progress;
  const cost = actionCost(cards);
  const actionId = [
    'play',
    cards.map((card) => card.id).join('+'),
    Math.round(lateralPosition),
    Math.round(dropY)
  ].join(':');

  return {
    id: actionId,
    kind: 'play',
    summary: `Play ${actionLabel(cards)}`,
    cardIds: cards.map((card) => card.id),
    primaryCardId: primaryCard.id,
    dropX: metric(lateralPosition),
    dropY: metric(dropY),
    score: metric(score),
    cost
  };
}

function dedupeActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    if (seen.has(action.id)) {
      return false;
    }
    seen.add(action.id);
    return true;
  });
}

function buildStateSummary(state) {
  const me = state.players[state.playerSide];
  const opponentSide = state.playerSide === 'left' ? 'right' : 'left';
  const opponent = state.players[opponentSide];
  const hand = me.handCardIds
    .map((cardId) => me.deckCards.find((card) => card.id === cardId))
    .filter(Boolean)
    .map((card) => ({
      id: card.id,
      name: card.name,
      type: card.type,
      energyCost: card.energyCost,
      energyCostType: card.energyCostType,
      damage: card.damage,
      hp: card.hp,
      attackRange: card.attackRange,
      spellRadius: card.spellRadius,
      spellDamage: card.spellDamage,
      effectKind: card.effectKind,
      effectValue: card.effectValue
    }));

  return {
    roomCode: state.roomCode,
    timeRemainingMs: state.timeRemainingMs,
    playerSide: state.playerSide,
    me: {
      side: me.side,
      heroId: me.heroId,
      towerHp: me.towerHp,
      maxTowerHp: me.maxTowerHp,
      physicalHealth: me.physicalHealth,
      spiritHealth: me.spiritHealth,
      physicalEnergy: me.physicalEnergy,
      spiritEnergy: me.spiritEnergy,
      money: me.money,
      hand
    },
    opponent: {
      side: opponent.side,
      heroId: opponent.heroId,
      towerHp: opponent.towerHp,
      maxTowerHp: opponent.maxTowerHp,
      physicalHealth: opponent.physicalHealth,
      spiritHealth: opponent.spiritHealth,
      physicalEnergy: opponent.physicalEnergy,
      spiritEnergy: opponent.spiritEnergy,
      money: opponent.money
    },
    units: state.units.map((unit) => ({
      id: unit.id,
      side: unit.side,
      type: unit.type,
      progress: metric(unit.progress),
      lateralPosition: metric(unit.lateralPosition),
      hp: unit.hp,
      damage: unit.damage,
      targetRule: unit.targetRule
    })),
    recentEvents: state.events.slice(-4)
  };
}

function buildProtocolRules() {
  return {
    specVersion: LLM_BOT_SPEC_VERSION,
    battlefield: {
      worldScale: WORLD_SCALE,
      leftTowerX: LEFT_TOWER_X,
      rightTowerX: RIGHT_TOWER_X
    },
    turnRules: {
      maxComboCards: MAX_COMBO_CARDS,
      jobCardsMustBePlayedAlone: true,
      equipmentNeedsUnitSameCast: true,
      validEnergyTypes: ['physical', 'spirit', 'money']
    },
    outputContract: {
      jsonOnly: true,
      shape: {
        actionId: 'one of legal_actions[].id',
        reason: 'short plain-text reason'
      }
    }
  };
}

export function buildLlmBotProtocol(rawState, { limit = 6 } = {}) {
  const state = normalizeLlmBotDecisionState(rawState);
  const side = state.playerSide;
  const player = state.players[side];
  const handCards = player.handCardIds
    .map((cardId) => player.deckCards.find((card) => card.id === cardId))
    .filter(Boolean);
  const affordable = handCards.filter((card) => canAffordCard(player, card));
  const playableEquipment = affordable.filter((card) => card.type === 'equipment');
  const enemyUnits = state.units.filter((unit) => unit.side !== side && unit.hp > 0);
  const alliedUnits = state.units.filter((unit) => unit.side === side && unit.hp > 0);
  const threat = selectPriorityThreat(side, enemyUnits);
  const alliedFront = selectAlliedFront(side, alliedUnits);

  const playActions = [];
  for (const card of affordable) {
    if (card.type === 'equipment') {
      continue;
    }

    const score = scorePrimaryCard(state, side, player, card, alliedFront, threat);
    const cards =
      !card.isJob && card.type !== 'spell'
        ? pickBestEquipmentCombo(player, card, playableEquipment)
        : [card];
    playActions.push(serializeAction(state, side, cards, score));
  }

  const legalActions = [
    {
      id: 'wait',
      kind: 'wait',
      summary: 'Wait and regenerate resources',
      cardIds: [],
      primaryCardId: null,
      dropX: null,
      dropY: null,
      score: metric(
        (player.physicalEnergyRegen || 0) +
          (player.spiritEnergyRegen || 0) +
          (player.moneyPerSecond || 0) * 0.6
      ),
      cost: { physical: 0, spirit: 0, money: 0 }
    },
    ...dedupeActions(playActions).sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit - 1))
  ];

  return {
    specVersion: LLM_BOT_SPEC_VERSION,
    rules: buildProtocolRules(),
    stateSummary: buildStateSummary(state),
    legalActions
  };
}

function fallbackDecision(protocol) {
  return protocol.legalActions.find((action) => action.kind === 'play') ?? protocol.legalActions[0];
}

function extractMessageText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (typeof entry?.text === 'string') {
          return entry.text;
        }
        return '';
      })
      .join('');
  }
  throw new Error('LLM provider returned no message content');
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('LLM provider returned an empty response');
  }

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('LLM provider did not return valid JSON');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function chatCompletionsUrl(baseUrl) {
  const normalized = normalizeLlmBotBaseUrl(baseUrl);
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
}

function providerErrorText(body) {
  if (typeof body?.error === 'string') {
    return body.error;
  }
  if (typeof body?.error?.message === 'string') {
    return body.error.message;
  }
  return 'LLM provider request failed';
}

export async function decideLlmBotAction(rawState, settings, { fetchImpl = fetch } = {}) {
  const protocol = buildLlmBotProtocol(rawState);
  const fallback = fallbackDecision(protocol);
  const apiKey = String(settings?.apiKey ?? '').trim();
  if (!apiKey) {
    throw new Error('LLM bot API key is not configured');
  }

  const payload = {
    model: normalizeLlmBotModel(settings?.model),
    temperature: 0.2,
    max_tokens: 200,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are the opposing player controller for Ghost Island Brawl. Choose exactly one actionId from legal_actions. Never invent cards, resources, or coordinates. Return JSON only in the form {"actionId":"...","reason":"..."}'
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            specVersion: protocol.specVersion,
            rules: protocol.rules,
            state: protocol.stateSummary,
            legal_actions: protocol.legalActions
          },
          null,
          2
        )
      }
    ]
  };

  const response = await fetchImpl(chatCompletionsUrl(settings?.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(providerErrorText(body));
  }

  const parsed = extractJsonObject(extractMessageText(body));
  const actionId = String(parsed?.actionId ?? '').trim();
  const selected = protocol.legalActions.find((action) => action.id === actionId) ?? fallback;

  return {
    action: selected,
    source: selected.id === actionId ? 'llm' : 'fallback',
    usedFallback: selected.id !== actionId,
    reason: String(parsed?.reason ?? '').trim(),
    specVersion: protocol.specVersion
  };
}

function mcpToolDefinitions() {
  return [
    {
      name: 'get_rules',
      description: 'Return the low-level Ghost Island Brawl turn protocol and output contract.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {}
      }
    },
    {
      name: 'list_legal_actions',
      description:
        'Given a normalized Ghost Island Brawl decision state, return the current legal actions for the bot.',
      inputSchema: {
        type: 'object',
        required: ['state'],
        properties: {
          state: { type: 'object' }
        }
      }
    },
    {
      name: 'decide_action',
      description:
        'Use the saved OpenAI-compatible LLM settings for the authenticated player to choose one legal action.',
      inputSchema: {
        type: 'object',
        required: ['state'],
        properties: {
          state: { type: 'object' }
        }
      }
    }
  ];
}

export function buildLlmBotSpec() {
  return {
    name: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: {
      api: {
        getSpec: 'GET /api/llm-bot/spec',
        decide: 'POST /api/llm-bot/decide'
      },
      mcp: {
        endpoint: 'POST /api/llm-bot/mcp',
        style: 'jsonrpc-http'
      }
    },
    defaults: {
      baseUrl: DEFAULT_LLM_BOT_BASE_URL,
      model: DEFAULT_LLM_BOT_MODEL,
      botControllers: ['heuristic', 'llm']
    },
    rules: buildProtocolRules(),
    tools: mcpToolDefinitions()
  };
}

function mcpResult(id, result) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result
  };
}

function mcpError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function mcpToolContent(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

export async function handleLlmBotMcpPayload(payload, settingsLoader) {
  const id = payload?.id ?? null;
  switch (payload?.method) {
    case 'initialize':
      return mcpResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO
      });
    case 'ping':
      return mcpResult(id, {});
    case 'tools/list':
      return mcpResult(id, {
        tools: mcpToolDefinitions()
      });
    case 'tools/call': {
      const toolName = String(payload?.params?.name || '');
      const args = payload?.params?.arguments ?? {};
      switch (toolName) {
        case 'get_rules':
          return mcpResult(id, mcpToolContent(buildLlmBotSpec()));
        case 'list_legal_actions':
          return mcpResult(id, mcpToolContent(buildLlmBotProtocol(args.state)));
        case 'decide_action': {
          const settings = await settingsLoader();
          const decision = await decideLlmBotAction(args.state, settings);
          return mcpResult(id, mcpToolContent(decision));
        }
        default:
          return mcpError(id, -32601, `Unknown tool: ${toolName}`);
      }
    }
    default:
      return mcpError(id, -32601, `Unknown method: ${String(payload?.method || '')}`);
  }
}
