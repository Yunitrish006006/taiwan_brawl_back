import { recordMatchHistory } from './royale_repository.js';
import {
  CENTER_LATERAL,
  DISCONNECT_GRACE_MS,
  ELIXIR_PER_SECOND,
  FIELD_ASPECT_RATIO,
  GLOBAL_ATTACK_SPEED_MULTIPLIER,
  LEFT_TOWER_X,
  MAX_ELIXIR,
  MAX_FIELD_PROGRESS,
  MIN_FIELD_PROGRESS,
  PERSIST_INTERVAL_MS,
  RIGHT_TOWER_X,
  TICK_MS,
  TOWER_HP,
  WORLD_SCALE,
  bodyRadiusForUnitType,
  clamp,
  displayAttackReach,
  distanceBetweenPoints,
  effectiveAttackReachToTower,
  effectiveAttackReachToUnit,
  normalizeDropPoint,
  normalizeSimulationMode,
  randomBotThinkMs,
  sanitizeLanePosition,
  sanitizeLateralPosition,
  sideDirection
} from './royale_battle_rules.js';
import {
  applyEquipmentEffects,
  buildBotPayload,
  chooseBotCombo,
  drawReplacementCards,
  equipmentEffects,
  resolveComboCards
} from './royale_room_combat.js';
import {
  buildBattleSnapshot,
  buildPlayerSnapshot,
  clone,
  createBattleState,
  createPlayer,
  normalizeHostBattleState,
  nowMs
} from './royale_room_state.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
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

    const handler = this.internalRequestHandler(request.method, url.pathname);
    if (handler) {
      return handler(request);
    }

    return json({ error: 'Not Found' }, 404);
  }

  internalRequestHandler(method, pathname) {
    switch (`${method} ${pathname}`) {
      case 'POST /internal/create':
        return this.handleCreate.bind(this);
      case 'POST /internal/join':
        return this.handleJoin.bind(this);
      case 'POST /internal/ready':
        return this.handleReady.bind(this);
      case 'POST /internal/rematch':
        return this.handleRematch.bind(this);
      case 'POST /internal/host-finish':
        return this.handleHostFinish.bind(this);
      case 'GET /internal/state':
        return this.handleState.bind(this);
      default:
        return null;
    }
  }

  socketKey(userId) {
    return String(userId);
  }

  socketForUser(userId) {
    return this.sockets.get(this.socketKey(userId)) ?? null;
  }

  sendSocketPayload(socket, payload) {
    socket.send(JSON.stringify(payload));
  }

  sendToUser(userId, payload) {
    const socket = this.socketForUser(userId);
    if (!socket) {
      return false;
    }
    this.sendSocketPayload(socket, payload);
    return true;
  }

  isBattleRunning() {
    return Boolean(this.room?.battle && this.room.status === 'battle');
  }

  normalizeComboPayload(payload) {
    return {
      cardIds: Array.isArray(payload?.cardIds)
        ? payload.cardIds.map(String)
        : [String(payload?.cardId || '')].filter(Boolean),
      lanePosition: Number(payload?.lanePosition),
      dropX: Number(payload?.dropX),
      dropY: Number(payload?.dropY)
    };
  }

  async routeSocketCombo(userId, payload) {
    if (this.simulationMode() === 'host') {
      await this.forwardHostCommand(userId, payload);
      return;
    }
    await this.handlePlayCombo(userId, payload);
  }

  findPlayerByUserId(userId) {
    if (!this.room) {
      return null;
    }

    return Object.values(this.room.players).find(
      (player) => Number(player.userId) === Number(userId)
    );
  }

  simulationMode() {
    return normalizeSimulationMode(this.room?.simulationMode);
  }

  hostUserId() {
    return Number(this.room?.hostUserId || this.room?.players?.left?.userId || 0);
  }

  hasAllPlayersReady() {
    if (!this.room) {
      return false;
    }
    return (
      Object.keys(this.room.players).length === 2 &&
      Object.values(this.room.players).every((player) => player.ready)
    );
  }

  okRoom(userId) {
    return json({ ok: true, room: this.viewerSnapshot(userId) });
  }

  async persistAndBroadcast(type, { force = true } = {}) {
    await this.persist(force);
    await this.broadcast(type);
  }

  async markPlayerReady(userId) {
    const player = this.findPlayerByUserId(userId);
    if (!player) {
      return false;
    }

    player.ready = true;
    await this.persistAndBroadcast('room_state');
    if (this.hasAllPlayersReady()) {
      this.startBattle();
      await this.broadcast('battle_started');
    }
    return true;
  }

  viewerSnapshot(userId) {
    if (!this.room) {
      return null;
    }

    const viewer = this.findPlayerByUserId(userId);
    const simulationMode = normalizeSimulationMode(this.room.simulationMode);
    const includeHostDecks = simulationMode === 'host' && viewer?.side === 'left';
    const battlePlayer = viewer && this.room.battle ? this.room.battle.players[viewer.side] : null;

    return {
      code: this.room.code,
      status: this.room.status,
      simulationMode,
      hostUserId: this.hostUserId(),
      viewerSide: viewer?.side ?? null,
      players: Object.values(this.room.players).map((player) =>
        buildPlayerSnapshot(
          player,
          this.room.battle?.players[player.side],
          includeHostDecks
        )
      ),
      battle: buildBattleSnapshot(this.room, viewer, battlePlayer)
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
        this.sendSocketPayload(socket, payload);
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
      hostUserId: Number(payload.user.id),
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

    return this.okRoom(payload.user.id);
  }

  async handleJoin(request) {
    const payload = await request.json();
    if (!this.room) {
      return json({ error: 'Room not found' }, 404);
    }

    const existing = this.findPlayerByUserId(payload.user.id);
    if (existing) {
      return this.okRoom(payload.user.id);
    }

    if (Object.keys(this.room.players).length >= 2) {
      return json({ error: 'Room is full' }, 409);
    }

    this.room.players.right = createPlayer('right', payload);
    await this.persistAndBroadcast('room_state');
    return this.okRoom(payload.user.id);
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

    await this.markPlayerReady(payload.userId);
    return this.okRoom(payload.userId);
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
    await this.persistAndBroadcast('room_state');
    return this.okRoom(payload.userId);
  }

  async handleState(request) {
    const userId = Number(request.headers.get('x-user-id'));
    if (!this.room) {
      return json({ error: 'Room not found' }, 404);
    }

    return this.okRoom(userId);
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
    if (this.simulationMode() !== 'host') {
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

    await this.persistAndBroadcast('match_result');
    return this.okRoom(payload.userId);
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

    const existing = this.socketForUser(userId);
    if (existing) {
      existing.close(1012, 'replaced');
    }

    this.sockets.set(this.socketKey(userId), server);
    player.connected = true;
    player.lastDisconnectedAt = null;
    void this.persist(true);

    server.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        void this.handleSocketMessage(userId, payload);
      } catch (_) {
        this.sendSocketPayload(server, {
          type: 'error',
          message: 'Invalid socket payload'
        });
      }
    });

    server.addEventListener('close', () => {
      this.handleSocketClose(userId);
    });

    this.sendSocketPayload(server, {
      type: 'room_state',
      room: this.viewerSnapshot(userId)
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSocketMessage(userId, payload) {
    switch (payload?.type) {
      case 'ping':
        this.sendToUser(userId, { type: 'pong' });
        return;
      case 'ready':
        await this.markPlayerReady(userId);
        return;
      case 'play_card':
        await this.routeSocketCombo(userId, this.normalizeComboPayload(payload));
        return;
      case 'play_combo':
        await this.routeSocketCombo(userId, this.normalizeComboPayload(payload));
        return;
      case 'host_state':
        await this.handleHostState(userId, payload.state);
        return;
      default:
        return;
    }
  }

  hostSocket() {
    const hostUserId = this.hostUserId();
    if (!hostUserId) {
      return null;
    }
    return this.socketForUser(hostUserId);
  }

  async forwardHostCommand(userId, payload) {
    if (!this.isBattleRunning()) {
      return;
    }
    if (this.simulationMode() !== 'host') {
      await this.handlePlayCombo(userId, payload);
      return;
    }

    const player = this.findPlayerByUserId(userId);
    if (!player) {
      return;
    }

    const hostUserId = this.hostUserId();
    if (userId === hostUserId) {
      return;
    }

    const hostSocket = this.hostSocket();
    if (!hostSocket) {
      this.sendError(userId, 'Host is offline');
      return;
    }

    this.sendSocketPayload(hostSocket, {
      type: 'host_command',
      command: {
        type: 'play_combo',
        side: player.side,
        ...this.normalizeComboPayload(payload)
      }
    });
  }

  async handleHostState(userId, state) {
    if (!this.isBattleRunning()) {
      return;
    }
    if (this.simulationMode() !== 'host') {
      return;
    }

    const hostUserId = this.hostUserId();
    if (Number(userId) !== hostUserId) {
      this.sendError(userId, 'Only the host can submit host state');
      return;
    }

    if (!state || typeof state !== 'object' || !state.players || !state.units) {
      this.sendError(userId, 'Invalid host state');
      return;
    }

    this.room.battle = normalizeHostBattleState(this.room.battle, state);

    await this.persist(false);
    await this.broadcast('state_snapshot');
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

      const comboCards = chooseBotCombo(player, battlePlayer);
      battlePlayer.botThinkMs = randomBotThinkMs();
      if (comboCards.length === 0) {
        continue;
      }

      await this.handlePlayCombo(player.userId, buildBotPayload(this.room, side, comboCards));
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
    const comboCards = resolveComboCards(
      player,
      battlePlayer,
      cardIds,
      (message) => this.sendError(userId, message)
    );
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
    const comboEquipmentEffects = equipmentEffects(comboCards);

    battlePlayer.elixir = clamp(
      battlePlayer.elixir - totalElixirCost,
      0,
      MAX_ELIXIR
    );
    drawReplacementCards(battlePlayer, comboCards.map((card) => card.id));

    for (const card of comboCards) {
      if (card.type === 'spell') {
        this.resolveSpell(player.side, card, dropPoint);
      } else if (card.type !== 'equipment') {
        this.spawnUnits(player.side, card, dropPoint, comboEquipmentEffects);
      }
    }

    await this.broadcast('battle_event', {
      event: {
        type: 'combo_cast',
        side: player.side,
        cardIds: comboCards.map((card) => card.id),
        progress: dropPoint.progress,
        lateralPosition: dropPoint.lateralPosition,
        equipment: comboEquipmentEffects.map((effect) => effect.name)
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
        CENTER_LATERAL,
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
    const stats = applyEquipmentEffects(card, equipmentEffects);
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
      CENTER_LATERAL
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
          MIN_FIELD_PROGRESS,
          MAX_FIELD_PROGRESS
        );
        const desiredLateral =
          target?.kind === 'unit' ? target.target.lateralPosition : CENTER_LATERAL;
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
    const socket = this.socketForUser(userId);
    if (!socket) {
      return;
    }
    this.sendSocketPayload(socket, { type: 'error', message });
  }
}
