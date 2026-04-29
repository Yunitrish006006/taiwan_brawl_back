import { recordMatchHistory } from './royale_repository.js';
import {
  UNIT_COLLISION_GAP,
  bodyRadiusForUnitType,
  DISCONNECT_GRACE_MS,
  DISCARD_SPIRIT_COST,
  PERSIST_INTERVAL_MS,
  TICK_MS,
  clamp,
  arenaConfigForBattle,
  lateralOffsetForWorldDistance,
  minimumBodyContactDistance,
  normalizeDropPoint,
  normalizeArenaConfig,
  normalizeSimulationMode,
  randomArenaConfig,
  randomBotThinkMs
} from './royale_battle_rules.js';
import {
  applySelfEquipmentEffects,
  buildBotPayload,
  canCastEquipmentOnHero,
  chooseBotCombo,
  discardHandCard,
  drawReplacementCards,
  equipmentEffects,
  recordCardUses,
  resolveComboCards
} from './royale_room_combat.js';
import { isJobCard, resolveJobCardEffect } from './royale_job_events.js';
import { isEventCard } from './royale_card_progression.js';
import { resolveEventCard } from './royale_event_cards.js';
import { tickFieldEvents } from './royale_field_events.js';
import {
  getEnemySide,
  performUnitAttack,
  regenerateBattleResources,
  resolveSpellEffect,
  selectUnitTarget,
  spawnBattleUnits,
  tickHeroAttacks,
  tickBattleUnits,
  towerHitPoints,
  winnerSideFromTowers
} from './royale_room_runtime.js';
import {
  buildBattleSnapshot,
  buildPlayerSnapshot,
  clone,
  createBattleState,
  createPlayer,
  normalizeHostBattleState,
  nowMs
} from './royale_room_state.js';
import {
  canSpendBattlePlayerEnergy,
  canSpendBattlePlayerMoney,
  spendBattlePlayerMoney,
  spendBattlePlayerEnergy
} from './royale_heroes.js';
import { normalizeBotController } from './royale_llm_bot.js';
import { normalizeCardDefinition } from './royale_cards.js';
import { applyMatchProgression } from './royale_progression.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cardBodyRadius(card) {
  return Math.max(0, Number(card.bodyRadius || bodyRadiusForUnitType(card.type)));
}

function comboUnitOffsets(cards, arena) {
  if (cards.length <= 1) {
    return cards.map(() => 0);
  }
  const maxBodyRadius = cards.reduce(
    (max, card) => Math.max(max, cardBodyRadius(card)),
    0
  );
  const spacing = lateralOffsetForWorldDistance(
    minimumBodyContactDistance(maxBodyRadius, maxBodyRadius, UNIT_COLLISION_GAP),
    arena
  );
  return cards.map((_, index) => (index - (cards.length - 1) / 2) * spacing);
}

