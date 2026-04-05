import {
  defaultDeckCardIds,
  normalizeCardDefinition,
  normalizeEnergyCostType,
  starterCards
} from './royale_cards.js';

const MAX_CARD_IMAGE_BYTES = 1024 * 1024;
const CARD_SELECT_COLUMNS = `SELECT id, name, elixir_cost, energy_cost, energy_cost_type, type, hp, damage, attack_range, move_speed,
        attack_speed, spawn_count, spell_radius, spell_damage, target_rule,
        effect_kind, effect_value, body_radius, name_zh_hant, name_en, name_ja,
        name_i18n, image_version
 FROM cards`;
const CARD_WRITE_COLUMNS = `id, name, elixir_cost, energy_cost, energy_cost_type, type, hp, damage, attack_range, move_speed,
      attack_speed, spawn_count, spell_radius, spell_damage, target_rule,
      effect_kind, effect_value, body_radius, name_zh_hant, name_en, name_ja,
      name_i18n`;
const CARD_WRITE_PLACEHOLDERS =
  '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?';

function normalizeLocaleKey(locale) {
  const normalized = String(locale ?? '').trim();
  if (!normalized) {
    return '';
  }

  const lowered = normalized.replaceAll('_', '-').toLowerCase();
  if (lowered === 'zh-hant') {
    return 'zh-Hant';
  }
  if (lowered === 'en') {
    return 'en';
  }
  if (lowered === 'ja') {
    return 'ja';
  }
  return normalized;
}

function parseNameI18n(value) {
  if (!value) {
    return {};
  }

  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      return {};
    }
  }

  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  const normalized = {};
  for (const [locale, text] of Object.entries(source)) {
    const key = normalizeLocaleKey(locale);
    const valueText = String(text ?? '').trim();
    if (key && valueText) {
      normalized[key] = valueText;
    }
  }
  return normalized;
}

function firstAvailableName(nameI18n, fallbackName = '') {
  return (
    nameI18n['zh-Hant'] ||
    nameI18n.en ||
    nameI18n.ja ||
    String(fallbackName ?? '').trim()
  );
}

function localizedName(nameI18n, locale, fallbackName = '') {
  const key = normalizeLocaleKey(locale);
  return (
    nameI18n[key] ||
    nameI18n.en ||
    firstAvailableName(nameI18n, fallbackName)
  );
}

function serializeCard(row) {
  const energyCost = Number(row.energy_cost ?? row.elixir_cost ?? 0);
  const energyCostType =
    row.type === 'equipment'
      ? 'money'
      : normalizeEnergyCostType(
          row.energy_cost_type,
          row.type === 'spell' ? 'spirit' : 'physical'
        );
  const nameI18n = parseNameI18n(row.name_i18n);
  const fallbackName = String(row.name ?? '').trim();
  const imageVersion = Number(row.image_version || 0);
  return {
    id: row.id,
    name: firstAvailableName(nameI18n, fallbackName),
    nameI18n,
    nameZhHant: localizedName(
      {
        'zh-Hant': row.name_zh_hant || nameI18n['zh-Hant'],
        en: nameI18n.en,
        ja: nameI18n.ja
      },
      'zh-Hant',
      fallbackName
    ),
    nameEn: localizedName(
      {
        en: row.name_en || nameI18n.en,
        'zh-Hant': nameI18n['zh-Hant'],
        ja: nameI18n.ja
      },
      'en',
      fallbackName
    ),
    nameJa: localizedName(
      {
        ja: row.name_ja || nameI18n.ja,
        en: nameI18n.en,
        'zh-Hant': nameI18n['zh-Hant']
      },
      'ja',
      fallbackName
    ),
    energyCost,
    energyCostType,
    type: row.type,
    hp: Number(row.hp),
    damage: Number(row.damage),
    attackRange: Math.round(Number(row.attack_range)),
    bodyRadius: Math.round(Number(row.body_radius || 0)),
    moveSpeed: Math.round(Number(row.move_speed)),
    attackSpeed: Number(row.attack_speed),
    spawnCount: Number(row.spawn_count),
    spellRadius: Math.round(Number(row.spell_radius)),
    spellDamage: Number(row.spell_damage),
    targetRule: row.target_rule,
    effectKind: row.effect_kind || 'none',
    effectValue: Number(row.effect_value || 0),
    imageVersion,
    imageUrl: cardImageUrl(row.id, imageVersion)
  };
}

function cardImageUrl(cardId, imageVersion) {
  const version = Number(imageVersion || 0);
  return version > 0
    ? `/card-images/${encodeURIComponent(cardId)}?v=${version}`
    : null;
}

function cardImageKey(cardId) {
  return `card-image:${cardId}`;
}

function cardImageMetaKey(cardId) {
  return `card-image-meta:${cardId}`;
}

async function fetchCardRow(env, cardId) {
  return env.DB.prepare(
    `${CARD_SELECT_COLUMNS}
     WHERE id = ?`
  )
    .bind(cardId)
    .first();
}

