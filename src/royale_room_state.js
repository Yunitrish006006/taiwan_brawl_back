import {
  BOT_MIN_THINK_MS,
  CENTER_LATERAL,
  MATCH_DURATION_MS,
  TOWER_HP,
  bodyRadiusForUnitType,
  clamp,
  displayAttackReach
} from './royale_battle_rules.js';

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowMs() {
  return Date.now();
}

export function createBattleState(playersBySide) {
  return {
    timeRemainingMs: MATCH_DURATION_MS,
    startedAt: new Date().toISOString(),
    units: [],
    nextUnitId: 1,
    result: null,
    players: Object.fromEntries(
      Object.entries(playersBySide).map(([side, player]) => {
        const queue = player.deckCardIds.slice();
        return [
          side,
          {
            elixir: 5,
            hand: queue.splice(0, 4),
            queue,
            botThinkMs: player.isBot ? BOT_MIN_THINK_MS : 0,
            towerHp: TOWER_HP,
            maxTowerHp: TOWER_HP
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
    elixir: includeDeckState ? Number((battleState?.elixir ?? 5).toFixed(1)) : undefined,
    handCardIds: includeDeckState ? battleState?.hand ?? player.deckCardIds.slice(0, 4) : undefined,
    queueCardIds: includeDeckState ? battleState?.queue ?? player.deckCardIds.slice(4) : undefined,
    isBot: Boolean(player.isBot),
    ready: player.ready,
    connected: player.connected,
    towerHp: battleState?.towerHp ?? TOWER_HP,
    maxTowerHp: battleState?.maxTowerHp ?? TOWER_HP
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
    yourHand: battlePlayer
      ? battlePlayer.hand
          .map((cardId) => viewer.deckCards.find((card) => card.id === cardId))
          .filter(Boolean)
      : [],
    nextCardId: battlePlayer?.queue?.[0] ?? null,
    units: room.battle.units.map((unit) => buildUnitSnapshot(unit)),
    result: room.battle.result
  };
}

function normalizeBattlePlayerState(playerState = {}) {
  return {
    elixir: Number(playerState.elixir || 0),
    hand: Array.isArray(playerState.hand) ? playerState.hand.map(String) : [],
    queue: Array.isArray(playerState.queue) ? playerState.queue.map(String) : [],
    botThinkMs: Number(playerState.botThinkMs || 0),
    towerHp: clamp(Number(playerState.towerHp || TOWER_HP), 0, TOWER_HP),
    maxTowerHp: Number(playerState.maxTowerHp || TOWER_HP)
  };
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
    units: Array.isArray(state.units) ? state.units.map(normalizeBattleUnitState) : []
  });
}
