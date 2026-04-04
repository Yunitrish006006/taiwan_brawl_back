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
        vsBot: true,
        simulationMode: 'server'
      })
    })
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.room.simulationMode, 'host');
  assert.equal(state.storageData.get('room').simulationMode, 'host');
});
