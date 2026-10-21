import test from 'node:test';
import assert from 'node:assert/strict';

import { RoyaleRoom } from '../src/royale/royale_room.js';
import { starterCards } from '../src/royale/royale_cards.js';
import { ROYALE_GAME_CONTRACT } from '../src/royale/royale_compatibility.js';

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

test('legacy persisted rooms migrate to the bundled gameplay contract', async () => {
  const state = createStateStub();
  state.storageData.set('room', { code: 'OLDROOM', status: 'lobby', players: {} });
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  assert.equal(room.room.gameContract.gameplayContentDigest, 'builtin-royale-rules-v1');
  assert.equal(room.room.gameplayRules.rulesetId, 'mini-royale-ranked');
  assert.equal(room.room.gameplayRules.rulesetVersion, 1);
});

test('legacy persisted protocol contracts expose an explicit exact range to joiners', async () => {
  const state = createStateStub();
  state.storageData.set('room', {
    code: 'OLDRANGE',
    status: 'lobby',
    players: {},
    gameContract: {
      gameId: ROYALE_GAME_CONTRACT.gameId,
      moduleVersion: ROYALE_GAME_CONTRACT.moduleVersion,
      protocolVersion: ROYALE_GAME_CONTRACT.protocolVersion,
      rulesetId: ROYALE_GAME_CONTRACT.rulesetId,
      rulesetVersion: ROYALE_GAME_CONTRACT.rulesetVersion,
      gameplayContentDigest: ROYALE_GAME_CONTRACT.gameplayContentDigest,
    },
  });
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  assert.equal(room.room.gameContract.compatibleProtocolRange, '>=1 <2');
  const compatible = await room.handleJoin(new Request(
    'https://royale-room/internal/join',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: { id: 2, name: 'Compatible legacy client' },
        deck: sampleDeck(),
        gameContract: {
          ...room.room.gameContract,
          compatibleProtocolRange: undefined,
        },
      }),
    },
  ));
  assert.equal(compatible.status, 200);

  const incompatible = await room.handleJoin(new Request(
    'https://royale-room/internal/join',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: { id: 3, name: 'Incompatible client' },
        deck: sampleDeck(),
        gameContract: {
          ...room.room.gameContract,
          protocolVersion: 2,
          compatibleProtocolRange: '>=2 <3',
        },
      }),
    },
  ));
  assert.equal(incompatible.status, 409);
  const payload = await incompatible.json();
  assert.equal(payload.error, 'GAME_VERSION_INCOMPATIBLE');
  assert.equal(payload.required.compatibleProtocolRange, '>=1 <2');
  assert.equal(Object.keys(room.room.players).length, 1);
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
        simulationMode: 'server',
        gameContract: ROYALE_GAME_CONTRACT
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

test('room creation rejects protocols outside server support without persisting a room', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;
  const response = await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'UNSUPPORTED',
      user: { id: 1, name: 'Host' },
      deck: sampleDeck(),
      vsBot: false,
      simulationMode: 'server',
      gameContract: {
        ...ROYALE_GAME_CONTRACT,
        protocolVersion: 2,
        compatibleProtocolRange: '>=2 <3',
      },
    }),
  }));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'GAME_VERSION_INCOMPATIBLE');
  assert.equal(room.room, undefined);
  assert.equal(state.storageData.has('room'), false);
});

test('room creator cannot widen the server protocol range for later admission', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;
  const creatorContract = {
    ...ROYALE_GAME_CONTRACT,
    moduleVersion: '0.2.0',
    compatibleProtocolRange: '>=1 <99',
  };
  const created = await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'RANGEPIN',
      user: { id: 1, name: 'Host' },
      deck: sampleDeck(),
      vsBot: false,
      simulationMode: 'server',
      gameContract: creatorContract,
    }),
  }));
  assert.equal(created.status, 200);
  assert.equal(room.room.gameContract.moduleVersion, ROYALE_GAME_CONTRACT.moduleVersion);
  assert.equal(room.room.gameContract.compatibleProtocolRange, ROYALE_GAME_CONTRACT.compatibleProtocolRange);

  const joined = await room.handleJoin(new Request('https://royale-room/internal/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: { id: 2, name: 'Future protocol' },
      deck: sampleDeck(),
      gameContract: {
        ...creatorContract,
        protocolVersion: 2,
      },
    }),
  }));
  assert.equal(joined.status, 409);
  assert.equal((await joined.json()).error, 'GAME_VERSION_INCOMPATIBLE');
  assert.equal(Object.keys(room.room.players).length, 1);
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
        simulationMode: 'server',
        gameContract: ROYALE_GAME_CONTRACT
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
        heroId: 'low_income_household',
        gameContract: { gameId: 'game.mini-royale', moduleVersion: '0.1.0', protocolVersion: 1, rulesetId: 'mini-royale-ranked', rulesetVersion: 1, gameplayContentDigest: 'builtin-royale-rules-v1' }
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