async function fetchCardById(env, cardId) {
  const row = await fetchCardRow(env, cardId);
  return row ? serializeCard(row) : null;
}

function starterCardNameI18n(card) {
  return JSON.stringify(card.nameI18n ?? {
    'zh-Hant': card.nameZhHant,
    en: card.nameEn,
    ja: card.nameJa
  });
}

function normalizeCardPayload(payload) {
  const id = String(payload?.id ?? '').trim();
  const nameI18n = parseNameI18n(payload?.nameI18n);
  const legacyName = String(payload?.name ?? '').trim();
  const nameZhHant = String(
    payload?.nameZhHant ?? nameI18n['zh-Hant'] ?? legacyName
  ).trim();
  const nameEn = String(payload?.nameEn ?? nameI18n.en ?? '').trim();
  const nameJa = String(payload?.nameJa ?? nameI18n.ja ?? '').trim();
  const mergedNameI18n = parseNameI18n({
    ...nameI18n,
    'zh-Hant': nameZhHant,
    en: nameEn,
    ja: nameJa
  });
  const name = firstAvailableName(mergedNameI18n, legacyName);
  const type = String(payload?.type ?? '').trim();
  const targetRule = String(payload?.targetRule ?? '').trim();
  const effectKind = String(payload?.effectKind ?? 'none').trim() || 'none';

  const card = normalizeCardDefinition({
    id,
    name,
    nameI18n: mergedNameI18n,
    nameZhHant,
    nameEn,
    nameJa,
    energyCost: Number(payload?.energyCost ?? payload?.elixirCost ?? 0),
    energyCostType: normalizeEnergyCostType(
      payload?.energyCostType,
      type === 'equipment' ? 'money' : type === 'spell' ? 'spirit' : 'physical'
    ),
    type,
    hp: Number(payload?.hp ?? 0),
    damage: Number(payload?.damage ?? 0),
    attackRange: Math.round(Number(payload?.attackRange ?? 0)),
    bodyRadius: Math.round(Number(payload?.bodyRadius ?? 0)),
    moveSpeed: Math.round(Number(payload?.moveSpeed ?? 0)),
    attackSpeed: Number(payload?.attackSpeed ?? 0),
    spawnCount: Number(payload?.spawnCount ?? 1),
    spellRadius: Math.round(Number(payload?.spellRadius ?? 0)),
    spellDamage: Number(payload?.spellDamage ?? 0),
    targetRule,
    effectKind,
    effectValue: Number(payload?.effectValue ?? 0)
  });

  if (!card.id) {
    throw new Error('Card id is required');
  }
  if (!/^[a-z0-9_]+$/i.test(card.id)) {
    throw new Error('Card id must be alphanumeric or underscore');
  }
  if (!card.name) {
    throw new Error('At least one localized card name is required');
  }
  if (!card.type) {
    throw new Error('Card type is required');
  }
  if (!card.targetRule) {
    throw new Error('targetRule is required');
  }

  for (const [field, value] of Object.entries(card)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${field} must be a valid number`);
    }
  }

  return card;
}

function normalizeCardId(cardId) {
  const normalized = String(cardId ?? '').trim();
  if (!normalized) {
    throw new Error('Card id is required');
  }
  return normalized;
}

async function countRows(env, sql, ...bindings) {
  const row = await env.DB.prepare(sql)
    .bind(...bindings)
    .first();
  return Number(row?.count || 0);
}

async function cardExists(env, cardId) {
  const existing = await env.DB.prepare('SELECT id FROM cards WHERE id = ?')
    .bind(cardId)
    .first();
  return Boolean(existing);
}

function serializeDeckRow(deckRow, cards) {
  return {
    id: Number(deckRow.id),
    name: deckRow.name,
    slot: Number(deckRow.slot),
    updatedAt: deckRow.updated_at,
    cards
  };
}

function bindableCardNameI18n(card) {
  return JSON.stringify(card.nameI18n);
}

function cardWriteBindings(card) {
  return [
    card.id,
    card.name,
    card.energyCost,
    card.energyCost,
    card.energyCostType,
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
    card.effectValue,
    card.bodyRadius,
    card.nameZhHant,
    card.nameEn,
    card.nameJa,
    bindableCardNameI18n(card)
  ];
}

async function insertStarterCards(env) {
  for (const card of starterCards) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO cards (${CARD_WRITE_COLUMNS})
       VALUES (${CARD_WRITE_PLACEHOLDERS})`
    ).bind(
      ...cardWriteBindings({
        ...card,
        nameI18n: parseNameI18n(starterCardNameI18n(card))
      })
    ).run();
  }
}

export async function ensureCardsSeeded(env) {
  await insertStarterCards(env);
}

export async function listCards(env) {
  await ensureCardsSeeded(env);
  const rows = await env.DB.prepare(
    `${CARD_SELECT_COLUMNS}
     ORDER BY energy_cost ASC, name ASC`
  ).all();
  return rows.results.map(serializeCard);
}

