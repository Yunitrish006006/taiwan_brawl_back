import {
  BOT_MIN_THINK_MS,
  CENTER_LATERAL,
  MATCH_DURATION_MS,
  bodyRadiusForUnitType,
  displayAttackReach
} from './royale_battle_rules.js';
import {
  buildHeroSnapshot,
  buildInitialBattlePlayerState,
  normalizeHeroId,
  syncBattlePlayerTotals
} from './royale_heroes.js';

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowMs() {
  return Date.now();
}

function metric(value) {
  return Number((Number(value) || 0).toFixed(1));
}

export function createBattleState(playersBySide) {
  return {
    timeRemainingMs: MATCH_DURATION_MS,
    startedAt: new Date().toISOString(),
    units: [],
    events: [],
    nextUnitId: 1,
    result: null,
    players: Object.fromEntries(
      Object.entries(playersBySide).map(([side, player]) => {
        const queue = player.deckCardIds.slice();
        return [
          side,
          {
            ...buildInitialBattlePlayerState(player.heroId, {
              isBot: Boolean(player.isBot)
            }),
            hand: queue.splice(0, 4),
            queue,
            botThinkMs: player.isBot ? BOT_MIN_THINK_MS : 0
          }
        ];
      })
    )
  };
}

export function createPlayer(side, payload) {
  return {
    side,
    userId: Number(payload.user.id),
    name: payload.user.name,
    deckId: Number(payload.deck.id),
    deckName: payload.deck.name,
    deckCardIds: payload.deck.cards.map((card) => card.id),
    deckCards: payload.deck.cards,
    heroId: normalizeHeroId(payload.heroId),
    ready: Boolean(payload.user.isBot),
    connected: Boolean(payload.user.isBot),
    isBot: Boolean(payload.user.isBot),
    lastDisconnectedAt: null
  };
}

export function buildPlayerSnapshot(player, battleState, includeDeckState) {
  return {
    userId: player.userId,
    name: player.name,
    side: player.side,
    deckId: player.deckId,
    deckName: player.deckName,
    deckCards: includeDeckState ? player.deckCards : undefined,
    hero: buildHeroSnapshot(player.heroId),
    elixir: includeDeckState ? Number((battleState?.elixir ?? 5).toFixed(1)) : undefined,
    handCardIds: includeDeckState ? battleState?.hand ?? player.deckCardIds.slice(0, 4) : undefined,
    queueCardIds: includeDeckState ? battleState?.queue ?? player.deckCardIds.slice(4) : undefined,
    isBot: Boolean(player.isBot),
    ready: player.ready,
    connected: player.connected,
    physicalHealth: metric(battleState?.physicalHealth),
    maxPhysicalHealth: metric(battleState?.maxPhysicalHealth),
    physicalHealthRegen: metric(battleState?.physicalHealthRegen),
    spiritHealth: metric(battleState?.spiritHealth),
    maxSpiritHealth: metric(battleState?.maxSpiritHealth),
    spiritHealthRegen: metric(battleState?.spiritHealthRegen),
    physicalEnergy: metric(battleState?.physicalEnergy),
    maxPhysicalEnergy: metric(battleState?.maxPhysicalEnergy),
    physicalEnergyRegen: metric(battleState?.physicalEnergyRegen),
    spiritEnergy: metric(battleState?.spiritEnergy),
    maxSpiritEnergy: metric(battleState?.maxSpiritEnergy),
    spiritEnergyRegen: metric(battleState?.spiritEnergyRegen),
    money: metric(battleState?.money),
    maxMoney: metric(battleState?.maxMoney),
    moneyPerSecond: metric(battleState?.moneyPerSecond),
    towerHp: battleState?.towerHp ?? 0,
    maxTowerHp: battleState?.maxTowerHp ?? 0
  };
}

export function buildUnitSnapshot(unit) {
  return {
    id: unit.id,
    cardId: unit.cardId,
    name: unit.name,
    nameZhHant: unit.nameZhHant || unit.name,
    nameEn: unit.nameEn || unit.name,
    nameJa: unit.nameJa || unit.name,
    imageUrl: unit.imageUrl || null,
    side: unit.side,
    type: unit.type,
    progress: Math.round(unit.progress),
    lateralPosition: Math.round(unit.lateralPosition),
    hp: Math.max(0, Math.round(unit.hp)),
    maxHp: unit.maxHp,
    attackRange: Math.round(displayAttackReach(unit)),
    bodyRadius: Math.round(unit.bodyRadius ?? 0),
    effects: unit.effects ?? []
  };
}

export function buildBattleSnapshot(room, viewer, battlePlayer) {
  if (!room?.battle) {
    return null;
  }

  return {
    timeRemainingMs: Math.max(0, Math.floor(room.battle.timeRemainingMs)),
    yourElixir: battlePlayer ? Number(battlePlayer.elixir.toFixed(1)) : 0,
    yourMaxElixir: battlePlayer ? Number((battlePlayer.maxElixir ?? 0).toFixed(1)) : 0,
    yourMoney: battlePlayer ? Number((battlePlayer.money ?? 0).toFixed(1)) : 0,
    yourHand: battlePlayer
      ? battlePlayer.hand
          .map((cardId) => viewer.deckCards.find((card) => card.id === cardId))
          .filter(Boolean)
      : [],
    nextCardId: battlePlayer?.queue?.[0] ?? null,
    units: room.battle.units.map((unit) => buildUnitSnapshot(unit)),
    events: Array.isArray(room.battle.events) ? room.battle.events.map(clone) : [],
    result: room.battle.result
  };
}

