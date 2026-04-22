import {
  defaultDeckCardIds,
  normalizeCardDefinition,
  normalizeEnergyCostType,
  starterCards
} from './royale_cards.js';

const MAX_CARD_IMAGE_BYTES = 1024 * 1024;
const CARD_CHARACTER_IMAGE_DIRECTIONS = ['front', 'back', 'left', 'right'];
const CARD_CHARACTER_ANIMATION_FALLBACK = 'idle';
const MAX_CHARACTER_ASSETS_PER_CARD = 80;
const CARD_SELECT_COLUMNS = `SELECT id, name, elixir_cost, energy_cost, energy_cost_type, type, hp, damage, attack_range, move_speed,
        attack_speed, spawn_count, spell_radius, spell_damage, target_rule,
        effect_kind, effect_value, body_radius, name_zh_hant, name_en, name_ja,
        name_i18n, image_version, char_image_version, char_image_back_version,
        char_image_left_version, char_image_right_version, bg_image_version
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

function serializeCard(row, characterAssets = []) {
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
  const charImageVersion = Number(row.char_image_version || 0);
  const charImageBackVersion = Number(row.char_image_back_version || 0);
  const charImageLeftVersion = Number(row.char_image_left_version || 0);
  const charImageRightVersion = Number(row.char_image_right_version || 0);
  const bgImageVersion = Number(row.bg_image_version || 0);
  const characterFrontImageUrl = cardCharacterImageUrl(
    row.id,
    charImageVersion,
    'front'
  );
  const characterBackImageUrl = cardCharacterImageUrl(
    row.id,
    charImageBackVersion,
    'back'
  );
  const characterLeftImageUrl = cardCharacterImageUrl(
    row.id,
    charImageLeftVersion,
    'left'
  );
  const characterRightImageUrl = cardCharacterImageUrl(
    row.id,
    charImageRightVersion,
    'right'
  );
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
    imageUrl: characterFrontImageUrl,
    characterImageUrl: characterFrontImageUrl,
    characterFrontImageUrl,
    characterBackImageUrl,
    characterLeftImageUrl,
    characterRightImageUrl,
    characterImageUrls: {
      front: characterFrontImageUrl,
      back: characterBackImageUrl,
      left: characterLeftImageUrl,
      right: characterRightImageUrl
    },
    characterAssets,
    bgImageUrl: cardBgImageUrl(row.id, bgImageVersion),
    charImageVersion,
    charImageBackVersion,
    charImageLeftVersion,
    charImageRightVersion,
    bgImageVersion
  };
}

function cardImageUrl(cardId, imageVersion) {
  const version = Number(imageVersion || 0);
  return version > 0
    ? `/card-images/${encodeURIComponent(cardId)}?v=${version}`
    : null;
}

function cardCharacterImageUrl(cardId, charImageVersion, direction = 'front') {
  const version = Number(charImageVersion || 0);
  return version > 0
    ? `/card-character-images/${encodeURIComponent(cardId)}/${normalizeCharacterImageDirection(
        direction
      )}?v=${version}`
    : null;
}

function cardBgImageUrl(cardId, bgImageVersion) {
  const version = Number(bgImageVersion || 0);
  return version > 0
    ? `/card-bg-images/${encodeURIComponent(cardId)}?v=${version}`
    : null;
}

function cardImageKey(cardId) {
  return `card-image:${cardId}`;
}

function cardImageMetaKey(cardId) {
  return `card-image-meta:${cardId}`;
}

function normalizeCharacterImageDirection(direction = 'front') {
  const normalized = String(direction ?? 'front').trim().toLowerCase();
  if (CARD_CHARACTER_IMAGE_DIRECTIONS.includes(normalized)) {
    return normalized;
  }
  throw new Error(
    'Character image direction must be front, back, left, or right'
  );
}

function cardCharImageVersionColumn(direction = 'front') {
  switch (normalizeCharacterImageDirection(direction)) {
    case 'front':
      return 'char_image_version';
    case 'back':
      return 'char_image_back_version';
    case 'left':
      return 'char_image_left_version';
    case 'right':
      return 'char_image_right_version';
    default:
      throw new Error(
        'Character image direction must be front, back, left, or right'
      );
  }
}

function cardCharImageKey(cardId, direction = 'front') {
  const normalizedDirection = normalizeCharacterImageDirection(direction);
  return normalizedDirection === 'front'
    ? `card-char-image:${cardId}`
    : `card-char-image:${cardId}:${normalizedDirection}`;
}

function cardCharImageMetaKey(cardId, direction = 'front') {
  const normalizedDirection = normalizeCharacterImageDirection(direction);
  return normalizedDirection === 'front'
    ? `card-char-image-meta:${cardId}`
    : `card-char-image-meta:${cardId}:${normalizedDirection}`;
}

function normalizeCharacterAssetId(assetId) {
  const normalized = String(assetId ?? '').trim();
  if (!normalized) {
    throw new Error('Character asset id is required');
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalized)) {
    throw new Error(
      'Character asset id must be 1-64 letters, numbers, underscores, or dashes'
    );
  }
  return normalized;
}

function normalizeCharacterAssetToken(value, fallback) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalized)) {
    throw new Error(
      'Character asset animation and direction must be 1-32 letters, numbers, underscores, or dashes'
    );
  }
  return normalized;
}

function normalizeCharacterAssetDirection(direction) {
  const normalized = normalizeCharacterAssetToken(direction, 'front');
  if (CARD_CHARACTER_IMAGE_DIRECTIONS.includes(normalized)) {
    return normalized;
  }
  throw new Error('Character asset direction must be front, back, left, or right');
}

function normalizeCharacterAssetMetadata(payload = {}) {
  const frameIndex = Math.max(
    0,
    Math.min(999, Math.round(Number(payload.frameIndex ?? 0)))
  );
  const durationMs = Math.max(
    33,
    Math.min(5000, Math.round(Number(payload.durationMs ?? 120)))
  );
  return {
    animation: normalizeCharacterAssetToken(
      payload.animation,
      CARD_CHARACTER_ANIMATION_FALLBACK
    ),
    direction: normalizeCharacterAssetDirection(payload.direction),
    frameIndex,
    durationMs,
    loop: payload.loop === false ? 0 : 1
  };
}

function cardCharacterAssetVersion(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate()
  )}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds()
  )}${pad(date.getUTCMilliseconds(), 3)}`;
}

