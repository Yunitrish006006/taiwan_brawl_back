import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBattleSnapshot,
  buildPlayerSnapshot,
  createBattleState,
  normalizeHostBattleState
} from '../src/royale/royale_room_state.js';
import {
  DEFAULT_ARENA_ID,
  DOUBLE_BRIDGE_ARENA_ID,
  TRIPLE_BRIDGE_ARENA_ID
} from '../src/royale/royale_battle_rules.js';

test('createBattleState seeds hand, queue, and bot think time', () => {
  const battle = createBattleState({
    left: {
      deckCardIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      isBot: false
    },
    right: {
      deckCardIds: ['g', 'h', 'i', 'j', 'k', 'l'],
      isBot: true
    }
  });

  assert.deepEqual(battle.players.left.hand, ['a', 'b', 'c', 'd']);
  assert.deepEqual(battle.players.left.queue, ['e', 'f']);
  assert.equal(battle.players.left.botThinkMs, 0);
  assert.deepEqual(battle.players.right.hand, ['g', 'h', 'i', 'j']);
  assert.deepEqual(battle.players.right.queue, ['k', 'l']);
  assert.ok(battle.players.right.botThinkMs > 0);
});

test('createBattleState randomly selects an arena for new battles', () => {
  const players = {
    left: {
      deckCardIds: ['a', 'b', 'c', 'd'],
      isBot: false
    },
    right: {
      deckCardIds: ['e', 'f', 'g', 'h'],
      isBot: false
    }
  };

  assert.equal(
    createBattleState(players, { random: () => 0 }).arena.id,
    DEFAULT_ARENA_ID
  );
  assert.equal(
    createBattleState(players, { random: () => 0.25 }).arena.id,
    DOUBLE_BRIDGE_ARENA_ID
  );
  assert.equal(
    createBattleState(players, { random: () => 0.99 }).arena.id,
    TRIPLE_BRIDGE_ARENA_ID
  );
});

test('build snapshots include battle state for host viewers', () => {
  const player = {
    userId: 1,
    name: 'Alice',
    side: 'left',
    deckId: 10,
    deckName: 'Starter',
    deckCardIds: ['knight', 'archer', 'zap', 'giant', 'wolf'],
    deckCards: [
      { id: 'knight', name: 'Knight' },
      { id: 'archer', name: 'Archer' },
      { id: 'zap', name: 'Zap' },
      { id: 'giant', name: 'Giant' },
      { id: 'wolf', name: 'Wolf' }
    ],
    ready: true,
    connected: true,
    isBot: false
  };
  const battlePlayer = {
    physicalEnergy: 4.5,
    maxPhysicalEnergy: 5,
    spiritEnergy: 3,
    maxSpiritEnergy: 4,
    hand: ['archer', 'knight'],
    queue: ['zap', 'giant', 'wolf'],
    towerHp: 950,
    maxTowerHp: 1000
  };
  const room = {
    battle: {
      timeRemainingMs: 12345,
      result: null,
      units: []
    }
  };

  const snapshot = buildPlayerSnapshot(player, battlePlayer, true);
  const battleSnapshot = buildBattleSnapshot(room, player, battlePlayer);

  assert.equal(snapshot.physicalEnergy, 4.5);
  assert.equal(snapshot.spiritEnergy, 3);
  assert.deepEqual(snapshot.handCardIds, ['archer', 'knight']);
  assert.equal(snapshot.towerHp, 950);
  assert.equal(battleSnapshot.yourHand[0].id, 'archer');
  assert.equal(battleSnapshot.nextCardId, 'zap');
});

test('normalizeHostBattleState preserves previous startedAt and normalizes units', () => {
  const previousBattle = {
    startedAt: '2026-01-01T00:00:00.000Z',
    nextUnitId: 9
  };
  const state = {
    timeRemainingMs: 25000,
    players: {
      left: {
        physicalEnergy: 4.5,
        maxPhysicalEnergy: 5,
        hand: ['knight'],
        queue: ['archer'],
        towerHp: 900
      },
      right: {
        physicalEnergy: 3.25,
        maxPhysicalEnergy: 5,
        hand: ['giant'],
        queue: [],
        towerHp: 870
      }
    },
    units: [
      {
        id: 1,
        cardId: 'knight',
        name: 'Knight',
        type: 'melee',
        side: 'left',
        progress: 100,
        lateralPosition: 500,
        hp: 250,
        maxHp: 300,
        damage: 40,
        attackRange: 30
      }
    ]
  };

  const normalized = normalizeHostBattleState(previousBattle, state);

  assert.equal(normalized.startedAt, previousBattle.startedAt);
  assert.equal(normalized.nextUnitId, previousBattle.nextUnitId);
  assert.equal(normalized.players.left.hand[0], 'knight');
  assert.equal(normalized.units[0].id, '1');
  assert.equal(normalized.units[0].side, 'left');
  assert.ok(normalized.units[0].bodyRadius > 0);
});
