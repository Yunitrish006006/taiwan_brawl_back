import { defaultDeckCardIds, starterCards } from './royale_cards.js';

function serializeCard(row) {
  return {
    id: row.id,
    name: row.name,
    elixirCost: Number(row.elixir_cost),
    type: row.type,
    hp: Number(row.hp),
    damage: Number(row.damage),
    attackRange: Number(row.attack_range),
    moveSpeed: Number(row.move_speed),
    attackSpeed: Number(row.attack_speed),
    spawnCount: Number(row.spawn_count),
    spellRadius: Number(row.spell_radius),
    spellDamage: Number(row.spell_damage),
    targetRule: row.target_rule,
    effectKind: row.effect_kind || 'none',
    effectValue: Number(row.effect_value || 0)
  };
}

async function insertStarterCards(env) {
  for (const card of starterCards) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO cards (
        id, name, elixir_cost, type, hp, damage, attack_range, move_speed,
        attack_speed, spawn_count, spell_radius, spell_damage, target_rule,
        effect_kind, effect_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      card.id,
      card.name,
      card.elixirCost,
      card.type,
      card.hp,
      card.damage,
      card.attackRange,
      card.moveSpeed,
      card.attackSpeed,
      card.spawnCount,
      card.spellRadius,
      card.spellDamage,
      card.targetRule,
      card.effectKind,
      card.effectValue
    ).run();
  }
}

export async function ensureCardsSeeded(env) {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS count FROM cards').first();
  if (!Number(existing?.count)) {
    await insertStarterCards(env);
  }
}

export async function listCards(env) {
  await ensureCardsSeeded(env);
  const rows = await env.DB.prepare(
    `SELECT id, name, elixir_cost, type, hp, damage, attack_range, move_speed,
            attack_speed, spawn_count, spell_radius, spell_damage, target_rule,
            effect_kind, effect_value
     FROM cards
     ORDER BY elixir_cost ASC, name ASC`
  ).all();
  return rows.results.map(serializeCard);
}

export async function getCardMap(env) {
  const cards = await listCards(env);
  return new Map(cards.map((card) => [card.id, card]));
}

async function createStarterDeckForUser(userId, env) {
  await ensureCardsSeeded(env);
  await env.DB.prepare(
    'INSERT INTO user_decks (user_id, name, slot) VALUES (?, ?, 1)'
  ).bind(userId, 'Starter Deck').run();

  const deck = await env.DB.prepare(
    'SELECT id FROM user_decks WHERE user_id = ? AND slot = 1'
  ).bind(userId).first();

  for (const [index, cardId] of defaultDeckCardIds.entries()) {
    await env.DB.prepare(
      'INSERT INTO user_deck_cards (deck_id, position, card_id) VALUES (?, ?, ?)'
    ).bind(deck.id, index, cardId).run();
  }
}

export async function ensureUserStarterDeck(userId, env) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM user_decks WHERE user_id = ?'
  ).bind(userId).first();

  if (!Number(row?.count)) {
    await createStarterDeckForUser(userId, env);
  }
}

async function loadDeckCards(deckId, cardMap, env) {
  const rows = await env.DB.prepare(
    `SELECT position, card_id
     FROM user_deck_cards
     WHERE deck_id = ?
     ORDER BY position ASC`
  ).bind(deckId).all();

  return rows.results
    .map((row) => cardMap.get(row.card_id))
    .filter(Boolean);
}

export async function listDecksForUser(userId, env) {
  await ensureUserStarterDeck(userId, env);
  const cardMap = await getCardMap(env);
  const decks = await env.DB.prepare(
    `SELECT id, name, slot, updated_at
     FROM user_decks
     WHERE user_id = ?
     ORDER BY slot ASC, id ASC`
  ).bind(userId).all();

  const results = [];
  for (const deckRow of decks.results) {
    results.push({
      id: Number(deckRow.id),
      name: deckRow.name,
      slot: Number(deckRow.slot),
      updatedAt: deckRow.updated_at,
      cards: await loadDeckCards(deckRow.id, cardMap, env)
    });
  }
  return results;
}

export async function getDeckForUser(userId, deckId, env) {
  await ensureUserStarterDeck(userId, env);
  const deck = await env.DB.prepare(
    `SELECT id, name, slot, updated_at
     FROM user_decks
     WHERE user_id = ? AND id = ?`
  ).bind(userId, deckId).first();

  if (!deck) {
    return null;
  }

  const cardMap = await getCardMap(env);
  return {
    id: Number(deck.id),
    name: deck.name,
    slot: Number(deck.slot),
    updatedAt: deck.updated_at,
    cards: await loadDeckCards(deck.id, cardMap, env)
  };
}

export async function saveDeckForUser(userId, payload, env) {
  await ensureCardsSeeded(env);
  const name = String(payload?.name || 'Battle Deck').trim() || 'Battle Deck';
  const slot = Number(payload?.slot || 1);
  const cardIds = Array.isArray(payload?.cardIds) ? payload.cardIds.map(String) : [];

  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    throw new Error('slot must be between 1 and 3');
  }

  if (cardIds.length !== 8) {
    throw new Error('Deck must contain exactly 8 cards');
  }

  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== 8) {
    throw new Error('Deck cards must be unique');
  }

  const cardMap = await getCardMap(env);
  for (const cardId of cardIds) {
    if (!cardMap.has(cardId)) {
      throw new Error(`Unknown card: ${cardId}`);
    }
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM user_decks WHERE user_id = ? AND slot = ?'
  ).bind(userId, slot).first();

  let deckId = existing?.id;
  if (!deckId) {
    await env.DB.prepare(
      'INSERT INTO user_decks (user_id, name, slot) VALUES (?, ?, ?)'
    ).bind(userId, name, slot).run();
    const inserted = await env.DB.prepare(
      'SELECT id FROM user_decks WHERE user_id = ? AND slot = ?'
    ).bind(userId, slot).first();
    deckId = inserted.id;
  } else {
    await env.DB.prepare(
      'UPDATE user_decks SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(name, deckId).run();
    await env.DB.prepare('DELETE FROM user_deck_cards WHERE deck_id = ?').bind(deckId).run();
  }

  for (const [index, cardId] of cardIds.entries()) {
    await env.DB.prepare(
      'INSERT INTO user_deck_cards (deck_id, position, card_id) VALUES (?, ?, ?)'
    ).bind(deckId, index, cardId).run();
  }

  return getDeckForUser(userId, deckId, env);
}

export async function recordMatchHistory(env, match) {
  await env.DB.prepare(
    `INSERT INTO match_history (
      id, room_code, player_one_user_id, player_two_user_id, winner_user_id,
      reason, player_one_tower_hp, player_two_tower_hp, summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    match.roomCode,
    match.playerOneUserId,
    match.playerTwoUserId,
    match.winnerUserId,
    match.reason,
    match.playerOneTowerHp,
    match.playerTwoTowerHp,
    JSON.stringify(match.summary)
  ).run();
}