function cardCharacterAssetImageUrl(cardId, assetId, assetVersion) {
  const version = String(assetVersion ?? '').trim();
  return version
    ? `/card-character-assets/${encodeURIComponent(cardId)}/${encodeURIComponent(
        assetId
      )}?v=${encodeURIComponent(version)}`
    : null;
}

function cardCharacterAssetKey(cardId, assetId) {
  return `card-character-asset:${cardId}:${assetId}`;
}

function cardCharacterAssetMetaKey(cardId, assetId) {
  return `card-character-asset-meta:${cardId}:${assetId}`;
}

function cardBgImageKey(cardId) {
  return `card-bg-image:${cardId}`;
}

function cardBgImageMetaKey(cardId) {
  return `card-bg-image-meta:${cardId}`;
}

function serializeCharacterAsset(row) {
  return {
    assetId: row.asset_id,
    animation: row.animation || CARD_CHARACTER_ANIMATION_FALLBACK,
    direction: row.direction || 'front',
    frameIndex: Number(row.frame_index || 0),
    durationMs: Number(row.duration_ms || 120),
    loop: Boolean(Number(row.loop ?? 1)),
    imageVersion: Number(row.image_version || 0),
    assetVersion:
      String(row.asset_version || '').trim() || String(row.image_version || ''),
    cardId: row.card_id,
    fileName: row.file_name || null,
    contentType: row.content_type || null,
    imageUrl: cardCharacterAssetImageUrl(
      row.card_id,
      row.asset_id,
      String(row.asset_version || '').trim() || row.image_version
    )
  };
}