test('room admission rejects missing or incompatible contracts before persisting membership', async () => {
  const invalidContracts = [
    ['missing contract', undefined],
    ['wrong game', { gameId: 'game.archery' }],
    ['malformed module version', { moduleVersion: 'not-semver' }],
    ['wrong protocol', { protocolVersion: 2 }],
    ['wrong ruleset', { rulesetId: 'mini-royale-casual' }],
    ['wrong ruleset version', { rulesetVersion: 2 }],
    ['different gameplay digest', { gameplayContentDigest: 'a'.repeat(64) }],
  ];

  for (const [label, override] of invalidContracts) {
    const state = createStateStub();
    const room = new RoyaleRoom(state, {});
    await room.initialized;
    await room.handleCreate(new Request('https://royale-room/internal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'VERSION', user: { id: 1, name: 'Host' }, deck: sampleDeck(),
        vsBot: false, simulationMode: 'server', gameContract: ROYALE_GAME_CONTRACT,
      }),
    }));
    const persistedBeforeJoin = [...state.storageData.entries()];
    const clientContract = override === undefined
      ? undefined
      : {
          gameId: 'game.mini-royale',
          moduleVersion: '0.1.0',
          protocolVersion: 1,
          rulesetId: 'mini-royale-ranked',
          rulesetVersion: 1,
          gameplayContentDigest: 'builtin-royale-rules-v1',
          ...override,
        };
    const joinPayload = {
      user: { id: 2, name: `Incompatible: ${label}` },
      deck: sampleDeck(),
      ...(clientContract == null ? {} : { gameContract: clientContract }),
    };
    const response = await room.handleJoin(new Request('https://royale-room/internal/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(joinPayload),
    }));

    const payload = await response.json();
    assert.equal(response.status, 409, label);
    assert.equal(payload.error, 'GAME_VERSION_INCOMPATIBLE', label);
    assert.equal(payload.required.gameplayContentDigest, 'builtin-royale-rules-v1');
    assert.equal(Object.keys(room.room.players).length, 1, label);
    assert.deepEqual([...state.storageData.entries()], persistedBeforeJoin, label);
  }
});

test('room admission accepts a different package version with the same compatible game contract', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;
  await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'PACKAGEVER',
      user: { id: 1, name: 'Host' },
      deck: sampleDeck(),
      vsBot: false,
      simulationMode: 'server',
      gameContract: ROYALE_GAME_CONTRACT,
    }),
  }));

  const response = await room.handleJoin(new Request('https://royale-room/internal/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: { id: 2, name: 'Compatible package version' },
      deck: sampleDeck(),
      gameContract: { ...ROYALE_GAME_CONTRACT, moduleVersion: '0.2.0' },
    }),
  }));

  assert.equal(response.status, 200);
  assert.equal(room.room.gameContract.moduleVersion, ROYALE_GAME_CONTRACT.moduleVersion);
  assert.equal(Object.keys(room.room.players).length, 2);
});

test('room admission rechecks compatibility before allowing an existing player to reconnect', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;
  await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'RECONNECT', user: { id: 1, name: 'Host' }, deck: sampleDeck(),
      vsBot: false, simulationMode: 'server', gameContract: ROYALE_GAME_CONTRACT,
    }),
  }));

  const join = (digest) => room.handleJoin(new Request('https://royale-room/internal/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: { id: 2, name: 'Guest' },
      deck: sampleDeck(),
      gameContract: {
        ...ROYALE_GAME_CONTRACT,
        gameplayContentDigest: digest,
      },
    }),
  }));

  assert.equal((await join(ROYALE_GAME_CONTRACT.gameplayContentDigest)).status, 200);
  const persistedBeforeReconnect = [...state.storageData.entries()];
  const response = await join('a'.repeat(64));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'GAME_VERSION_INCOMPATIBLE');
  assert.deepEqual([...state.storageData.entries()], persistedBeforeReconnect);
  assert.equal(Object.keys(room.room.players).length, 2);
});

