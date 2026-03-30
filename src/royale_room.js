import { recordMatchHistory } from './royale_repository.js';

const TICK_MS = 100;
const MATCH_DURATION_MS = 210000;
const WORLD_SCALE = 1000;
const MAX_ELIXIR = 10;
const ELIXIR_PER_SECOND = 0.8;
const LEFT_TOWER_X = 50;
const RIGHT_TOWER_X = 950;
const LEFT_DEPLOY_MAX = 420;
const RIGHT_DEPLOY_MIN = 580;
const TOWER_HP = 3000;
const DISCONNECT_GRACE_MS = 15000;
const PERSIST_INTERVAL_MS = 1000;
const MAX_COMBO_CARDS = 3;
const LATERAL_MIN = 120;
const LATERAL_MAX = 880;
const BOT_MIN_THINK_MS = 950;
const BOT_MAX_THINK_MS = 1800;
const GLOBAL_MOVE_SPEED_MULTIPLIER = 0.58;
const GLOBAL_ATTACK_SPEED_MULTIPLIER = 1.18;
const FIELD_ASPECT_RATIO = 0.62;
const TOWER_BODY_RADIUS = 30;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toWorldInteger(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.abs(value) <= 1 ? Math.round(value * WORLD_SCALE) : Math.round(value);
}

function toNormalizedWorld(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.abs(value) <= 1 ? value : value / WORLD_SCALE;
}

function sideDirection(side) {
  return side === 'left' ? 1 : -1;
}

function deployRangeForSide(side) {
  return side === 'left' ? [80, LEFT_DEPLOY_MAX] : [RIGHT_DEPLOY_MIN, 920];
}

function sanitizeLanePosition(side, value) {
  const [min, max] = deployRangeForSide(side);
  if (!Number.isFinite(value)) {
    return (min + max) / 2;
  }
  return clamp(value, min, max);
}

function sanitizeLateralPosition(value) {
  if (!Number.isFinite(value)) {
    return WORLD_SCALE / 2;
  }
  return clamp(value, LATERAL_MIN, LATERAL_MAX);
}

function toWorldProgress(side, viewY) {
  const normalizedY = clamp(toNormalizedWorld(viewY), 0, 1);
  const worldY = Math.round(normalizedY * WORLD_SCALE);
  return side === 'left' ? WORLD_SCALE - worldY : worldY;
}

function normalizeDropPoint(side, payload) {
  const hasExactPoint =
    Number.isFinite(Number(payload?.dropX)) &&
    Number.isFinite(Number(payload?.dropY));

  if (!hasExactPoint) {
    return {
      progress: sanitizeLanePosition(side, toWorldInteger(Number(payload?.lanePosition))),
      lateralPosition: WORLD_SCALE / 2
    };
  }

  return {
    progress: sanitizeLanePosition(side, toWorldProgress(side, Number(payload.dropY))),
    lateralPosition: sanitizeLateralPosition(toWorldInteger(Number(payload.dropX)))
  };
}

function distanceBetweenPoints(aProgress, aLateral, bProgress, bLateral) {
  return Math.hypot(
    aProgress - bProgress,
    (aLateral - bLateral) * FIELD_ASPECT_RATIO
  );
}

function bodyRadiusForUnitType(type) {
  switch (type) {
    case 'tank':
      return 24;
    case 'melee':
      return 18;
    case 'swarm':
      return 14;
    case 'ranged':
      return 16;
    default:
      return 18;
  }
}

function displayAttackReach(unit) {
  return Number(unit.attackRange || 0) + Number(unit.bodyRadius || bodyRadiusForUnitType(unit.type));
}

function effectiveAttackReachToUnit(unit, target) {
  return displayAttackReach(unit) + Number(target.bodyRadius || bodyRadiusForUnitType(target.type));
}

function effectiveAttackReachToTower(unit) {
  return displayAttackReach(unit) + TOWER_BODY_RADIUS;
}

function nowMs() {
  return Date.now();
}