export async function upsertCard(env, payload) {
  await ensureCardsSeeded(env);
  const card = normalizeCardPayload(payload);

  await env.DB.prepare(
    `INSERT INTO cards (${CARD_WRITE_COLUMNS})
    VALUES (${CARD_WRITE_PLACEHOLDERS})
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      elixir_cost = excluded.elixir_cost,
      energy_cost = excluded.energy_cost,
      energy_cost_type = excluded.energy_cost_type,
      type = excluded.type,
      hp = excluded.hp,
      damage = excluded.damage,
      attack_range = excluded.attack_range,
      move_speed = excluded.move_speed,
      attack_speed = excluded.attack_speed,
      spawn_count = excluded.spawn_count,
      spell_radius = excluded.spell_radius,
      spell_damage = excluded.spell_damage,
      target_rule = excluded.target_rule,
      effect_kind = excluded.effect_kind,
      effect_value = excluded.effect_value,
      body_radius = excluded.body_radius,
      name_zh_hant = excluded.name_zh_hant,
      name_en = excluded.name_en,
      name_ja = excluded.name_ja,
      name_i18n = excluded.name_i18n`
  )
    .bind(...cardWriteBindings(card))
    .run();

  return fetchCardById(env, card.id);
}

export async function deleteCard(env, cardId) {
  await ensureCardsSeeded(env);
  const normalizedCardId = normalizeCardId(cardId);

  if (
    (await countRows(
      env,
      'SELECT COUNT(*) AS count FROM user_deck_cards WHERE card_id = ?',
      normalizedCardId
    )) > 0
  ) {
    throw new Error('Card is currently used in decks and cannot be deleted');
  }

  await env.DB.prepare('DELETE FROM cards WHERE id = ?')
    .bind(normalizedCardId)
    .run();

  await env.STATIC_ASSETS?.delete?.(`card-image:${normalizedCardId}`);
  await env.STATIC_ASSETS?.delete?.(`card-image-meta:${normalizedCardId}`);
}

function decodeBase64(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function allowedImageContentType(contentType) {
  const normalized = String(contentType ?? '').trim().toLowerCase();
  return [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ].includes(normalized)
    ? normalized
    : null;
}

export async function uploadCardImage(env, cardId, payload) {
  const normalizedCardId = normalizeCardId(cardId);

  if (!(await cardExists(env, normalizedCardId))) {
    throw new Error('Card not found');
  }

  const contentType = allowedImageContentType(payload?.contentType);
  if (!contentType) {
    throw new Error('Only PNG, JPEG, WEBP, and GIF images are supported');
  }

  const bytes = decodeBase64(payload?.bytesBase64);
  if (!bytes || !bytes.length) {
    throw new Error('Image data is required');
  }
  if (bytes.length > MAX_CARD_IMAGE_BYTES) {
    throw new Error('Image must be 1 MB or smaller');
  }

  const imageKey = cardImageKey(normalizedCardId);
  const metaKey = cardImageMetaKey(normalizedCardId);
  await env.STATIC_ASSETS.put(imageKey, bytes);
  await env.STATIC_ASSETS.put(
    metaKey,
    JSON.stringify({
      contentType,
      uploadedAt: new Date().toISOString()
    })
  );

  const imageVersion = Date.now();
  await env.DB.prepare('UPDATE cards SET image_version = ? WHERE id = ?')
    .bind(imageVersion, normalizedCardId)
    .run();

  return fetchCardById(env, normalizedCardId);
}

export async function removeCardImage(env, cardId) {
  const normalizedCardId = normalizeCardId(cardId);

  await env.STATIC_ASSETS?.delete?.(cardImageKey(normalizedCardId));
  await env.STATIC_ASSETS?.delete?.(cardImageMetaKey(normalizedCardId));
  await env.DB.prepare('UPDATE cards SET image_version = 0 WHERE id = ?')
    .bind(normalizedCardId)
    .run();

  return fetchCardById(env, normalizedCardId);
}

export async function getCardImageResponse(env, cardId) {
  const normalizedCardId = String(cardId ?? '').trim();
  if (!normalizedCardId) {
    return null;
  }

  const imageKey = cardImageKey(normalizedCardId);
  const metaKey = cardImageMetaKey(normalizedCardId);
  const [bytes, metaRaw] = await Promise.all([
    env.STATIC_ASSETS.get(imageKey, 'arrayBuffer'),
    env.STATIC_ASSETS.get(metaKey)
  ]);
  if (!bytes) {
    return null;
  }

  let contentType = 'application/octet-stream';
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw);
      if (typeof meta?.contentType === 'string' && meta.contentType) {
        contentType = meta.contentType;
      }
    } catch (_) {
      // ignore invalid metadata and serve with fallback content type
    }
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
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
  if (
    !(await countRows(
      env,
      'SELECT COUNT(*) AS count FROM user_decks WHERE user_id = ?',
      userId
    ))
  ) {
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
    results.push(
      serializeDeckRow(
        deckRow,
        await loadDeckCards(deckRow.id, cardMap, env)
      )
    );
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
  return serializeDeckRow(deck, await loadDeckCards(deck.id, cardMap, env));
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
