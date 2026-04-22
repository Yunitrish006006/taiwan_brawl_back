import {
  cardUnlockAge,
  cardUnlockTier,
  isUnitCard
} from './royale_card_progression.js';

const MAX_HEALTH = 100;
const DAILY_HEALTH_REGEN = 6;

export const CHARACTER_ARCHETYPES = Object.freeze([
  {
    id: 'ordinary_child',
    name: 'Ordinary Child',
    nameZhHant: '普通小孩',
    nameEn: 'Ordinary Child',
    nameJa: '普通の子',
    descriptionZhHant: '沒有明顯偏科，適合第一次培養。',
    descriptionEn: 'Balanced starting point for the first life.',
    descriptionJa: '初回育成向けのバランス型。'
  },
  {
    id: 'street_smart',
    name: 'Street Smart',
    nameZhHant: '街頭小聰明',
    nameEn: 'Street Smart',
    nameJa: '街の知恵',
    descriptionZhHant: '較容易走向道具與生存路線。',
    descriptionEn: 'Leans toward item and survival paths.',
    descriptionJa: '道具と生存寄りの方向性。'
  },
  {
    id: 'study_grind',
    name: 'Study Grind',
    nameZhHant: '讀書苦行',
    nameEn: 'Study Grind',
    nameJa: '勉強漬け',
    descriptionZhHant: '較容易走向技能與事件路線。',
    descriptionEn: 'Leans toward skill and event paths.',
    descriptionJa: 'スキルとイベント寄りの方向性。'
  }
]);

export const DEFAULT_CHARACTER_ID = 'ordinary_child';

const CHARACTER_BY_ID = new Map(
  CHARACTER_ARCHETYPES.map((character) => [character.id, character])
);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseJsonObject(value, fallback = {}) {
  if (!value) {
    return { ...fallback };
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...fallback, ...value };
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...fallback, ...parsed }
      : { ...fallback };
  } catch (_) {
    return { ...fallback };
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}

export function normalizeCharacterArchetype(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return CHARACTER_BY_ID.has(candidate) ? candidate : DEFAULT_CHARACTER_ID;
}

function normalizeCharacterId(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_:-]{1,96}$/.test(candidate) ? candidate : DEFAULT_CHARACTER_ID;
}

function characterOptionIds(characterOptions = []) {
  return new Set(
    [
      ...CHARACTER_ARCHETYPES,
      ...characterOptions
    ].map((entry) => String(entry?.id || '').trim().toLowerCase()).filter(Boolean)
  );
}

function resolveCharacterId(value, characterOptions = null) {
  const candidate = normalizeCharacterId(value);
  if (!Array.isArray(characterOptions)) {
    return candidate;
  }
  return characterOptionIds(characterOptions).has(candidate)
    ? candidate
    : DEFAULT_CHARACTER_ID;
}

function cardCharacterOption(card) {
  const nameZhHant = card.nameZhHant || card.name || card.id;
  const nameEn = card.nameEn || card.name || card.id;
  const nameJa = card.nameJa || card.name || card.id;
  return {
    id: String(card.id),
    kind: 'unit_card',
    cardId: String(card.id),
    type: card.type,
    imageUrl: card.characterImageUrl || card.imageUrl || null,
    name: nameZhHant,
    nameZhHant,
    nameEn,
    nameJa,
    descriptionZhHant: `以「${nameZhHant}」作為這副牌組的培養角色。`,
    descriptionEn: `Use ${nameEn} as this deck's progression character.`,
    descriptionJa: `「${nameJa}」をこのデッキの育成キャラクターにします。`
  };
}

export function listCharacterArchetypes(cards = []) {
  const unitCardOptions = cards
    .filter((card) => card?.id && isUnitCard(card))
    .map(cardCharacterOption)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...CHARACTER_ARCHETYPES.map((character) => ({
      ...character,
      kind: 'archetype',
      cardId: null,
      imageUrl: null
    })),
    ...unitCardOptions
  ];
}