export class RoyaleRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    this.sockets = new Map();
    this.tickHandle = null;
    this.lastPersistedAt = 0;
    this.mutationQueue = Promise.resolve();
    this.mutationDepth = 0;
    this.initialized = this.load();
  }

  async enqueueMutation(operation) {
    if (this.mutationDepth > 0) {
      return operation();
    }

    const run = async () => {
      this.mutationDepth += 1;
      try {
        return await operation();
      } finally {
        this.mutationDepth -= 1;
      }
    };
    const next = this.mutationQueue.then(run, run);
    this.mutationQueue = next.catch(() => {});
    return next;
  }

  async load() {
    this.room = await this.state.storage.get('room');
    if (this.room?.players) {
      for (const player of Object.values(this.room.players)) {
        player.deckCards = Array.isArray(player.deckCards)
          ? player.deckCards.map((card) => normalizeCardDefinition(card))
          : [];
      }
    }
    if (this.room) {
      this.room.arena = normalizeArenaConfig(this.room.arena);
    }
    if (this.room?.status === 'battle') {
      this.room.battle.arena = normalizeArenaConfig(this.room.battle.arena);
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

  normalizeDiscardPayload(payload) {
    return {
      cardId: String(payload?.cardId || '')
    };
  }

  async routeSocketCombo(userId, payload) {
    if (this.simulationMode() === 'host') {
      await this.forwardHostCommand(userId, payload);
      return;
    }
    await this.handlePlayCombo(userId, payload);
  }

  async routeSocketDiscard(userId, payload) {
    if (this.simulationMode() === 'host') {
      await this.forwardHostDiscardCommand(userId, payload);
      return;
    }
    await this.handleDiscardCard(userId, payload);
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

  isLocalHostBotRoom() {
    return (
      normalizeSimulationMode(this.room?.simulationMode) === 'host' &&
      Boolean(this.room?.players?.right?.isBot)
    );
  }

  playerHasEnteredGame(player) {
    if (!player) {
      return false;
    }
    if (player.isBot || player.connected) {
      return true;
    }
    return this.isLocalHostBotRoom() && player.side === 'left' && player.ready;
  }

  canStartBattle() {
    if (!this.room) {
      return false;
    }
    return (
      this.room.status === 'lobby' &&
      Object.keys(this.room.players).length === 2 &&
      Object.values(this.room.players).every(
        (player) => player.ready && this.playerHasEnteredGame(player)
      )
    );
  }

  async startBattleIfReady() {
    return this.enqueueMutation(() => this.startBattleIfReadyMutation());
  }

  async startBattleIfReadyMutation() {
    if (!this.canStartBattle()) {
      return false;
    }
    this.startBattle();
    await this.broadcast('battle_started');
    return true;
  }

  okRoom(userId) {
    return json({ ok: true, room: this.viewerSnapshot(userId) });
  }

  async persistAndBroadcast(type, { force = true } = {}) {
    await this.persist(force);
    await this.broadcast(type);
  }

  async markPlayerReady(userId) {
    return this.enqueueMutation(() => this.markPlayerReadyMutation(userId));
  }

  async markPlayerReadyMutation(userId) {
    const player = this.findPlayerByUserId(userId);
    if (!player) {
      return false;
    }

    player.ready = true;
    await this.persistAndBroadcast('room_state');
    await this.startBattleIfReady();
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
      arena: normalizeArenaConfig(
        this.room.battle?.arena ?? this.room.arena
      ),
      players: Object.values(this.room.players).map((player) => {
        const includeDeckState =
          player.side === viewer?.side || includeHostDecks;
        return buildPlayerSnapshot(
          player,
          this.room.battle?.players[player.side],
          includeDeckState
        );
      }),
      battle: buildBattleSnapshot(this.room, viewer, battlePlayer)
    };
  }

  async broadcast(type, extra = {}) {
    if (!this.room) {
      return;
    }

    for (const [userId, socket] of this.sockets.entries()) {
      try {
        if (
          type === 'state_snapshot' &&
          this.simulationMode() === 'host' &&
          Number(userId) === this.hostUserId()
        ) {
          continue;
        }
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
    return this.enqueueMutation(() => this.handleCreateMutation(request));
  }

  async handleCreateMutation(request) {
    const payload = await request.json();
    if (this.room) {
      return json({ error: 'Room already exists' }, 409);
    }

    this.room = {
      code: payload.code,
      status: 'lobby',
      simulationMode: payload.vsBot ? 'host' : normalizeSimulationMode(payload.simulationMode),
      hostUserId: Number(payload.user.id),
      createdAt: new Date().toISOString(),
      arena: randomArenaConfig(),
      players: {
        left: createPlayer('left', payload)
      },
      battle: null
    };

    if (payload.vsBot) {
      const botController = normalizeBotController(payload.botController);
      this.room.players.right = createPlayer('right', {
        user: {
          id: 0,
          name: botController === 'llm' ? 'LLM Bot' : 'Heuristic Bot',
          isBot: true,
          botController
        },
        deck: payload.botDeck || payload.deck,
        heroId: payload.heroId
      });
    }
    await this.persist(true);

    return this.okRoom(payload.user.id);
  }

  async handleJoin(request) {
    return this.enqueueMutation(() => this.handleJoinMutation(request));
  }

  async handleJoinMutation(request) {
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
    return this.enqueueMutation(() => this.handleReadyMutation(request));
  }

  async handleReadyMutation(request) {
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
    return this.enqueueMutation(() => this.handleRematchMutation(request));
  }

  async handleRematchMutation(request) {
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
    return this.enqueueMutation(() => this.handleHostFinishMutation(request));
  }

  async handleHostFinishMutation(request) {
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

    await applyMatchProgression(this.env, {
      room: this.room,
      winnerSide: this.room.battle.result.winnerSide,
      reason: this.room.battle.result.reason
    });
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
      this.handleSocketClose(userId, server);
    });

    this.sendSocketPayload(server, {
      type: 'room_state',
      room: this.viewerSnapshot(userId)
    });
    void this.startBattleIfReady().then((started) => {
      if (!started) {
        void this.broadcast('room_state');
      }
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
      case 'discard_card':
        await this.routeSocketDiscard(userId, this.normalizeDiscardPayload(payload));
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

  async forwardHostDiscardCommand(userId, payload) {
    if (!this.isBattleRunning()) {
      return;
    }
    if (this.simulationMode() !== 'host') {
      await this.handleDiscardCard(userId, payload);
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
        type: 'discard_card',
        side: player.side,
        cardId: String(payload?.cardId || '')
      }
    });
  }

  async handleHostState(userId, state) {
    return this.enqueueMutation(() => this.handleHostStateMutation(userId, state));
  }

  async handleHostStateMutation(userId, state) {
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

  handleSocketClose(userId, socket) {
    void this.enqueueMutation(() => this.handleSocketCloseMutation(userId, socket));
  }

  handleSocketCloseMutation(userId, socket) {
    const activeSocket = this.socketForUser(userId);
    if (activeSocket && activeSocket !== socket) {
      return;
    }

    const player = this.findPlayerByUserId(userId);
    this.sockets.delete(this.socketKey(userId));
    if (!player) {
      return;
    }

    if (
      this.room?.status === 'lobby' &&
      player.side === 'right' &&
      !player.isBot
    ) {
      delete this.room.players.right;
      void this.persist(true);
      void this.broadcast('room_state');
      return;
    }

    player.connected = false;
    player.lastDisconnectedAt = new Date().toISOString();
    void this.persist(true);
    void this.broadcast('room_state');
  }

  startBattle() {
    const arena = normalizeArenaConfig(this.room.arena);
    this.room.status = 'battle';
    this.room.arena = arena;
    this.room.battle = createBattleState(this.room.players, { arena });
    if (normalizeSimulationMode(this.room.simulationMode) === 'server') {
      this.ensureTicking();
    }
    void this.persist(true);
  }

  resetRoomToLobby() {
    this.stopTicking();
    this.room.status = 'lobby';
    this.room.battle = null;
    this.room.arena = randomArenaConfig();
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

      const comboCards = chooseBotCombo(this.room, side, player, battlePlayer);
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
    return this.enqueueMutation(() => this.handlePlayComboMutation(userId, payload));
  }

  async handleDiscardCard(userId, payload) {
    return this.enqueueMutation(() => this.handleDiscardCardMutation(userId, payload));
  }

  async handleDiscardCardMutation(userId, payload) {
    if (!this.room?.battle || this.room.status !== 'battle') {
      return;
    }

    const player = this.findPlayerByUserId(userId);
    if (!player) {
      return;
    }

    const battlePlayer = this.room.battle.players[player.side];
    if (!canSpendBattlePlayerEnergy(battlePlayer, DISCARD_SPIRIT_COST, 'spirit')) {
      this.sendError(userId, 'Not enough Spirit Energy');
      return;
    }

    if (!discardHandCard(
      battlePlayer,
      payload?.cardId,
      (message) => this.sendError(userId, message)
    )) {
      return;
    }
    spendBattlePlayerEnergy(battlePlayer, DISCARD_SPIRIT_COST, 'spirit');

    await this.broadcast('battle_event', {
      event: {
        type: 'card_discarded',
        side: player.side,
        cardId: String(payload?.cardId || ''),
        spiritCost: DISCARD_SPIRIT_COST
      }
    });
    await this.broadcast('state_snapshot');

    await this.persist();
  }

  async handlePlayComboMutation(userId, payload) {
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

    const physicalCost = comboCards
      .filter((card) => card.energyCostType === 'physical')
      .reduce((sum, card) => sum + Number(card.energyCost || 0), 0);
    const spiritCost = comboCards
      .filter((card) => card.energyCostType === 'spirit')
      .reduce((sum, card) => sum + Number(card.energyCost || 0), 0);
    const moneyCost = comboCards
      .filter((card) => card.energyCostType === 'money')
      .reduce((sum, card) => sum + Number(card.energyCost || 0), 0);
    if (!canSpendBattlePlayerEnergy(battlePlayer, physicalCost, 'physical')) {
      this.sendError(userId, 'Not enough Physical Energy');
      return;
    }
    if (!canSpendBattlePlayerEnergy(battlePlayer, spiritCost, 'spirit')) {
      this.sendError(userId, 'Not enough Spirit Energy');
      return;
    }
    if (!canSpendBattlePlayerMoney(battlePlayer, moneyCost)) {
      this.sendError(userId, 'Not enough Money');
      return;
    }

    const equipmentCards = comboCards.filter((card) => card.type === 'equipment');
    const eventCards = comboCards.filter((card) => isEventCard(card));
    const jobCards = comboCards.filter((card) => isJobCard(card));
    const unitCards = comboCards.filter(
      (card) =>
        card.type !== 'equipment' &&
        card.type !== 'spell' &&
        !isEventCard(card) &&
        !isJobCard(card)
    );
    const selfEquipmentOnly =
      equipmentCards.length === comboCards.length &&
      equipmentCards.every((card) => canCastEquipmentOnHero(card));
    if (eventCards.length > 0 && comboCards.length !== 1) {
      this.sendError(userId, 'Event cards must be played alone');
      return;
    }
    if (equipmentCards.length > 0 && unitCards.length === 0 && !selfEquipmentOnly) {
      this.sendError(userId, 'Equipment cards need at least one unit in the same cast');
      return;
    }
    if (jobCards.length > 0 && comboCards.length !== 1) {
      this.sendError(userId, 'Job cards must be played alone');
      return;
    }

    const dropPoint =
      jobCards.length > 0 || eventCards.length > 0 || selfEquipmentOnly
        ? null
        : normalizeDropPoint(player.side, payload, this.room.battle.arena);
    const comboEquipmentEffects = equipmentEffects(comboCards, {
      battleState: this.room.battle,
      side: player.side
    });
    const comboOffsets = comboUnitOffsets(
      unitCards,
      arenaConfigForBattle(this.room.battle)
    );
    let comboUnitCursor = 0;

    for (const card of comboCards) {
      if (card.energyCostType === 'money') {
        spendBattlePlayerMoney(battlePlayer, Number(card.energyCost || 0));
      } else {
        spendBattlePlayerEnergy(
          battlePlayer,
          Number(card.energyCost || 0),
          card.energyCostType === 'spirit' ? 'spirit' : 'physical'
        );
      }
    }
    recordCardUses(battlePlayer, comboCards);
    drawReplacementCards(battlePlayer, comboCards.map((card) => card.id));

    for (const card of comboCards) {
      if (card.type === 'spell') {
        this.resolveSpell(player.side, card, dropPoint);
      } else if (isEventCard(card)) {
        resolveEventCard(this.room, player.side, card);
      } else if (isJobCard(card)) {
        resolveJobCardEffect(this.room, player.side, card);
      } else if (card.type !== 'equipment') {
        this.spawnUnits(
          player.side,
          card,
          dropPoint,
          comboEquipmentEffects,
          comboOffsets[comboUnitCursor++]
        );
      }
    }
    if (selfEquipmentOnly) {
      applySelfEquipmentEffects(battlePlayer, comboCards);
    }

    await this.broadcast('battle_event', {
      event: {
        type: 'combo_cast',
        side: player.side,
        cardIds: comboCards.map((card) => card.id),
        progress: dropPoint?.progress ?? null,
        lateralPosition: dropPoint?.lateralPosition ?? null,
        equipment: comboEquipmentEffects.map((effect) => effect.name)
      }
    });
    await this.broadcast('state_snapshot');

    await this.persist();
  }

  resolveSpell(side, card, dropPoint) {
    resolveSpellEffect(this.room, side, card, dropPoint);
  }

  spawnUnits(side, card, dropPoint, equipmentEffects = [], groupLateralOffset = 0) {
    spawnBattleUnits(
      this.room,
      side,
      card,
      dropPoint,
      equipmentEffects,
      groupLateralOffset
    );
  }

  getEnemySide(side) {
    return getEnemySide(side);
  }

  selectTarget(unit) {
    return selectUnitTarget(this.room, unit);
  }

  performAttack(unit, target) {
    performUnitAttack(this.room, unit, target);
  }

  async tick() {
    return this.enqueueMutation(() => this.tickMutation());
  }

  async tickMutation() {
    if (!this.room?.battle || this.room.status !== 'battle') {
      this.stopTicking();
      return;
    }

    const dt = TICK_MS / 1000;
    this.room.battle.timeRemainingMs -= TICK_MS;

    regenerateBattleResources(this.room, dt);

    await this.runBotTurns();
    tickHeroAttacks(this.room, dt);
    tickBattleUnits(this.room, dt);
    tickFieldEvents(this.room, dt);
    const towerState = towerHitPoints(this.room);

    if (towerState.leftDefeated || towerState.rightDefeated) {
      await this.finishMatch(
        winnerSideFromTowers(towerState),
        'tower_destroyed'
      );
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
      await this.finishMatch(
        winnerSideFromTowers(towerState),
        'time_up'
      );
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
    await applyMatchProgression(this.env, {
      room: this.room,
      winnerSide,
      reason
    });

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