test('room WebSocket reconnect rejects missing or changed contracts before upgrade', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;
  await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'SOCKET1', user: { id: 1, name: 'Host' }, deck: sampleDeck(),
      vsBot: false, simulationMode: 'server', gameContract: ROYALE_GAME_CONTRACT,
    }),
  }));

  for (const candidate of [null, { ...ROYALE_GAME_CONTRACT, protocolVersion: 2 }]) {
    const url = new URL('https://royale-room/internal/ws');
    if (candidate) url.searchParams.set('gameContract', JSON.stringify(candidate));
    const response = await room.handleWebSocket(new Request(url, {
      headers: { 'x-user-id': '1', Upgrade: 'websocket' },
    }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'GAME_VERSION_INCOMPATIBLE');
    assert.equal(room.sockets.size, 0);
  }
});

test('room creation rejects gameplay packs the server cannot simulate', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;
  const hostContract = {
    gameId: 'game.mini-royale',
    moduleVersion: '0.1.0',
    protocolVersion: 1,
    rulesetId: 'mini-royale-ranked',
    rulesetVersion: 1,
    gameplayContentDigest: 'a'.repeat(64),
  };
  const response = await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'PACK01', user: { id: 1, name: 'Host' }, deck: sampleDeck(),
      vsBot: false, simulationMode: 'server', gameContract: hostContract,
    }),
  }));

  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, 'GAME_VERSION_INCOMPATIBLE');
  assert.match(body.detail, /Unknown gameplay digest/);
  assert.equal(body.required.gameplayContentDigest, 'builtin-royale-rules-v1');
  assert.equal(body.retryable, false);
  assert.equal(room.room, undefined);
});

test('room creation rejects malformed gameplay contracts', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  const response = await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'BAD001', user: { id: 1, name: 'Host' }, deck: sampleDeck(),
      gameContract: { gameId: 'game.mini-royale', gameplayContentDigest: 'x' },
    }),
  }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_GAME_CONTRACT');
  assert.equal(room.room, undefined);
});

test('room creation rejects a missing gameplay contract instead of assuming the current version', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  const response = await room.handleCreate(new Request('https://royale-room/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'OLD001', user: { id: 1, name: 'Old client' }, deck: sampleDeck(),
      vsBot: false, simulationMode: 'server',
    }),
  }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_GAME_CONTRACT');
  assert.equal(room.room, undefined);
  assert.equal(state.storageData.has('room'), false);
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
        simulationMode: 'server',
        gameContract: ROYALE_GAME_CONTRACT
      })
    })
  );

  assert.equal(room.room.players.left.connected, false);
  assert.equal(await room.markPlayerReady(7), true);
  assert.equal(room.room.status, 'battle');
  assert.ok(room.room.battle);
});

test('handleDiscardCard spends spirit energy and rotates the selected hand card', async () => {
  const state = createStateStub();
  const room = new RoyaleRoom(state, {});
  await room.initialized;

  await room.handleCreate(
    new Request('https://royale-room/internal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'DIS123',
        user: { id: 7, name: 'Host User' },
        deck: sampleDeck(),
        heroId: 'low_income_household',
        vsBot: true,
        botController: 'heuristic',
        simulationMode: 'server',
        gameContract: ROYALE_GAME_CONTRACT
      })
    })
  );

  await room.markPlayerReady(7);
  assert.equal(room.room.status, 'battle');
  const battlePlayer = room.room.battle.players.left;
  battlePlayer.spiritEnergy = 1.5;
  battlePlayer.hand = ['knight', 'archer', 'guardian', 'fireball'];
  battlePlayer.queue = ['zap', 'giant'];

  await room.handleDiscardCard(7, { cardId: 'archer' });

  assert.equal(battlePlayer.spiritEnergy, 0.5);
  assert.deepEqual(battlePlayer.hand, ['knight', 'guardian', 'fireball', 'zap']);
  assert.deepEqual(battlePlayer.queue, ['giant', 'archer']);
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
          simulationMode: 'server',
          gameContract: ROYALE_GAME_CONTRACT
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
          heroId: 'low_income_household',
          gameContract: { gameId: 'game.mini-royale', moduleVersion: '0.1.0', protocolVersion: 1, rulesetId: 'mini-royale-ranked', rulesetVersion: 1, gameplayContentDigest: 'builtin-royale-rules-v1' }
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
