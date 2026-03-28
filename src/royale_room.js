import { getCardMap, recordMatchHistory } from './royale_repository.js';

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
    this.cardMapPromise = null;
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
    if (request.method === 'GET' && url.pathname === '/internal/state') {
      return this.handleState(request);
    }

    return json({ error: 'Not Found' }, 404);
  }

  async getCardMap() {
    if (!this.cardMapPromise) {
      this.cardMapPromise = getCardMap(this.env);
    }
    return this.cardMapPromise;
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
              x: Number(unit.x.toFixed(4)),
              yOffset: unit.yOffset,
              hp: Math.max(0, Math.round(unit.hp)),
              maxHp: unit.maxHp
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
      await this.handlePlayCard(userId, payload);
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

  async handlePlayCard(userId, payload) {
    if (!this.room?.battle || this.room.status !== 'battle') {
      return;
    }

    const player = this.findPlayerByUserId(userId);
    if (!player) {
      return;
    }

    const battlePlayer = this.room.battle.players[player.side];
    const handIndex = battlePlayer.hand.findIndex((cardId) => cardId === payload.cardId);
    if (handIndex === -1) {
      this.sendError(userId, 'Card is not in hand');
      return;
    }

    const card = player.deckCards.find((entry) => entry.id === payload.cardId);
    if (!card) {
      this.sendError(userId, 'Unknown card');
      return;
    }

    if (battlePlayer.elixir + 1e-6 < card.elixirCost) {
      this.sendError(userId, 'Not enough elixir');
      return;
    }

    const lanePosition = sanitizeLanePosition(
      player.side,
      Number(payload.lanePosition)
    );

    battlePlayer.elixir = clamp(battlePlayer.elixir - card.elixirCost, 0, MAX_ELIXIR);
    battlePlayer.hand.splice(handIndex, 1);
    battlePlayer.queue.push(card.id);
    battlePlayer.hand.push(battlePlayer.queue.shift());

    if (card.type === 'spell') {
      this.resolveSpell(player.side, card, lanePosition);
      await this.broadcast('battle_event', {
        event: {
          type: 'spell_cast',
          side: player.side,
          cardId: card.id,
          lanePosition
        }
      });
    } else {
      this.spawnUnits(player.side, card, lanePosition);
    }

    await this.persist();
  }

  resolveSpell(side, card, lanePosition) {
    const enemySide = side === 'left' ? 'right' : 'left';
    const enemyBattleState = this.room.battle.players[enemySide];

    for (const unit of this.room.battle.units) {
      if (unit.side === side) {
        continue;
      }
      if (Math.abs(unit.x - lanePosition) <= card.spellRadius) {
        unit.hp -= card.spellDamage;
      }
    }

    const towerX = enemySide === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
    if (Math.abs(towerX - lanePosition) <= card.spellRadius + 0.05) {
      enemyBattleState.towerHp = Math.max(0, enemyBattleState.towerHp - card.spellDamage);
    }
  }

  spawnUnits(side, card, lanePosition) {
    const count = Math.max(1, card.spawnCount);
    const spacing = count === 1 ? 0 : 0.03;
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * spacing;
      this.room.battle.units.push({
        id: `unit-${this.room.battle.nextUnitId++}`,
        cardId: card.id,
        name: card.name,
        type: card.type,
        side,
        x: clamp(lanePosition + offset, 0.08, 0.92),
        yOffset: Number((index - (count - 1) / 2).toFixed(2)),
        hp: card.hp,
        maxHp: card.hp,
        damage: card.damage,
        attackRange: card.attackRange,
        moveSpeed: card.moveSpeed,
        attackSpeed: card.attackSpeed || 1,
        targetRule: card.targetRule,
        cooldown: 0
      });
    }
  }

  getEnemySide(side) {
    return side === 'left' ? 'right' : 'left';
  }

  selectTarget(unit) {
    const direction = sideDirection(unit.side);
    const enemySide = this.getEnemySide(unit.side);
    const towerX = enemySide === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
    const towerDistance = (towerX - unit.x) * direction;

    if (unit.targetRule === 'tower') {
      if (towerDistance >= 0 && towerDistance <= unit.attackRange + 0.04) {
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
        distance: (entry.x - unit.x) * direction
      }))
      .filter((entry) => entry.distance >= 0);

    enemyUnits.sort((a, b) => a.distance - b.distance);
    const enemyUnit = enemyUnits[0];
    if (enemyUnit && enemyUnit.distance <= unit.attackRange) {
      return enemyUnit;
    }

    if (towerDistance >= 0 && towerDistance <= unit.attackRange + 0.04) {
      return {
        kind: 'tower',
        target: enemySide,
        distance: towerDistance
      };
    }

    return enemyUnit && enemyUnit.distance < 0.12 ? enemyUnit : null;
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
        unit.x = clamp(
          unit.x + sideDirection(unit.side) * unit.moveSpeed * dt,
          0.08,
          0.92
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
