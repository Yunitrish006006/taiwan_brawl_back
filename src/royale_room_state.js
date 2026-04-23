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
import { normalizeBotController } from './royale_llm_bot.js';
import { normalizeCardDefinition } from './royale_cards.js';
import { initFieldState, getFieldStateSnapshot } from './royale_field_events.js';
import {
  cardUseLimit,
  ensureBattleCardUseState
} from './royale_card_progression.js';

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowMs() {
  return Date.now();
}

function metric(value) {
  return Number((Number(value) || 0).toFixed(1));
}

function normalizeAnimationEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }
  const animation = String(event.animation || event.type || '')
    .trim()
    .toLowerCase();
  const id = Math.round(Number(event.id || event.sequence || 0));
  if (!/^[a-z0-9_-]{1,32}$/.test(animation) || id <= 0) {
    return null;
  }
  return { animation, id };
}

export function createBattleState(playersBySide) {
  return {
    timeRemainingMs: MATCH_DURATION_MS,
    startedAt: new Date().toISOString(),
    units: [],
    events: [],
    nextUnitId: 1,
    result: null,
    cardMentalBonus: {},
    fieldState: initFieldState(),
    players: Object.fromEntries(
      Object.entries(playersBySide).map(([side, player]) => {
        const queue = player.deckCardIds.slice();
        const battlePlayerState = {
          ...buildInitialBattlePlayerState(player.heroId, {
            isBot: Boolean(player.isBot)
          }),
          hand: queue.splice(0, 4),
          queue,
          botThinkMs: player.isBot ? BOT_MIN_THINK_MS : 0,
          cardUses: {},
          cardUseLimits: Object.fromEntries(
            (player.deckCards || []).map((card) => [card.id, cardUseLimit(card)])
          )
        };
        ensureBattleCardUseState(battlePlayerState, player.deckCards || []);
        return [
          side,
          battlePlayerState
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
    deckCards: payload.deck.cards.map((card) => normalizeCardDefinition(card)),
    heroId: normalizeHeroId(payload.heroId),
    botController: Boolean(payload.user.isBot)
      ? normalizeBotController(payload.user.botController)
      : 'heuristic',
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
    botController: Boolean(player.isBot)
      ? normalizeBotController(player.botController)
      : 'heuristic',
    handCardIds: includeDeckState ? battleState?.hand ?? player.deckCardIds.slice(0, 4) : undefined,
    queueCardIds: includeDeckState ? battleState?.queue ?? player.deckCardIds.slice(4) : undefined,
    cardUses: includeDeckState ? battleState?.cardUses ?? {} : undefined,
    cardUseLimits: includeDeckState ? battleState?.cardUseLimits ?? {} : undefined,
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
    heroAttackCooldown: metric(battleState?.heroAttackCooldown),
    heroAttackEvent: battleState?.heroAttackEvent ?? null,
    towerHp: battleState?.towerHp ?? 0,
    maxTowerHp: battleState?.maxTowerHp ?? 0
  };
}

export function buildUnitSnapshot(unit) {
  const animationEvent = normalizeAnimationEvent(unit.animationEvent);
  return {
    id: unit.id,
    cardId: unit.cardId,
    name: unit.name,
    nameZhHant: unit.nameZhHant || unit.name,
    nameEn: unit.nameEn || unit.name,
    nameJa: unit.nameJa || unit.name,
    imageUrl: unit.imageUrl || null,
    characterImageUrl: unit.characterImageUrl || unit.imageUrl || null,
    characterFrontImageUrl:
      unit.characterFrontImageUrl ||
      unit.characterImageUrl ||
      unit.imageUrl ||
      null,
    characterBackImageUrl: unit.characterBackImageUrl || null,
    characterLeftImageUrl: unit.characterLeftImageUrl || null,
    characterRightImageUrl: unit.characterRightImageUrl || null,
    characterImageUrls: {
      front:
        unit.characterFrontImageUrl ||
        unit.characterImageUrl ||
        unit.imageUrl ||
        null,
      back: unit.characterBackImageUrl || null,
      left: unit.characterLeftImageUrl || null,
      right: unit.characterRightImageUrl || null
    },
    characterAssets: Array.isArray(unit.characterAssets)
      ? unit.characterAssets
      : [],
    facingDirection: unit.facingDirection || 'forward',
    animationState: unit.animationState || 'move',
    animationEvent,
    side: unit.side,
    type: unit.type,
    progress: Math.round(unit.progress),
    lateralPosition: Math.round(unit.lateralPosition),
    hp: Math.max(0, Math.round(unit.hp)),
    maxHp: unit.maxHp,
    attackRange: Math.round(displayAttackReach(unit)),
    bodyRadius: Math.round(unit.bodyRadius ?? 0),
    degenerationPerSecond: Number(unit.degenerationPerSecond || 0),
    effects: unit.effects ?? [],
    statusEffects: (unit.statusEffects ?? [])
      .filter((e) => e.remainingMs > 0)
      .map((e) => e.kind)
  };
}

export function buildBattleSnapshot(room, viewer, battlePlayer) {
  if (!room?.battle) {
    return null;
  }

  return {
    timeRemainingMs: Math.max(0, Math.floor(room.battle.timeRemainingMs)),
    yourMoney: battlePlayer ? Number((battlePlayer.money ?? 0).toFixed(1)) : 0,
    yourHand: battlePlayer
      ? battlePlayer.hand
          .map((cardId) => viewer.deckCards.find((card) => card.id === cardId))
          .filter(Boolean)
      : [],
    yourCardUses: battlePlayer?.cardUses ?? {},
    yourCardUseLimits: battlePlayer?.cardUseLimits ?? {},
    nextCardId: battlePlayer?.queue?.[0] ?? null,
    units: room.battle.units.map((unit) => buildUnitSnapshot(unit)),
    events: Array.isArray(room.battle.events) ? room.battle.events.map(clone) : [],
    result: room.battle.result,
    fieldState: getFieldStateSnapshot(room.battle)
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
    hand: Array.isArray(playerState.hand) ? playerState.hand.map(String) : [],
    queue: Array.isArray(playerState.queue) ? playerState.queue.map(String) : [],
    cardUses:
      playerState.cardUses && typeof playerState.cardUses === 'object' && !Array.isArray(playerState.cardUses)
        ? Object.fromEntries(
            Object.entries(playerState.cardUses).map(([k, v]) => [String(k), Math.max(0, Math.round(Number(v)))])
          )
        : {},
    cardUseLimits:
      playerState.cardUseLimits && typeof playerState.cardUseLimits === 'object' && !Array.isArray(playerState.cardUseLimits)
        ? Object.fromEntries(
            Object.entries(playerState.cardUseLimits).map(([k, v]) => [String(k), Math.max(0, Math.round(Number(v)))])
          )
        : {},
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
    moneyPerSecond: Number(playerState.moneyPerSecond || 0),
    heroAttackCooldown: Math.max(0, Number(playerState.heroAttackCooldown || 0)),
    heroAttackEventId: Math.max(0, Math.round(Number(playerState.heroAttackEventId || 0))),
    heroAttackEvent:
      playerState.heroAttackEvent && typeof playerState.heroAttackEvent === 'object' && !Array.isArray(playerState.heroAttackEvent)
        ? {
            id: Math.max(0, Math.round(Number(playerState.heroAttackEvent.id || 0))),
            animation: String(playerState.heroAttackEvent.animation || 'attack'),
            targetUnitId: String(playerState.heroAttackEvent.targetUnitId || ''),
            damage: Math.max(0, Math.round(Number(playerState.heroAttackEvent.damage || 0))),
            damageType: playerState.heroAttackEvent.damageType === 'spirit' ? 'spirit' : 'physical'
          }
        : null
  });
}

function normalizeBattleUnitState(unit = {}) {
  const animationEvent = normalizeAnimationEvent(unit.animationEvent);
  return {
    id: String(unit.id),
    cardId: String(unit.cardId),
    name: String(unit.name || ''),
    nameZhHant: String(unit.nameZhHant || unit.name || ''),
    nameEn: String(unit.nameEn || unit.name || ''),
    nameJa: String(unit.nameJa || unit.name || ''),
    imageUrl: unit.imageUrl || null,
    characterImageUrl: unit.characterImageUrl || unit.imageUrl || null,
    characterFrontImageUrl:
      unit.characterFrontImageUrl ||
      unit.characterImageUrl ||
      unit.imageUrl ||
      null,
    characterBackImageUrl: unit.characterBackImageUrl || null,
    characterLeftImageUrl: unit.characterLeftImageUrl || null,
    characterRightImageUrl: unit.characterRightImageUrl || null,
    characterAssets: Array.isArray(unit.characterAssets)
      ? unit.characterAssets
      : [],
    facingDirection: ['forward', 'front', 'back', 'left', 'right'].includes(
      unit.facingDirection
    )
      ? unit.facingDirection
      : 'forward',
    animationState: ['idle', 'move', 'attack'].includes(unit.animationState)
      ? unit.animationState
      : 'move',
    animationEvent,
    animationEventId: Math.max(
      0,
      Math.round(Number(unit.animationEventId || animationEvent?.id || 0))
    ),
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
    degenerationPerSecond: Number(unit.degenerationPerSecond || 0),
    targetRule: String(unit.targetRule || 'ground'),
    cooldown: Number(unit.cooldown || 0),
    effects: Array.isArray(unit.effects) ? unit.effects.map(String) : [],
    statusEffects: Array.isArray(unit.statusEffects)
      ? unit.statusEffects
          .filter((e) => e && Number(e.remainingMs) > 0)
          .map((e) => ({ kind: String(e.kind), remainingMs: Number(e.remainingMs) }))
      : [],
    procChances:
      unit.procChances && typeof unit.procChances === 'object' && !Array.isArray(unit.procChances)
        ? Object.fromEntries(
            Object.entries(unit.procChances).map(([k, v]) => [k, Number(v)])
          )
        : undefined
  };
}

function normalizeFieldState(fs) {
  if (!fs || typeof fs !== 'object') return null;
  return {
    nextEventMs: Math.max(0, Number(fs.nextEventMs || 0)),
    activeEffects: Array.isArray(fs.activeEffects)
      ? fs.activeEffects
        .filter((e) => e && Number(e.remainingMs) > 0)
        .map((e) => ({
          kind: String(e.kind),
          remainingMs: Number(e.remainingMs),
          value: Number(e.value || 0),
          scope: String(e.scope || 'both'),
          side: e.side ? String(e.side) : null,
        }))
      : [],
    shields: {
      left: Boolean(fs.shields?.left),
      right: Boolean(fs.shields?.right),
    },
  };
}

export function normalizeHostBattleState(previousBattle, state) {
  return clone({
    timeRemainingMs: Math.max(0, Number(state.timeRemainingMs || 0)),
    startedAt: previousBattle?.startedAt || new Date().toISOString(),
    nextUnitId: Number(state.nextUnitId || previousBattle?.nextUnitId || 1),
    result: state.result ?? null,
    cardMentalBonus:
      state.cardMentalBonus && typeof state.cardMentalBonus === 'object' && !Array.isArray(state.cardMentalBonus)
        ? Object.fromEntries(
            Object.entries(state.cardMentalBonus).map(([k, v]) => [k, Number(v)])
          )
        : previousBattle?.cardMentalBonus ?? {},
    players: {
      left: normalizeBattlePlayerState(state.players?.left),
      right: normalizeBattlePlayerState(state.players?.right)
    },
    units: Array.isArray(state.units) ? state.units.map(normalizeBattleUnitState) : [],
    events: Array.isArray(state.events) ? state.events.map(normalizeBattleEventState) : [],
    fieldState: normalizeFieldState(state.fieldState) ?? previousBattle?.fieldState ?? initFieldState()
  });
}
