import { recordMatchHistory } from './royale_repository.js';

const TICK_MS = 100;
const MATCH_DURATION_MS = 180000;
const MAX_ELIXIR = 10;
const ELIXIR_PER_SECOND = 1;
const LEFT_TOWER_X = 0.05;
const RIGHT_TOWER_X = 0.95;
const LEFT_DEPLOY_MAX = 0.42;
const RIGHT_DEPLOY_MIN = 0.58;
const TOWER_HP = 3000;
const DISCONNECT_GRACE_MS = 15000;
const PERSIST_INTERVAL_MS = 1000;
const MAX_COMBO_CARDS = 3;
const LATERAL_MIN = 0.12;
const LATERAL_MAX = 0.88;

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

function sideDirection(side) {
  return side === 'left' ? 1 : -1;
}

function deployRangeForSide(side) {
  return side === 'left' ? [0.08, LEFT_DEPLOY_MAX] : [RIGHT_DEPLOY_MIN, 0.92];
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
    return 0.5;
  }
  return clamp(value, LATERAL_MIN, LATERAL_MAX);
}

function toWorldProgress(side, viewY) {
  const normalizedY = clamp(viewY, 0, 1);
  return side === 'left' ? 1 - normalizedY : normalizedY;
}

function normalizeDropPoint(side, payload) {
  const hasExactPoint =
    Number.isFinite(Number(payload?.dropX)) &&
    Number.isFinite(Number(payload?.dropY));

  if (!hasExactPoint) {
    return {
      progress: sanitizeLanePosition(side, Number(payload?.lanePosition)),
      lateralPosition: 0.5
    };
  }

  return {
    progress: sanitizeLanePosition(side, toWorldProgress(side, Number(payload.dropY))),
    lateralPosition: sanitizeLateralPosition(Number(payload.dropX))
  };
}

function distanceBetweenPoints(aProgress, aLateral, bProgress, bLateral) {
  return Math.hypot(aProgress - bProgress, aLateral - bLateral);
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
            towerHp: TOWER_HP,
            maxTowerHp: TOWER_HP
          }
        ];
      })
    )
  };
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
    ready: false,
    connected: false,
    lastDisconnectedAt: null
  };
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
      viewerSide: viewer?.side ?? null,
      players: Object.values(this.room.players).map((player) => {
        const battleState = this.room.battle?.players[player.side];
        return {
          userId: player.userId,
          name: player.name,
          side: player.side,
          deckId: player.deckId,
          deckName: player.deckName,
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
              side: unit.side,
              type: unit.type,
              progress: Number(unit.progress.toFixed(4)),
              lateralPosition: Number(unit.lateralPosition.toFixed(4)),
              hp: Math.max(0, Math.round(unit.hp)),
              maxHp: unit.maxHp,
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
      createdAt: new Date().toISOString(),
      players: {
        left: createPlayer('left', payload)
      },
      battle: null
    };
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
    this.ensureTicking();
    void this.persist(true);
  }

  resetRoomToLobby() {
    this.stopTicking();
    this.room.status = 'lobby';
    this.room.battle = null;
    for (const player of Object.values(this.room.players)) {
      player.ready = false;
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
    let moveSpeed = card.moveSpeed;

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
        0.5,
        dropPoint.progress,
        dropPoint.lateralPosition
      ) <=
      card.spellRadius + 0.05
    ) {
      enemyBattleState.towerHp = Math.max(0, enemyBattleState.towerHp - card.spellDamage);
    }
  }

  spawnUnits(side, card, dropPoint, equipmentEffects = []) {
    const count = Math.max(1, card.spawnCount);
    const spacing = count === 1 ? 0 : 0.03;
    const stats = this.applyEquipmentEffects(card, equipmentEffects);
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * spacing;
      this.room.battle.units.push({
        id: `unit-${this.room.battle.nextUnitId++}`,
        cardId: card.id,
        name: card.name,
        type: card.type,
        side,
        progress: dropPoint.progress,
        lateralPosition: sanitizeLateralPosition(dropPoint.lateralPosition + offset),
        hp: stats.hp,
        maxHp: stats.hp,
        damage: stats.damage,
        attackRange: card.attackRange,
        moveSpeed: stats.moveSpeed,
        attackSpeed: card.attackSpeed || 1,
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
      0.5
    );

    if (unit.targetRule === 'tower') {
      if (towerForwardDistance >= 0 && towerDistance <= unit.attackRange + 0.04) {
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
      .filter((entry) => entry.forwardDistance >= -0.02);

    enemyUnits.sort((a, b) => a.distance - b.distance);
    const enemyUnit = enemyUnits[0];
    if (enemyUnit && enemyUnit.distance <= unit.attackRange) {
      return enemyUnit;
    }

    if (towerForwardDistance >= 0 && towerDistance <= unit.attackRange + 0.04) {
      return {
        kind: 'tower',
        target: enemySide,
        distance: towerDistance
      };
    }

    return enemyUnit && enemyUnit.forwardDistance < 0.12 ? enemyUnit : null;
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

    for (const unit of this.room.battle.units) {
      if (unit.hp <= 0) {
        continue;
      }

      unit.cooldown = Math.max(0, unit.cooldown - dt);
      const target = this.selectTarget(unit);
      if (target && target.distance <= unit.attackRange + 0.04) {
        if (unit.cooldown <= 0) {
          this.performAttack(unit, target);
          unit.cooldown = unit.attackSpeed;
        }
      } else {
        unit.progress = clamp(
          unit.progress + sideDirection(unit.side) * unit.moveSpeed * dt,
          0.08,
          0.92
        );
        const desiredLateral =
          target?.kind === 'unit' ? target.target.lateralPosition : 0.5;
        const lateralDelta = desiredLateral - unit.lateralPosition;
        const lateralStep = unit.moveSpeed * 0.45 * dt;
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
    if (leftPlayer && rightPlayer) {
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
