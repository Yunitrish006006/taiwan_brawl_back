import {
  cardUnlockAge,
  cardUnlockTier
} from './royale_card_progression.js';
import {
  DEFAULT_HERO_ID,
  listHeroDefinitions,
  normalizeHeroId,
  registerUnitHeroDefinitions
} from './royale_heroes.js';

const MAX_HEALTH = 100;
const DAILY_HEALTH_REGEN = 6;

export const DEFAULT_PROGRESSION_HERO_ID = DEFAULT_HERO_ID;

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

export function normalizeProgressionHeroId(value) {
  const candidate = String(value || '').trim().toLowerCase();
  const normalizedHero = normalizeHeroId(candidate);
  if (normalizedHero !== DEFAULT_HERO_ID || candidate === DEFAULT_HERO_ID) {
    return normalizedHero;
  }
  if (/^[a-z0-9_:-]{1,96}$/.test(candidate)) {
    return candidate;
  }
  return DEFAULT_PROGRESSION_HERO_ID;
}

function normalizeProgressionHeroCandidate(value) {
  return normalizeProgressionHeroId(value);
}

function progressionHeroOptionIds(heroOptions = []) {
  return new Set(heroOptions.map((entry) => normalizeProgressionHeroId(entry?.id)).filter(Boolean));
}

function resolveProgressionHeroId(value, heroOptions = null) {
  const candidate = normalizeProgressionHeroCandidate(value);
  if (!Array.isArray(heroOptions)) {
    return candidate;
  }
  return progressionHeroOptionIds(heroOptions).has(candidate)
    ? candidate
    : DEFAULT_PROGRESSION_HERO_ID;
}

export function listProgressionHeroOptions(cards = []) {
  registerUnitHeroDefinitions(cards);
  const cardById = new Map(
    cards
      .filter((card) => card?.id)
      .map((card) => [String(card.id), card])
  );

  return listHeroDefinitions().map((hero) => {
    const linkedCard = hero.sourceCardId ? cardById.get(String(hero.sourceCardId)) : cardById.get(String(hero.id));
    return {
      id: String(hero.id),
      kind: hero.sourceKind === 'unit_card' ? 'unit_card' : 'hero',
      cardId: hero.sourceCardId || null,
      type: linkedCard?.type || 'hero',
      imageUrl:
        linkedCard?.characterImageUrl ||
        linkedCard?.imageUrl ||
        linkedCard?.characterFrontImageUrl ||
        null,
      name: hero.nameZhHant || hero.name,
      nameZhHant: hero.nameZhHant || hero.name,
      nameEn: hero.nameEn || hero.name,
      nameJa: hero.nameJa || hero.name,
      descriptionZhHant:
        hero.bonusSummaryZhHant || `以「${hero.nameZhHant || hero.name}」作為這副牌組的角色。`,
      descriptionEn:
        hero.bonusSummaryEn || `Use ${hero.nameEn || hero.name} as this deck character.`,
      descriptionJa:
        hero.bonusSummaryJa || `「${hero.nameJa || hero.name}」をこのデッキのキャラクターにします。`
    };
  });
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

export function lockedDeckCardsForAge(cards = [], age, allowedCardIds = []) {
  const allowedIds = new Set(
    Array.from(allowedCardIds || []).map((cardId) => String(cardId))
  );
  return cards
    .filter((card) => {
      const cardId = String(card?.id || '');
      return cardId && !allowedIds.has(cardId) && cardLockState(card, age).locked;
    })
    .map((card) => ({
      ...card,
      ...cardLockState(card, age)
    }));
}

export function assertDeckCardsUnlockedForAge(cards = [], age, allowedCardIds = []) {
  const lockedCards = lockedDeckCardsForAge(cards, age, allowedCardIds);
  if (!lockedCards.length) {
    return;
  }
  const normalizedAge = Math.max(0, Math.floor(Number(age) || 0));
  const lockedSummary = lockedCards
    .slice(0, 3)
    .map((card) => {
      const name = String(card.nameEn || card.name || card.id || 'Unknown card');
      return `${name} (age ${card.unlockAge})`;
    })
    .join(', ');
  const extraCount = lockedCards.length > 3 ? `, +${lockedCards.length - 3} more` : '';
  throw new Error(
    `Deck contains cards locked for age ${normalizedAge}: ${lockedSummary}${extraCount}`
  );
}

function startOptionsFromAchievements(achievements = {}) {
  const options = [DEFAULT_PROGRESSION_HERO_ID];
  if (achievements.firstWin) options.push('rich_heir');
  if (achievements.age8) options.push('low_income_household');
  if (achievements.age16) options.push('part_time_worker');
  if (achievements.rebirth1) options.push('ordinary_person');
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
    heroId: normalizeProgressionHeroId(row.character_id),
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

export async function ensureDeckProgressionHero(
  env,
  userId,
  deckId,
  heroId = DEFAULT_PROGRESSION_HERO_ID,
  heroOptions = null
) {
  const normalizedHeroId = normalizeProgressionHeroId(
    resolveProgressionHeroId(heroId, heroOptions)
  );
  let row = await deckCharacterRow(env, userId, deckId);
  if (!row) {
    await env.DB.prepare(
      `INSERT INTO user_deck_characters (
        deck_id, user_id, character_id, age, health, rebirth_count,
        talent_history_json, achievements_json, last_health_regen_at
      ) VALUES (?, ?, ?, 0, ?, 0, '{}', '{}', CURRENT_TIMESTAMP)`
    )
      .bind(deckId, userId, normalizedHeroId, MAX_HEALTH)
      .run();
    row = await deckCharacterRow(env, userId, deckId);
  }
  return serializeProgressionRow(await applyPassiveHealthRegen(env, row));
}

export async function selectDeckProgressionHero(
  env,
  userId,
  deckId,
  heroId,
  heroOptions = []
) {
  const existing = await deckCharacterRow(env, userId, deckId);
  if (existing && (Number(existing.age || 0) > 0 || Number(existing.rebirth_count || 0) > 0)) {
    throw new Error('Initial character can only be changed before progression starts');
  }
  const normalizedHeroId = normalizeProgressionHeroId(
    resolveProgressionHeroId(heroId, heroOptions)
  );
  if (normalizedHeroId !== normalizeProgressionHeroId(heroId)) {
    throw new Error('Unknown deck hero');
  }
  await ensureDeckProgressionHero(env, userId, deckId, normalizedHeroId, heroOptions);
  await env.DB.prepare(
    `UPDATE user_deck_characters
     SET character_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND deck_id = ?`
  )
    .bind(normalizedHeroId, userId, deckId)
    .run();
  return getDeckProgressionHero(env, userId, deckId);
}

export async function getDeckProgressionHero(env, userId, deckId) {
  return ensureDeckProgressionHero(env, userId, deckId);
}

export async function listDeckProgressionForUser(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT d.id AS deck_id, d.user_id AS user_id,
            COALESCE(c.character_id, ?) AS character_id,
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
    .bind(DEFAULT_PROGRESSION_HERO_ID, MAX_HEALTH, userId)
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

    const current = await ensureDeckProgressionHero(
      env,
      Number(player.userId),
      Number(player.deckId),
      player.heroId
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

    results.push(await getDeckProgressionHero(env, Number(player.userId), Number(player.deckId)));
  }

  return results;
}