function normalizeBattleEventState(event = {}) {
  return {
    id: String(event.id || ''),
    kind: String(event.kind || 'job_outcome'),
    side: event.side === 'right' ? 'right' : 'left',
    cardId: String(event.cardId || ''),
    cardName: String(event.cardName || ''),
    cardNameZhHant: String(event.cardNameZhHant || event.cardName || ''),
    cardNameEn: String(event.cardNameEn || event.cardName || ''),
    cardNameJa: String(event.cardNameJa || event.cardName || ''),
    title: String(event.title || event.titleEn || ''),
    titleZhHant: String(event.titleZhHant || event.title || ''),
    titleEn: String(event.titleEn || event.title || ''),
    titleJa: String(event.titleJa || event.title || ''),
    description: String(event.description || event.descriptionEn || ''),
    descriptionZhHant: String(event.descriptionZhHant || event.description || ''),
    descriptionEn: String(event.descriptionEn || event.description || ''),
    descriptionJa: String(event.descriptionJa || event.description || ''),
    tone: String(event.tone || 'mixed'),
    mentalStage: Number(event.mentalStage || 0),
    moneyDelta: metric(event.moneyDelta),
    physicalHealthDelta: metric(event.physicalHealthDelta),
    spiritHealthDelta: metric(event.spiritHealthDelta),
    physicalEnergyDelta: metric(event.physicalEnergyDelta),
    spiritEnergyDelta: metric(event.spiritEnergyDelta)
  };
}

function normalizeBattlePlayerState(playerState = {}) {
  return syncBattlePlayerTotals({
    elixir: Number(playerState.elixir || 0),
    hand: Array.isArray(playerState.hand) ? playerState.hand.map(String) : [],
    queue: Array.isArray(playerState.queue) ? playerState.queue.map(String) : [],
    botThinkMs: Number(playerState.botThinkMs || 0),
    physicalHealth: Number(playerState.physicalHealth || playerState.towerHp || 0),
    maxPhysicalHealth: Number(playerState.maxPhysicalHealth || playerState.maxTowerHp || 0),
    physicalHealthRegen: Number(playerState.physicalHealthRegen || 0),
    spiritHealth: Number(playerState.spiritHealth || 0),
    maxSpiritHealth: Number(playerState.maxSpiritHealth || 0),
    spiritHealthRegen: Number(playerState.spiritHealthRegen || 0),
    physicalEnergy: Number(playerState.physicalEnergy || playerState.elixir || 0),
    maxPhysicalEnergy: Number(playerState.maxPhysicalEnergy || playerState.maxElixir || playerState.elixir || 0),
    physicalEnergyRegen: Number(playerState.physicalEnergyRegen || 0),
    spiritEnergy: Number(playerState.spiritEnergy || 0),
    maxSpiritEnergy: Number(playerState.maxSpiritEnergy || 0),
    spiritEnergyRegen: Number(playerState.spiritEnergyRegen || 0),
    money: Number(playerState.money || 0),
    maxMoney: Number(playerState.maxMoney || 0),
    moneyPerSecond: Number(playerState.moneyPerSecond || 0)
  });
}

function normalizeBattleUnitState(unit = {}) {
  return {
    id: String(unit.id),
    cardId: String(unit.cardId),
    name: String(unit.name || ''),
    nameZhHant: String(unit.nameZhHant || unit.name || ''),
    nameEn: String(unit.nameEn || unit.name || ''),
    nameJa: String(unit.nameJa || unit.name || ''),
    imageUrl: unit.imageUrl || null,
    type: String(unit.type || 'melee'),
    side: unit.side === 'right' ? 'right' : 'left',
    progress: Number(unit.progress || 0),
    lateralPosition: Number(unit.lateralPosition || CENTER_LATERAL),
    hp: Number(unit.hp || 0),
    maxHp: Number(unit.maxHp || 0),
    damage: Number(unit.damage || 0),
    attackRange: Number(unit.attackRange || 0),
    bodyRadius: Number(unit.bodyRadius || bodyRadiusForUnitType(unit.type)),
    moveSpeed: Number(unit.moveSpeed || 0),
    attackSpeed: Number(unit.attackSpeed || 1),
    targetRule: String(unit.targetRule || 'ground'),
    cooldown: Number(unit.cooldown || 0),
    effects: Array.isArray(unit.effects) ? unit.effects.map(String) : []
  };
}

export function normalizeHostBattleState(previousBattle, state) {
  return clone({
    timeRemainingMs: Math.max(0, Number(state.timeRemainingMs || 0)),
    startedAt: previousBattle?.startedAt || new Date().toISOString(),
    nextUnitId: Number(state.nextUnitId || previousBattle?.nextUnitId || 1),
    result: state.result ?? null,
    players: {
      left: normalizeBattlePlayerState(state.players?.left),
      right: normalizeBattlePlayerState(state.players?.right)
    },
    units: Array.isArray(state.units) ? state.units.map(normalizeBattleUnitState) : [],
    events: Array.isArray(state.events) ? state.events.map(normalizeBattleEventState) : []
  });
}
