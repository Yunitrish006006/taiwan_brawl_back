import test from 'node:test';
import assert from 'node:assert/strict';

import { RoyaleRoom } from '../src/royale_room.js';

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
  return {
    id: 1,
    name: 'Starter Deck',
    cards: [
      { id: 'knight' },
      { id: 'archer' },
      { id: 'guardian' },
      { id: 'fireball' },
      { id: 'zap' },
      { id: 'giant' },
      { id: 'wolf_pack' },
      { id: 'healer' }
    ]
  };
}

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
  assert.equal(state.storageData.get('room').simulationMode, 'host');
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

  assert.equal(await room.startBattleIfReady(), true);
  assert.equal(room.room.status, 'battle');
  assert.ok(room.room.battle);
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
