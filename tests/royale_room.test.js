import test from 'node:test';
import assert from 'node:assert/strict';

import { RoyaleRoom } from '../src/royale/royale_room.js';
import { starterCards } from '../src/royale/royale_cards.js';

function createStateStub() {
  const storageData = new Map();
  return {
    storageData,
    storage: {
      async get(key) {
        return storageData.get(key);
      },
      async put(key, value) {
        storageData.set(key, value);
      }
    }
  };
}

function sampleDeck() {
  const cardsById = new Map(starterCards.map((card) => [card.id, card]));
  return {
    id: 1,
    name: 'Starter Deck',
    cards: [
      'knight',
      'archer',
      'guardian',
      'fireball',
      'zap',
      'giant',
      'wolf_pack',
      'healer'
    ].map((id) => ({ ...(cardsById.get(id) ?? { id }) }))
  };
}

test('enqueueMutation serializes asynchronous room mutations', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;
  const order = [];

  const first = room.enqueueMutation(async () => {
    order.push('first:start');
    await Promise.resolve();
    order.push('first:end');
  });
  const second = room.enqueueMutation(async () => {
    order.push('second');
  });

  await Promise.all([first, second]);

  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
});

test('handleCreate forces bot rooms into host simulation mode', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  const response = await room.handleCreate(
    new Request('https://royale-room/internal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'ABC123',
        user: { id: 7, name: 'Host User' },
        deck: sampleDeck(),
        heroId: 'low_income_household',
        vsBot: true,
        botController: 'llm',
        simulationMode: 'server'
      })
    })
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.room.simulationMode, 'host');
  assert.ok(payload.room.arena?.id);
  assert.equal(state.storageData.get('room').simulationMode, 'host');
  assert.equal(state.storageData.get('room').arena.id, payload.room.arena.id);
  assert.equal(state.storageData.get('room').players.left.heroId, 'low_income_household');
  assert.equal(state.storageData.get('room').players.right.heroId, 'low_income_household');
  assert.equal(state.storageData.get('room').players.right.botController, 'llm');
  assert.equal(state.storageData.get('room').players.right.name, 'LLM Bot');
});

test('human rooms wait until both ready players are connected before starting', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  await room.handleCreate(
    new Request('https://royale-room/internal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'ABC123',
        user: { id: 1, name: 'Left Player' },
        deck: sampleDeck(),
        heroId: 'low_income_household',
        vsBot: false,
        simulationMode: 'server'
      })
    })
  );
  await room.handleJoin(
    new Request('https://royale-room/internal/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: { id: 2, name: 'Right Player' },
        deck: sampleDeck(),
        heroId: 'low_income_household'
      })
    })
  );

  room.room.players.left.connected = true;

  assert.equal(await room.markPlayerReady(1), true);
  assert.equal(await room.markPlayerReady(2), true);
  assert.equal(room.room.status, 'lobby');
  assert.equal(room.room.battle, null);

  room.room.players.right.connected = true;

  const pendingArenaId = room.room.arena.id;
  assert.equal(await room.startBattleIfReady(), true);
  assert.equal(room.room.status, 'battle');
  assert.ok(room.room.battle);
  assert.equal(room.room.battle.arena.id, pendingArenaId);
  room.stopTicking();
});

test('host bot rooms can start after the human player is ready', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  await room.handleCreate(
    new Request('https://royale-room/internal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'BOT123',
        user: { id: 7, name: 'Host User' },
        deck: sampleDeck(),
        heroId: 'low_income_household',
        vsBot: true,
        botController: 'heuristic',
        simulationMode: 'server'
      })
    })
  );

  assert.equal(room.room.players.left.connected, false);
  assert.equal(await room.markPlayerReady(7), true);
  assert.equal(room.room.status, 'battle');
  assert.ok(room.room.battle);
});

test('handlePlayCombo spreads multiple unit cards across distinct lateral lanes', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  try {
    await room.initialized;

    await room.handleCreate(
      new Request('https://royale-room/internal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'LANE12',
          user: { id: 1, name: 'Left Player' },
          deck: sampleDeck(),
          heroId: 'low_income_household',
          vsBot: false,
          simulationMode: 'server'
        })
      })
    );
    await room.handleJoin(
      new Request('https://royale-room/internal/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: { id: 2, name: 'Right Player' },
          deck: sampleDeck(),
          heroId: 'low_income_household'
        })
      })
    );

    room.room.players.left.connected = true;
    room.room.players.right.connected = true;
    await room.markPlayerReady(1);
    await room.markPlayerReady(2);
    assert.equal(room.room.status, 'battle');
    room.room.battle.players.left.physicalEnergy = 10;
    room.room.battle.players.left.maxPhysicalEnergy = 10;

    await room.handlePlayCombo(1, {
      cardIds: ['knight', 'archer', 'guardian'],
      dropX: 0.5,
      dropY: 0.75
    });

    const alliedUnits = room.room.battle.units.filter((unit) => unit.side === 'left');
    assert.equal(alliedUnits.length, 3);
    const lateralPositions = alliedUnits
      .map((unit) => unit.lateralPosition)
      .sort((a, b) => a - b);
    assert.ok(lateralPositions[0] < lateralPositions[1]);
    assert.ok(lateralPositions[1] < lateralPositions[2]);
  } finally {
    room.stopTicking();
  }
});