async function listCardCharacterAssetRows(env, cardId = null) {
  if (cardId) {
    const rows = await env.DB.prepare(
      `SELECT card_id, asset_id, animation, direction, frame_index, duration_ms,
              loop, image_version, asset_version, file_name, content_type
       FROM card_character_assets
       WHERE card_id = ?
       ORDER BY animation ASC, direction ASC, frame_index ASC, asset_id ASC`
    )
      .bind(cardId)
      .all();
    return rows.results || [];
  }

  const rows = await env.DB.prepare(
    `SELECT card_id, asset_id, animation, direction, frame_index, duration_ms,
            loop, image_version, asset_version, file_name, content_type
     FROM card_character_assets
     ORDER BY card_id ASC, animation ASC, direction ASC, frame_index ASC,
              asset_id ASC`
  ).all();
  return rows.results || [];
}

async function characterAssetsByCardId(env, cardIds) {
  if (!cardIds.length) {
    return new Map();
  }

  const placeholders = cardIds.map(() => '?').join(', ');
  const assetRows = await env.DB.prepare(
    `SELECT card_id, asset_id, animation, direction, frame_index, duration_ms,
            loop, image_version, asset_version, file_name, content_type
     FROM card_character_assets
     WHERE card_id IN (${placeholders})
     ORDER BY card_id ASC, animation ASC, direction ASC, frame_index ASC,
              asset_id ASC`
  )
    .bind(...cardIds)
    .all();
  const rows = assetRows.results || [];
  const cardIdSet = new Set(cardIds);
  const assetsByCardId = new Map();
  for (const row of rows) {
    if (!cardIdSet.has(row.card_id)) {
      continue;
    }
    const assets = assetsByCardId.get(row.card_id) || [];
    assets.push(serializeCharacterAsset(row));
    assetsByCardId.set(row.card_id, assets);
  }
  return assetsByCardId;
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
  if (!row) {
    return null;
  }
  const assets = (await listCardCharacterAssetRows(env, cardId)).map(
    serializeCharacterAsset
  );
  return serializeCard(row, assets);
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
  const cardRows = rows.results || [];
  const assetsByCardId = await characterAssetsByCardId(
    env,
    cardRows.map((row) => row.id)
  );
  return cardRows.map((row) =>
    serializeCard(row, assetsByCardId.get(row.id) || [])
  );
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

  const characterAssets = await listCardCharacterAssetRows(env, normalizedCardId);
  for (const asset of characterAssets) {
    await env.STATIC_ASSETS?.delete?.(
      cardCharacterAssetKey(normalizedCardId, asset.asset_id)
    );
    await env.STATIC_ASSETS?.delete?.(
      cardCharacterAssetMetaKey(normalizedCardId, asset.asset_id)
    );
  }
  await env.DB.prepare('DELETE FROM card_character_assets WHERE card_id = ?')
    .bind(normalizedCardId)
    .run();

  await env.DB.prepare('DELETE FROM cards WHERE id = ?')
    .bind(normalizedCardId)
    .run();

  await env.STATIC_ASSETS?.delete?.(`card-image:${normalizedCardId}`);
  await env.STATIC_ASSETS?.delete?.(`card-image-meta:${normalizedCardId}`);
  for (const direction of CARD_CHARACTER_IMAGE_DIRECTIONS) {
    await env.STATIC_ASSETS?.delete?.(
      cardCharImageKey(normalizedCardId, direction)
    );
    await env.STATIC_ASSETS?.delete?.(
      cardCharImageMetaKey(normalizedCardId, direction)
    );
  }
  await env.STATIC_ASSETS?.delete?.(cardBgImageKey(normalizedCardId));
  await env.STATIC_ASSETS?.delete?.(cardBgImageMetaKey(normalizedCardId));
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

async function _uploadCardLayerImage(
  env,
  normalizedCardId,
  payload,
  imageKey,
  metaKey,
  versionColumn
) {
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

  await env.STATIC_ASSETS.put(imageKey, bytes);
  await env.STATIC_ASSETS.put(
    metaKey,
    JSON.stringify({
      contentType,
      uploadedAt: new Date().toISOString()
    })
  );

  const imageVersion = Date.now();
  await env.DB.prepare(`UPDATE cards SET ${versionColumn} = ? WHERE id = ?`)
    .bind(imageVersion, normalizedCardId)
    .run();

  return fetchCardById(env, normalizedCardId);
}

async function _getCardLayerImageResponse(env, cardId, imageKey, metaKey) {
  const normalizedCardId = String(cardId ?? '').trim();
  if (!normalizedCardId) {
    return null;
  }

  const [bytes, metaRaw] = await Promise.all([
    env.STATIC_ASSETS.get(imageKey(normalizedCardId), 'arrayBuffer'),
    env.STATIC_ASSETS.get(metaKey(normalizedCardId))
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
      // ignore invalid metadata
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

export async function uploadCardCharacterImage(
  env,
  cardId,
  payload,
  direction = 'front'
) {
  const normalizedCardId = normalizeCardId(cardId);
  const normalizedDirection = normalizeCharacterImageDirection(direction);
  if (!(await cardExists(env, normalizedCardId))) {
    throw new Error('Card not found');
  }
  return _uploadCardLayerImage(
    env,
    normalizedCardId,
    payload,
    cardCharImageKey(normalizedCardId, normalizedDirection),
    cardCharImageMetaKey(normalizedCardId, normalizedDirection),
    cardCharImageVersionColumn(normalizedDirection)
  );
}

export async function removeCardCharacterImage(env, cardId, direction = 'front') {
  const normalizedCardId = normalizeCardId(cardId);
  const normalizedDirection = normalizeCharacterImageDirection(direction);
  await env.STATIC_ASSETS?.delete?.(
    cardCharImageKey(normalizedCardId, normalizedDirection)
  );
  await env.STATIC_ASSETS?.delete?.(
    cardCharImageMetaKey(normalizedCardId, normalizedDirection)
  );
  await env.DB.prepare(
    `UPDATE cards SET ${cardCharImageVersionColumn(
      normalizedDirection
    )} = 0 WHERE id = ?`
  )
    .bind(normalizedCardId)
    .run();
  return fetchCardById(env, normalizedCardId);
}

export async function getCardCharacterImageResponse(env, cardId, direction = 'front') {
  const normalizedDirection = normalizeCharacterImageDirection(direction);
  return _getCardLayerImageResponse(
    env,
    cardId,
    (normalizedCardId) => cardCharImageKey(normalizedCardId, normalizedDirection),
    (normalizedCardId) => cardCharImageMetaKey(normalizedCardId, normalizedDirection)
  );
}

export async function uploadCardCharacterAsset(env, cardId, assetId, payload) {
  const normalizedCardId = normalizeCardId(cardId);
  const normalizedAssetId = normalizeCharacterAssetId(assetId);
  if (!(await cardExists(env, normalizedCardId))) {
    throw new Error('Card not found');
  }

  const existingAsset = await env.DB.prepare(
    'SELECT asset_id FROM card_character_assets WHERE card_id = ? AND asset_id = ?'
  )
    .bind(normalizedCardId, normalizedAssetId)
    .first();
  if (!existingAsset) {
    const assetCount = await countRows(
      env,
      'SELECT COUNT(*) AS count FROM card_character_assets WHERE card_id = ?',
      normalizedCardId
    );
    if (assetCount >= MAX_CHARACTER_ASSETS_PER_CARD) {
      throw new Error(
        `A card can have at most ${MAX_CHARACTER_ASSETS_PER_CARD} character assets`
      );
    }
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

  const metadata = normalizeCharacterAssetMetadata(payload);
  const imageVersion = Date.now();
  const assetVersion = cardCharacterAssetVersion(new Date(imageVersion));
  await env.STATIC_ASSETS.put(
    cardCharacterAssetKey(normalizedCardId, normalizedAssetId),
    bytes
  );
  await env.STATIC_ASSETS.put(
    cardCharacterAssetMetaKey(normalizedCardId, normalizedAssetId),
    JSON.stringify({
      contentType,
      fileName: String(payload?.fileName ?? '').trim() || null,
      animation: metadata.animation,
      direction: metadata.direction,
      frameIndex: metadata.frameIndex,
      durationMs: metadata.durationMs,
      loop: Boolean(metadata.loop),
      assetVersion,
      uploadedAt: new Date().toISOString()
    })
  );

  await env.DB.prepare(
    `INSERT INTO card_character_assets (
       card_id, asset_id, animation, direction, frame_index, duration_ms,
       loop, image_version, asset_version, file_name, content_type, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(card_id, asset_id) DO UPDATE SET
       animation = excluded.animation,
       direction = excluded.direction,
       frame_index = excluded.frame_index,
       duration_ms = excluded.duration_ms,
       loop = excluded.loop,
       image_version = excluded.image_version,
       asset_version = excluded.asset_version,
       file_name = excluded.file_name,
       content_type = excluded.content_type,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      normalizedCardId,
      normalizedAssetId,
      metadata.animation,
      metadata.direction,
      metadata.frameIndex,
      metadata.durationMs,
      metadata.loop,
      imageVersion,
      assetVersion,
      String(payload?.fileName ?? '').trim() || null,
      contentType
    )
    .run();

  return fetchCardById(env, normalizedCardId);
}

export async function removeCardCharacterAsset(env, cardId, assetId) {
  const normalizedCardId = normalizeCardId(cardId);
  const normalizedAssetId = normalizeCharacterAssetId(assetId);
  await env.STATIC_ASSETS?.delete?.(
    cardCharacterAssetKey(normalizedCardId, normalizedAssetId)
  );
  await env.STATIC_ASSETS?.delete?.(
    cardCharacterAssetMetaKey(normalizedCardId, normalizedAssetId)
  );
  await env.DB.prepare(
    'DELETE FROM card_character_assets WHERE card_id = ? AND asset_id = ?'
  )
    .bind(normalizedCardId, normalizedAssetId)
    .run();

  return fetchCardById(env, normalizedCardId);
}

export async function getCardCharacterAssetResponse(env, cardId, assetId) {
  let normalizedAssetId;
  try {
    normalizedAssetId = normalizeCharacterAssetId(assetId);
  } catch (_) {
    return null;
  }
  return _getCardLayerImageResponse(
    env,
    cardId,
    (normalizedCardId) => cardCharacterAssetKey(normalizedCardId, normalizedAssetId),
    (normalizedCardId) =>
      cardCharacterAssetMetaKey(normalizedCardId, normalizedAssetId)
  );
}

export async function uploadCardBgImage(env, cardId, payload) {
  const normalizedCardId = normalizeCardId(cardId);
  if (!(await cardExists(env, normalizedCardId))) {
    throw new Error('Card not found');
  }
  return _uploadCardLayerImage(
    env,
    normalizedCardId,
    payload,
    cardBgImageKey(normalizedCardId),
    cardBgImageMetaKey(normalizedCardId),
    'bg_image_version'
  );
}

export async function removeCardBgImage(env, cardId) {
  const normalizedCardId = normalizeCardId(cardId);
  await env.STATIC_ASSETS?.delete?.(cardBgImageKey(normalizedCardId));
  await env.STATIC_ASSETS?.delete?.(cardBgImageMetaKey(normalizedCardId));
  await env.DB.prepare('UPDATE cards SET bg_image_version = 0 WHERE id = ?')
    .bind(normalizedCardId)
    .run();
  return fetchCardById(env, normalizedCardId);
}

export async function getCardBgImageResponse(env, cardId) {
  return _getCardLayerImageResponse(env, cardId, cardBgImageKey, cardBgImageMetaKey);
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