function createBattleState(playersBySide) {
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

function normalizeSimulationMode(value) {
  return String(value ?? 'server').trim().toLowerCase() === 'host'
    ? 'host'
    : 'server';
}

function createPlayer(side, payload) {
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

function randomBotThinkMs() {
  return Math.floor(
    BOT_MIN_THINK_MS + Math.random() * (BOT_MAX_THINK_MS - BOT_MIN_THINK_MS)
  );
}

export class RoyaleRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    this.sockets = new Map();
    this.tickHandle = null;
    this.lastPersistedAt = 0;
    this.initialized = this.load();
  }

  async load() {
    this.room = await this.state.storage.get('room');
    if (this.room?.status === 'battle') {
      this.ensureTicking();
    }
  }

  async persist(force = false) {
    if (!this.room) {
      return;
    }

    const now = nowMs();
    if (!force && now - this.lastPersistedAt < PERSIST_INTERVAL_MS) {
      return;
    }

    await this.state.storage.put('room', clone(this.room));
    this.lastPersistedAt = now;
  }

  async fetch(request) {
    await this.initialized;
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    if (request.method === 'POST' && url.pathname === '/internal/create') {
      return this.handleCreate(request);
    }
    if (request.method === 'POST' && url.pathname === '/internal/join') {
      return this.handleJoin(request);
    }
    if (request.method === 'POST' && url.pathname === '/internal/ready') {
      return this.handleReady(request);
    }
    if (request.method === 'POST' && url.pathname === '/internal/rematch') {
      return this.handleRematch(request);
    }
    if (request.method === 'POST' && url.pathname === '/internal/host-finish') {
      return this.handleHostFinish(request);
    }
    if (request.method === 'GET' && url.pathname === '/internal/state') {
      return this.handleState(request);
    }

    return json({ error: 'Not Found' }, 404);
  }

  findPlayerByUserId(userId) {
    if (!this.room) {
      return null;
    }

    return Object.values(this.room.players).find(
      (player) => Number(player.userId) === Number(userId)
    );
  }

  viewerSnapshot(userId) {
    if (!this.room) {
      return null;
    }

    const viewer = this.findPlayerByUserId(userId);
    const battlePlayer = viewer && this.room.battle ? this.room.battle.players[viewer.side] : null;

    return {
      code: this.room.code,
      status: this.room.status,
      simulationMode: normalizeSimulationMode(this.room.simulationMode),
      viewerSide: viewer?.side ?? null,
      players: Object.values(this.room.players).map((player) => {
        const battleState = this.room.battle?.players[player.side];
        return {
          userId: player.userId,
          name: player.name,
          side: player.side,
          deckId: player.deckId,
          deckName: player.deckName,
          isBot: Boolean(player.isBot),
          ready: player.ready,
          connected: player.connected,
          towerHp: battleState?.towerHp ?? TOWER_HP,
          maxTowerHp: battleState?.maxTowerHp ?? TOWER_HP
        };
      }),
      battle: this.room.battle
        ? {
            timeRemainingMs: Math.max(0, Math.floor(this.room.battle.timeRemainingMs)),
            yourElixir: battlePlayer ? Number(battlePlayer.elixir.toFixed(1)) : 0,
            yourHand: battlePlayer
              ? battlePlayer.hand
                  .map((cardId) => viewer.deckCards.find((card) => card.id === cardId))
                  .filter(Boolean)
              : [],
            nextCardId: battlePlayer?.queue?.[0] ?? null,
            units: this.room.battle.units.map((unit) => ({
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
            })),
            result: this.room.battle.result
          }
        : null
    };
  }

  async broadcast(type, extra = {}) {
    if (!this.room) {
      return;
    }

    for (const [userId, socket] of this.sockets.entries()) {
      try {
        const payload = {
          type,
          room: this.viewerSnapshot(Number(userId)),
          ...extra
        };
        socket.send(JSON.stringify(payload));
      } catch (_) {
        socket.close(1011, 'broadcast failed');
        this.sockets.delete(userId);
      }
    }
  }

  async handleCreate(request) {
    const payload = await request.json();
    if (this.room) {
      return json({ error: 'Room already exists' }, 409);
    }

    this.room = {
      code: payload.code,
      status: 'lobby',
      simulationMode: normalizeSimulationMode(payload.simulationMode),
      createdAt: new Date().toISOString(),
      players: {
        left: createPlayer('left', payload)
      },
      battle: null
    };

    if (payload.vsBot) {
      this.room.players.right = createPlayer('right', {
        user: {
          id: 0,
          name: '基礎機器人',
          isBot: true
        },
        deck: payload.botDeck || payload.deck
      });
    }
    await this.persist(true);

    return json({ ok: true, room: this.viewerSnapshot(payload.user.id) });
  }

  async handleJoin(request) {
    const payload = await request.json();
    if (!this.room) {
      return json({ error: 'Room not found' }, 404);
    }

    const existing = this.findPlayerByUserId(payload.user.id);
    if (existing) {
      return json({ ok: true, room: this.viewerSnapshot(payload.user.id) });
    }

    if (Object.keys(this.room.players).length >= 2) {
      return json({ error: 'Room is full' }, 409);
    }

    this.room.players.right = createPlayer('right', payload);
    await this.persist(true);
    await this.broadcast('room_state');
    return json({ ok: true, room: this.viewerSnapshot(payload.user.id) });
  }

  async handleReady(request) {
    const payload = await request.json();
    const player = this.findPlayerByUserId(payload.userId);
    if (!player) {
      return json({ error: 'Player not found' }, 404);
    }

    if (!this.room || this.room.status === 'finished') {
      return json({ error: 'Match has ended, start a rematch first' }, 409);
    }

    player.ready = true;
    await this.persist(true);
    await this.broadcast('room_state');

    if (
      Object.keys(this.room.players).length === 2 &&
      Object.values(this.room.players).every((entry) => entry.ready)
    ) {
      this.startBattle();
      await this.broadcast('battle_started');
    }

    return json({ ok: true, room: this.viewerSnapshot(payload.userId) });
  }

  async handleRematch(request) {
    const payload = await request.json();
    const player = this.findPlayerByUserId(payload.userId);
    if (!player) {
      return json({ error: 'Player not found' }, 404);
    }
    if (!this.room) {
      return json({ error: 'Room not found' }, 404);
    }
    if (this.room.status !== 'finished') {
      return json({ error: 'Rematch is only available after the battle ends' }, 409);
    }

    this.resetRoomToLobby();
    await this.persist(true);
    await this.broadcast('room_state');
    return json({ ok: true, room: this.viewerSnapshot(payload.userId) });
  }

  async handleState(request) {
    const userId = Number(request.headers.get('x-user-id'));
    if (!this.room) {
      return json({ error: 'Room not found' }, 404);
    }

    return json({ ok: true, room: this.viewerSnapshot(userId) });
  }

  async handleHostFinish(request) {
    const payload = await request.json();
    const player = this.findPlayerByUserId(payload.userId);
    if (!player) {
      return json({ error: 'Player not found' }, 404);
    }
    if (!this.room) {
      return json({ error: 'Room not found' }, 404);
    }
    if (normalizeSimulationMode(this.room.simulationMode) !== 'host') {
      return json({ error: 'Host finish is only available in host simulation mode' }, 409);
    }
    if (this.room.status !== 'battle' || !this.room.battle) {
      return json({ error: 'Battle is not running' }, 409);
    }

    if (Number.isFinite(Number(payload.leftTowerHp))) {
      this.room.battle.players.left.towerHp = clamp(
        Number(payload.leftTowerHp),
        0,
        this.room.battle.players.left.maxTowerHp
      );
    }
    if (Number.isFinite(Number(payload.rightTowerHp))) {
      this.room.battle.players.right.towerHp = clamp(
        Number(payload.rightTowerHp),
        0,
        this.room.battle.players.right.maxTowerHp
      );
    }

    this.room.status = 'finished';
    this.room.battle.result = {
      winnerSide:
        payload.winnerSide === 'left' || payload.winnerSide === 'right'
          ? payload.winnerSide
          : null,
      reason: String(payload.reason ?? 'time_up')
    };

    await this.persist(true);
    await this.broadcast('match_result');
    return json({ ok: true, room: this.viewerSnapshot(payload.userId) });
  }

  async handleWebSocket(request) {
    const userId = Number(request.headers.get('x-user-id'));
    const player = this.findPlayerByUserId(userId);
    if (!player) {
      return new Response('Forbidden', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const existing = this.sockets.get(String(userId));
    if (existing) {
      existing.close(1012, 'replaced');
    }

    this.sockets.set(String(userId), server);
    player.connected = true;
    player.lastDisconnectedAt = null;
    void this.persist(true);

    server.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        void this.handleSocketMessage(userId, payload);
      } catch (_) {
        server.send(JSON.stringify({ type: 'error', message: 'Invalid socket payload' }));
      }
    });

    server.addEventListener('close', () => {
      this.handleSocketClose(userId);
    });

    server.send(JSON.stringify({ type: 'room_state', room: this.viewerSnapshot(userId) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSocketMessage(userId, payload) {
    if (payload?.type === 'ping') {
      const socket = this.sockets.get(String(userId));
      socket?.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (payload?.type === 'ready') {
      const player = this.findPlayerByUserId(userId);
      if (!player) {
        return;
      }
      player.ready = true;
      await this.persist(true);
      await this.broadcast('room_state');
      if (
        Object.keys(this.room.players).length === 2 &&
        Object.values(this.room.players).every((entry) => entry.ready)
      ) {
        this.startBattle();
        await this.broadcast('battle_started');
      }
      return;
    }

    if (payload?.type === 'play_card') {
      await this.handlePlayCombo(userId, {
        cardIds: [payload.cardId],
        lanePosition: payload.lanePosition,
        dropX: payload.dropX,
        dropY: payload.dropY
      });
      return;
    }

    if (payload?.type === 'play_combo') {
      await this.handlePlayCombo(userId, payload);
    }
  }

  handleSocketClose(userId) {
    const player = this.findPlayerByUserId(userId);
    this.sockets.delete(String(userId));
    if (!player) {
      return;
    }

    player.connected = false;
    player.lastDisconnectedAt = new Date().toISOString();
    void this.persist(true);
    void this.broadcast('room_state');
  }

  startBattle() {
    this.room.status = 'battle';
    this.room.battle = createBattleState(this.room.players);
    if (normalizeSimulationMode(this.room.simulationMode) === 'server') {
      this.ensureTicking();
    }
    void this.persist(true);
  }

  resetRoomToLobby() {
    this.stopTicking();
    this.room.status = 'lobby';
    this.room.battle = null;
    for (const player of Object.values(this.room.players)) {
      player.ready = Boolean(player.isBot);
      player.connected = Boolean(player.isBot) || player.connected;
    }
  }

  buildBotPayload(side, battlePlayer, comboCards) {
    const enemyUnits = this.room.battle.units.filter(
      (unit) => unit.side !== side && unit.hp > 0
    );
    const averageEnemyLateral = enemyUnits.length
      ? enemyUnits.reduce((sum, unit) => sum + unit.lateralPosition, 0) /
        enemyUnits.length
      : WORLD_SCALE / 2;
    const progress = sanitizeLanePosition(
      side,
      side === 'left' ? 260 + Math.random() * 80 : 660 + Math.random() * 80
    );
    const lateralPosition = sanitizeLateralPosition(
      averageEnemyLateral + (Math.random() - 0.5) * (140 / FIELD_ASPECT_RATIO)
    );
    const dropY = side === 'left' ? WORLD_SCALE - progress : progress;

    return {
      cardIds: comboCards.map((card) => card.id),
      lanePosition: progress,
      dropX: lateralPosition,
      dropY
    };
  }

  chooseBotCombo(player, battlePlayer) {
    const handCards = battlePlayer.hand
      .map((cardId) => player.deckCards.find((card) => card.id === cardId))
      .filter(Boolean);
    const affordable = handCards.filter(
      (card) => Number(card.elixirCost || 0) <= battlePlayer.elixir + 1e-6
    );
    if (affordable.length === 0) {
      return [];
    }

    const playableUnits = affordable.filter(
      (card) => card.type !== 'equipment' && card.type !== 'spell'
    );
    const playableSpells = affordable.filter((card) => card.type === 'spell');
    const playableEquipment = affordable.filter((card) => card.type === 'equipment');

    let primaryCard = null;
    if (playableUnits.length > 0) {
      primaryCard = playableUnits[Math.floor(Math.random() * playableUnits.length)];
    } else if (playableSpells.length > 0) {
      primaryCard = playableSpells[Math.floor(Math.random() * playableSpells.length)];
    }

    if (!primaryCard) {
      return [];
    }

    const comboCards = [primaryCard];
    if (
      primaryCard.type !== 'spell' &&
      playableEquipment.length > 0 &&
      Math.random() < 0.4
    ) {
      const candidate = playableEquipment.find(
        (card) =>
          Number(card.elixirCost || 0) + Number(primaryCard.elixirCost || 0) <=
          battlePlayer.elixir + 1e-6
      );
      if (candidate) {
        comboCards.push(candidate);
      }
    }

    return comboCards;
  }

  async runBotTurns() {
    for (const [side, player] of Object.entries(this.room.players)) {
      if (!player.isBot) {
        continue;
      }

      const battlePlayer = this.room.battle.players[side];
      battlePlayer.botThinkMs = Math.max(0, Number(battlePlayer.botThinkMs || 0) - TICK_MS);
      if (battlePlayer.botThinkMs > 0) {
        continue;
      }

      const comboCards = this.chooseBotCombo(player, battlePlayer);
      battlePlayer.botThinkMs = randomBotThinkMs();
      if (comboCards.length === 0) {
        continue;
      }

      await this.handlePlayCombo(player.userId, this.buildBotPayload(side, battlePlayer, comboCards));
    }
  }

  ensureTicking() {
    if (this.tickHandle) {
      return;
    }

    this.tickHandle = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  stopTicking() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  getComboCards(player, battlePlayer, cardIds, userId) {
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      this.sendError(userId, 'Select at least one card');
      return null;
    }

    if (cardIds.length > MAX_COMBO_CARDS) {
      this.sendError(userId, `You can cast at most ${MAX_COMBO_CARDS} cards`);
      return null;
    }

    const remainingHand = battlePlayer.hand.slice();
    const comboCards = [];

    for (const rawId of cardIds) {
      const cardId = String(rawId);
      const handIndex = remainingHand.findIndex((entry) => entry === cardId);
      if (handIndex === -1) {
        this.sendError(userId, 'One of the selected cards is not in hand');
        return null;
      }
      remainingHand.splice(handIndex, 1);

      const card = player.deckCards.find((entry) => entry.id === cardId);
      if (!card) {
        this.sendError(userId, 'Unknown card');
        return null;
      }
      comboCards.push(card);
    }

    return comboCards;
  }

  drawReplacementCards(battlePlayer, cardIds) {
    for (const cardId of cardIds) {
      const handIndex = battlePlayer.hand.findIndex((entry) => entry === cardId);
      if (handIndex === -1) {
        continue;
      }
      battlePlayer.hand.splice(handIndex, 1);
      battlePlayer.queue.push(cardId);
    }

    for (let index = 0; index < cardIds.length; index += 1) {
      const nextCardId = battlePlayer.queue.shift();
      if (nextCardId) {
        battlePlayer.hand.push(nextCardId);
      }
    }
  }

  equipmentEffects(cards) {
    return cards
      .filter((card) => card.type === 'equipment')
      .map((card) => ({
        id: card.id,
        name: card.name,
        kind: card.effectKind,
        value: Number(card.effectValue || 0)
      }));
  }

  applyEquipmentEffects(card, effects) {
    let hp = card.hp;
    let damage = card.damage;
    let moveSpeed = card.moveSpeed * GLOBAL_MOVE_SPEED_MULTIPLIER;

    for (const effect of effects) {
      if (effect.kind === 'damage_boost') {
        damage += effect.value;
      } else if (effect.kind === 'health_boost') {
        hp += effect.value;
      } else if (effect.kind === 'speed_boost') {
        moveSpeed *= 1 + effect.value;
      }
    }

    return {
      hp: Math.round(hp),
      damage: Math.round(damage),
      moveSpeed: Number(moveSpeed.toFixed(4))
    };
  }

  async handlePlayCombo(userId, payload) {
    if (!this.room?.battle || this.room.status !== 'battle') {
      return;
    }

    const player = this.findPlayerByUserId(userId);
    if (!player) {
      return;
    }

    const battlePlayer = this.room.battle.players[player.side];
    const cardIds = Array.isArray(payload?.cardIds)
      ? payload.cardIds.map(String)
      : [String(payload?.cardId || '')].filter((cardId) => cardId.length > 0);
    const comboCards = this.getComboCards(player, battlePlayer, cardIds, userId);
    if (!comboCards) {
      return;
    }

    const totalElixirCost = comboCards.reduce(
      (sum, card) => sum + Number(card.elixirCost || 0),
      0
    );
    if (battlePlayer.elixir + 1e-6 < totalElixirCost) {
      this.sendError(userId, 'Not enough elixir');
      return;
    }

    const equipmentCards = comboCards.filter((card) => card.type === 'equipment');
    const unitCards = comboCards.filter(
      (card) => card.type !== 'equipment' && card.type !== 'spell'
    );
    if (equipmentCards.length > 0 && unitCards.length === 0) {
      this.sendError(userId, 'Equipment cards need at least one unit in the same cast');
      return;
    }

    const dropPoint = normalizeDropPoint(player.side, payload);
    const equipmentEffects = this.equipmentEffects(comboCards);

    battlePlayer.elixir = clamp(
      battlePlayer.elixir - totalElixirCost,
      0,
      MAX_ELIXIR
    );
    this.drawReplacementCards(battlePlayer, comboCards.map((card) => card.id));

    for (const card of comboCards) {
      if (card.type === 'spell') {
        this.resolveSpell(player.side, card, dropPoint);
      } else if (card.type !== 'equipment') {
        this.spawnUnits(player.side, card, dropPoint, equipmentEffects);
      }
    }

    await this.broadcast('battle_event', {
      event: {
        type: 'combo_cast',
        side: player.side,
        cardIds: comboCards.map((card) => card.id),
        progress: dropPoint.progress,
        lateralPosition: dropPoint.lateralPosition,
        equipment: equipmentEffects.map((effect) => effect.name)
      }
    });

    await this.persist();
  }

  resolveSpell(side, card, dropPoint) {
    const enemySide = side === 'left' ? 'right' : 'left';
    const enemyBattleState = this.room.battle.players[enemySide];

    for (const unit of this.room.battle.units) {
      if (unit.side === side) {
        continue;
      }
      if (
        distanceBetweenPoints(
          unit.progress,
          unit.lateralPosition,
          dropPoint.progress,
          dropPoint.lateralPosition
        ) <= card.spellRadius
      ) {
        unit.hp -= card.spellDamage;
      }
    }

    const towerProgress = enemySide === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
    if (
      distanceBetweenPoints(
        towerProgress,
        WORLD_SCALE / 2,
        dropPoint.progress,
        dropPoint.lateralPosition
      ) <=
      card.spellRadius + 50
    ) {
      enemyBattleState.towerHp = Math.max(0, enemyBattleState.towerHp - card.spellDamage);
    }
  }

  spawnUnits(side, card, dropPoint, equipmentEffects = []) {
    const count = Math.max(1, card.spawnCount);
    const spacing = count === 1 ? 0 : 30 / FIELD_ASPECT_RATIO;
    const stats = this.applyEquipmentEffects(card, equipmentEffects);
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * spacing;
      this.room.battle.units.push({
        id: `unit-${this.room.battle.nextUnitId++}`,
        cardId: card.id,
        name: card.name,
        nameZhHant: card.nameZhHant || card.name,
        nameEn: card.nameEn || card.name,
        nameJa: card.nameJa || card.name,
        imageUrl: card.imageUrl || null,
        type: card.type,
        side,
        progress: dropPoint.progress,
        lateralPosition: sanitizeLateralPosition(dropPoint.lateralPosition + offset),
        hp: stats.hp,
        maxHp: stats.hp,
        damage: stats.damage,
        attackRange: Number(card.attackRange || 0),
        bodyRadius: Number(card.bodyRadius ?? bodyRadiusForUnitType(card.type)),
        moveSpeed: stats.moveSpeed,
        attackSpeed: (card.attackSpeed || 1) * GLOBAL_ATTACK_SPEED_MULTIPLIER,
        targetRule: card.targetRule,
        cooldown: 0,
        effects: equipmentEffects.map((effect) => effect.name)
      });
    }
  }

  getEnemySide(side) {
    return side === 'left' ? 'right' : 'left';
  }

  selectTarget(unit) {
    const direction = sideDirection(unit.side);
    const enemySide = this.getEnemySide(unit.side);
    const towerProgress = enemySide === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
    const towerForwardDistance = (towerProgress - unit.progress) * direction;
    const towerDistance = distanceBetweenPoints(
      unit.progress,
      unit.lateralPosition,
      towerProgress,
      WORLD_SCALE / 2
    );
    const towerReach = effectiveAttackReachToTower(unit);

    if (unit.targetRule === 'tower') {
      if (towerForwardDistance >= 0 && towerDistance <= towerReach) {
        return {
          kind: 'tower',
          target: enemySide,
          distance: towerDistance
        };
      }
      return null;
    }

    const enemyUnits = this.room.battle.units
      .filter((entry) => entry.side !== unit.side && entry.hp > 0)
      .map((entry) => ({
        kind: 'unit',
        target: entry,
        forwardDistance: (entry.progress - unit.progress) * direction,
        distance: distanceBetweenPoints(
          unit.progress,
          unit.lateralPosition,
          entry.progress,
          entry.lateralPosition
        )
      }))
      .filter((entry) => entry.forwardDistance >= -20);

    enemyUnits.sort((a, b) => a.distance - b.distance);
    const enemyUnit = enemyUnits[0];
    if (
      enemyUnit &&
      enemyUnit.distance <= effectiveAttackReachToUnit(unit, enemyUnit.target)
    ) {
      return enemyUnit;
    }

    if (towerForwardDistance >= 0 && towerDistance <= towerReach) {
      return {
        kind: 'tower',
        target: enemySide,
        distance: towerDistance
      };
    }

    return enemyUnit && enemyUnit.forwardDistance < 120 ? enemyUnit : null;
  }

  performAttack(unit, target) {
    if (target.kind === 'unit') {
      target.target.hp -= unit.damage;
      return;
    }

    const enemyBattleState = this.room.battle.players[target.target];
    enemyBattleState.towerHp = Math.max(0, enemyBattleState.towerHp - unit.damage);
  }

  async tick() {
    if (!this.room?.battle || this.room.status !== 'battle') {
      this.stopTicking();
      return;
    }

    const dt = TICK_MS / 1000;
    this.room.battle.timeRemainingMs -= TICK_MS;

    for (const side of Object.keys(this.room.battle.players)) {
      const battlePlayer = this.room.battle.players[side];
      battlePlayer.elixir = clamp(
        battlePlayer.elixir + ELIXIR_PER_SECOND * dt,
        0,
        MAX_ELIXIR
      );
    }

    await this.runBotTurns();

    for (const unit of this.room.battle.units) {
      if (unit.hp <= 0) {
        continue;
      }

      unit.cooldown = Math.max(0, unit.cooldown - dt);
      const target = this.selectTarget(unit);
      const attackReach =
        !target
          ? 0
          : target.kind === 'unit'
            ? effectiveAttackReachToUnit(unit, target.target)
            : effectiveAttackReachToTower(unit);
      if (target && target.distance <= attackReach) {
        if (unit.cooldown <= 0) {
          this.performAttack(unit, target);
          unit.cooldown = unit.attackSpeed;
        }
      } else {
        unit.progress = clamp(
          unit.progress + sideDirection(unit.side) * unit.moveSpeed * dt,
          80,
          920
        );
        const desiredLateral =
          target?.kind === 'unit' ? target.target.lateralPosition : WORLD_SCALE / 2;
        const lateralDelta = desiredLateral - unit.lateralPosition;
        const lateralStep =
          (unit.moveSpeed * 0.45 * dt) / FIELD_ASPECT_RATIO;
        unit.lateralPosition = sanitizeLateralPosition(
          unit.lateralPosition + clamp(lateralDelta, -lateralStep, lateralStep)
        );
      }
    }

    this.room.battle.units = this.room.battle.units.filter((unit) => unit.hp > 0);

    const leftTowerHp = this.room.battle.players.left?.towerHp ?? TOWER_HP;
    const rightTowerHp = this.room.battle.players.right?.towerHp ?? TOWER_HP;

    if (leftTowerHp <= 0 || rightTowerHp <= 0) {
      const winnerSide =
        leftTowerHp <= 0 && rightTowerHp <= 0
          ? null
          : leftTowerHp <= 0
            ? 'right'
            : 'left';
      await this.finishMatch(winnerSide, 'tower_destroyed');
      return;
    }

    for (const player of Object.values(this.room.players)) {
      if (!player.connected && player.lastDisconnectedAt) {
        const elapsed = nowMs() - new Date(player.lastDisconnectedAt).getTime();
        if (elapsed >= DISCONNECT_GRACE_MS) {
          await this.finishMatch(this.getEnemySide(player.side), 'disconnect');
          return;
        }
      }
    }

    if (this.room.battle.timeRemainingMs <= 0) {
      let winnerSide = null;
      if (leftTowerHp !== rightTowerHp) {
        winnerSide = leftTowerHp > rightTowerHp ? 'left' : 'right';
      }
      await this.finishMatch(winnerSide, 'time_up');
      return;
    }

    await this.persist();
    await this.broadcast('state_snapshot');
  }

  async finishMatch(winnerSide, reason) {
    this.room.status = 'finished';
    this.stopTicking();
    this.room.battle.result = {
      winnerSide,
      reason
    };

    const leftPlayer = this.room.players.left;
    const rightPlayer = this.room.players.right;
    if (leftPlayer && rightPlayer && !leftPlayer.isBot && !rightPlayer.isBot) {
      await recordMatchHistory(this.env, {
        roomCode: this.room.code,
        playerOneUserId: leftPlayer.userId,
        playerTwoUserId: rightPlayer.userId,
        winnerUserId: winnerSide ? this.room.players[winnerSide].userId : null,
        reason,
        playerOneTowerHp: this.room.battle.players.left.towerHp,
        playerTwoTowerHp: this.room.battle.players.right.towerHp,
        summary: this.viewerSnapshot(leftPlayer.userId)
      });
    }

    await this.persist(true);
    await this.broadcast('match_result');
  }

  sendError(userId, message) {
    const socket = this.sockets.get(String(userId));
    if (!socket) {
      return;
    }
    socket.send(JSON.stringify({ type: 'error', message }));
  }
}