export function unlockedTiersForAge(age) {
  const normalizedAge = Math.max(0, Math.floor(Number(age) || 0));
  return {
    item: true,
    event: normalizedAge >= 3,
    skill: normalizedAge >= 5,
    unit: normalizedAge >= 8,
    teenUnit: normalizedAge >= 14,
    job: normalizedAge >= 16
  };
}

export function cardLockState(card, age) {
  const unlockAge = cardUnlockAge(card);
  return {
    unlockAge,
    unlockTier: cardUnlockTier(card),
    locked: Math.max(0, Math.floor(Number(age) || 0)) < unlockAge
  };
}

function startOptionsFromAchievements(achievements = {}) {
  const options = ['ordinary_child'];
  if (achievements.firstWin) options.push('balanced_start');
  if (achievements.age8) options.push('unit_focus');
  if (achievements.age16) options.push('worker_focus');
  if (achievements.rebirth1) options.push('second_life_bonus');
  return [...new Set(options)];
}

function serializeProgressionRow(row) {
  if (!row) {
    return null;
  }
  const achievements = parseJsonObject(row.achievements_json);
  const talentHistory = parseJsonObject(row.talent_history_json, {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    cardTypeCounts: {},
    cardIdCounts: {}
  });
  const age = Math.max(0, Math.floor(Number(row.age || 0)));
  return {
    deckId: Number(row.deck_id),
    userId: Number(row.user_id),
    characterId: normalizeCharacterId(row.character_id),
    age,
    health: Math.round(clamp(row.health, 0, MAX_HEALTH)),
    rebirthCount: Math.max(0, Math.floor(Number(row.rebirth_count || 0))),
    unlockedTiers: unlockedTiersForAge(age),
    unlockedStartOptions: startOptionsFromAchievements(achievements),
    achievements,
    talentHistory,
    lastHealthRegenAt: row.last_health_regen_at,
    lastRebirthAt: row.last_rebirth_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function deckCharacterRow(env, userId, deckId) {
  return env.DB.prepare(
    `SELECT deck_id, user_id, character_id, age, health, rebirth_count,
            talent_history_json, achievements_json, last_health_regen_at,
            last_rebirth_at, created_at, updated_at
     FROM user_deck_characters
     WHERE user_id = ? AND deck_id = ?`
  )
    .bind(userId, deckId)
    .first();
}

async function applyPassiveHealthRegen(env, row, now = new Date()) {
  if (!row) {
    return null;
  }
  const last = new Date(row.last_health_regen_at || row.updated_at || now);
  const elapsedDays = Math.max(0, (now.getTime() - last.getTime()) / 86400000);
  const healAmount = Math.floor(elapsedDays * DAILY_HEALTH_REGEN);
  if (healAmount <= 0 || Number(row.health || 0) >= MAX_HEALTH) {
    return row;
  }
  const nextHealth = Math.round(clamp(Number(row.health || 0) + healAmount, 0, MAX_HEALTH));
  await env.DB.prepare(
    `UPDATE user_deck_characters
     SET health = ?, last_health_regen_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND deck_id = ?`
  )
    .bind(nextHealth, now.toISOString(), row.user_id, row.deck_id)
    .run();
  return {
    ...row,
    health: nextHealth,
    last_health_regen_at: now.toISOString()
  };
}

export async function ensureDeckCharacter(
  env,
  userId,
  deckId,
  characterId = DEFAULT_CHARACTER_ID,
  characterOptions = null
) {
  const normalizedCharacter = resolveCharacterId(characterId, characterOptions);
  let row = await deckCharacterRow(env, userId, deckId);
  if (!row) {
    await env.DB.prepare(
      `INSERT INTO user_deck_characters (
        deck_id, user_id, character_id, age, health, rebirth_count,
        talent_history_json, achievements_json, last_health_regen_at
      ) VALUES (?, ?, ?, 0, ?, 0, '{}', '{}', CURRENT_TIMESTAMP)`
    )
      .bind(deckId, userId, normalizedCharacter, MAX_HEALTH)
      .run();
    row = await deckCharacterRow(env, userId, deckId);
  }
  return serializeProgressionRow(await applyPassiveHealthRegen(env, row));
}

export async function selectDeckCharacter(
  env,
  userId,
  deckId,
  characterId,
  characterOptions = []
) {
  const existing = await deckCharacterRow(env, userId, deckId);
  if (existing && (Number(existing.age || 0) > 0 || Number(existing.rebirth_count || 0) > 0)) {
    throw new Error('Initial character can only be changed before progression starts');
  }
  const normalizedCharacter = resolveCharacterId(characterId, characterOptions);
  if (normalizedCharacter !== normalizeCharacterId(characterId)) {
    throw new Error('Unknown deck character');
  }
  await ensureDeckCharacter(env, userId, deckId, normalizedCharacter, characterOptions);
  await env.DB.prepare(
    `UPDATE user_deck_characters
     SET character_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND deck_id = ?`
  )
    .bind(normalizedCharacter, userId, deckId)
    .run();
  return getDeckCharacter(env, userId, deckId);
}

export async function getDeckCharacter(env, userId, deckId) {
  return ensureDeckCharacter(env, userId, deckId);
}

export async function listDeckCharactersForUser(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT d.id AS deck_id, d.user_id AS user_id,
            COALESCE(c.character_id, 'ordinary_child') AS character_id,
            COALESCE(c.age, 0) AS age,
            COALESCE(c.health, ?) AS health,
            COALESCE(c.rebirth_count, 0) AS rebirth_count,
            COALESCE(c.talent_history_json, '{}') AS talent_history_json,
            COALESCE(c.achievements_json, '{}') AS achievements_json,
            COALESCE(c.last_health_regen_at, CURRENT_TIMESTAMP) AS last_health_regen_at,
            c.last_rebirth_at AS last_rebirth_at,
            COALESCE(c.created_at, d.created_at) AS created_at,
            COALESCE(c.updated_at, d.updated_at) AS updated_at
     FROM user_decks d
     LEFT JOIN user_deck_characters c ON c.deck_id = d.id AND c.user_id = d.user_id
     WHERE d.user_id = ?
     ORDER BY d.slot ASC, d.id ASC`
  )
    .bind(MAX_HEALTH, userId)
    .all();
  return (rows.results || []).map(serializeProgressionRow);
}

function ageGainForResult({ won, draw, ownHp, enemyHp, maxHp }) {
  if (draw) {
    return 1;
  }
  if (!won) {
    return 0;
  }
  const marginRatio = maxHp > 0 ? (ownHp - enemyHp) / maxHp : 0;
  if (marginRatio >= 0.65) return 3;
  if (marginRatio >= 0.3) return 2;
  return 1;
}

function healthLossForResult({ won, draw, reason, ownHp, maxHp }) {
  if (won || draw) {
    return 0;
  }
  const remainingRatio = maxHp > 0 ? ownHp / maxHp : 0;
  const towerDamagePenalty = Math.round((1 - remainingRatio) * 18);
  return (reason === 'disconnect' ? 25 : 14) + towerDamagePenalty;
}

function updateAchievements(achievements, nextAge, result, rebirthCount) {
  const next = { ...achievements };
  if (result.won) next.firstWin = true;
  if (nextAge >= 3) next.age3 = true;
  if (nextAge >= 5) next.age5 = true;
  if (nextAge >= 8) next.age8 = true;
  if (nextAge >= 14) next.age14 = true;
  if (nextAge >= 16) next.age16 = true;
  if (rebirthCount >= 1) next.rebirth1 = true;
  return next;
}

function updateTalentHistory(talentHistory, player, battlePlayer, result) {
  const next = parseJsonObject(talentHistory, {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    cardTypeCounts: {},
    cardIdCounts: {}
  });
  next.matches = Math.max(0, Math.floor(Number(next.matches || 0))) + 1;
  if (result.draw) next.draws = Math.max(0, Math.floor(Number(next.draws || 0))) + 1;
  else if (result.won) next.wins = Math.max(0, Math.floor(Number(next.wins || 0))) + 1;
  else next.losses = Math.max(0, Math.floor(Number(next.losses || 0))) + 1;

  const cardUses = battlePlayer?.cardUses || {};
  const cardById = new Map((player.deckCards || []).map((card) => [card.id, card]));
  next.cardTypeCounts = parseJsonObject(next.cardTypeCounts);
  next.cardIdCounts = parseJsonObject(next.cardIdCounts);
  for (const [cardId, rawCount] of Object.entries(cardUses)) {
    const count = Math.max(0, Math.floor(Number(rawCount || 0)));
    if (count <= 0) {
      continue;
    }
    const card = cardById.get(cardId);
    const type = String(card?.type || 'unknown');
    next.cardTypeCounts[type] = Math.max(0, Math.floor(Number(next.cardTypeCounts[type] || 0))) + count;
    next.cardIdCounts[cardId] = Math.max(0, Math.floor(Number(next.cardIdCounts[cardId] || 0))) + count;
  }
  next.lastDeckCardIds = (player.deckCardIds || []).slice();
  return next;
}

export async function applyMatchProgression(env, { room, winnerSide, reason }) {
  if (!env?.DB || !room?.battle) {
    return [];
  }

  const results = [];
  const now = new Date();
  for (const [side, player] of Object.entries(room.players || {})) {
    if (!player || player.isBot || !player.deckId) {
      continue;
    }
    const battlePlayer = room.battle.players?.[side];
    const enemySide = side === 'left' ? 'right' : 'left';
    const enemyBattlePlayer = room.battle.players?.[enemySide];
    const ownHp = Math.max(0, Number(battlePlayer?.towerHp || 0));
    const enemyHp = Math.max(0, Number(enemyBattlePlayer?.towerHp || 0));
    const maxHp = Math.max(1, Number(battlePlayer?.maxTowerHp || battlePlayer?.towerHp || 1));
    const result = {
      won: winnerSide === side,
      draw: !winnerSide,
      reason,
      ownHp,
      enemyHp,
      maxHp
    };

    const current = await ensureDeckCharacter(
      env,
      Number(player.userId),
      Number(player.deckId),
      player.characterId
    );
    const ageDelta = ageGainForResult(result);
    const healthLoss = healthLossForResult(result);
    let nextAge = Math.max(0, Math.floor(Number(current.age || 0) + ageDelta));
    let nextHealth = Math.round(clamp(Number(current.health || MAX_HEALTH) - healthLoss, 0, MAX_HEALTH));
    let rebirthCount = Math.max(0, Math.floor(Number(current.rebirthCount || 0)));
    let lastRebirthAt = current.lastRebirthAt;
    let rebirthTriggered = false;

    if (nextHealth <= 0) {
      nextAge = 0;
      nextHealth = MAX_HEALTH;
      rebirthCount += 1;
      lastRebirthAt = now.toISOString();
      rebirthTriggered = true;
    }

    const talentHistory = updateTalentHistory(
      current.talentHistory,
      player,
      battlePlayer,
      result
    );
    const achievements = updateAchievements(
      current.achievements,
      nextAge,
      result,
      rebirthCount
    );

    await env.DB.prepare(
      `UPDATE user_deck_characters
       SET age = ?, health = ?, rebirth_count = ?, talent_history_json = ?,
           achievements_json = ?, last_health_regen_at = ?,
           last_rebirth_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND deck_id = ?`
    )
      .bind(
        nextAge,
        nextHealth,
        rebirthCount,
        stringifyJson(talentHistory),
        stringifyJson(achievements),
        now.toISOString(),
        lastRebirthAt,
        Number(player.userId),
        Number(player.deckId)
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO user_deck_character_events (
        id, deck_id, user_id, room_code, result, age_delta, health_delta,
        age_after, health_after, rebirth_triggered, card_uses_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
      .bind(
        crypto.randomUUID(),
        Number(player.deckId),
        Number(player.userId),
        room.code,
        result.draw ? 'draw' : result.won ? 'win' : 'loss',
        ageDelta,
        -healthLoss,
        nextAge,
        nextHealth,
        rebirthTriggered ? 1 : 0,
        stringifyJson(battlePlayer?.cardUses || {})
      )
      .run();

    results.push(await getDeckCharacter(env, Number(player.userId), Number(player.deckId)));
  }

  return results;
}
