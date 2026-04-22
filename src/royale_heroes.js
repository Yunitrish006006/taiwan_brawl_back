import { clamp } from './royale_battle_rules.js';

export const DEFAULT_HERO_ID = 'ordinary_person';
const LEGACY_ENERGY_CAP = 10;
const LEGACY_ENERGY_REGEN_PER_SECOND = 0.8;
const DEFAULT_HERO_ATTACK = Object.freeze({
  damage: 64,
  range: 230,
  attackSpeed: 1.25,
  damageType: 'physical'
});

const HERO_DEFINITIONS = Object.freeze([
  {
    id: 'rich_heir',
    name: 'Rich Heir',
    nameZhHant: '富二代',
    nameEn: 'Rich Heir',
    nameJa: 'お金持ち',
    bonusSummary: 'Starts rich, but mental illness is much easier to trigger',
    bonusSummaryZhHant: '開局金錢很多，但更容易出現精神疾病事件',
    bonusSummaryEn: 'Starts rich, but mental illness is much easier to trigger',
    bonusSummaryJa: '初期資金は多いが、精神疾患イベントが起きやすい',
    bonusKind: 'mental_event_weight_multiplier',
    bonusValue: 1.8,
    physicalHealth: { initial: 1380, max: 1380, regenPerSecond: 1.0 },
    spiritHealth: { initial: 980, max: 980, regenPerSecond: 0.7 },
    physicalEnergy: { initial: 4.2, max: 5.0, regenPerSecond: 0.32 },
    spiritEnergy: { initial: 3.6, max: 4.2, regenPerSecond: 0.22 },
    money: { initial: 20, max: 48, regenPerSecond: 0 },
    heroAttack: { damage: 48, range: 260, attackSpeed: 1.35, damageType: 'spirit' },
    unitDamageMultiplier: 1,
    jobMoneyMultiplier: 1,
    jobPositiveWeightMultiplier: 1,
    jobNegativeWeightMultiplier: 1,
    mentalEventWeightMultiplier: 1.8,
    mentalDamageMultiplier: 1.18,
    mentalIllnessStageFloor: 1
  },
  {
    id: 'ordinary_person',
    name: 'Ordinary Person',
    nameZhHant: '普通人',
    nameEn: 'Ordinary Person',
    nameJa: '普通人',
    bonusSummary:
      'Mental illness is harder to trigger, but starts directly from stage 2',
    bonusSummaryZhHant:
      '精神疾病較難出現，但一旦發病會直接從第二階段開始',
    bonusSummaryEn:
      'Mental illness is harder to trigger, but starts directly from stage 2',
    bonusSummaryJa: '精神疾患は起きにくいが、発症すると第2段階から始まる',
    bonusKind: 'mental_event_weight_multiplier',
    bonusValue: 0.58,
    physicalHealth: { initial: 1460, max: 1460, regenPerSecond: 1.2 },
    spiritHealth: { initial: 1500, max: 1500, regenPerSecond: 1.25 },
    physicalEnergy: { initial: 4.4, max: 5.2, regenPerSecond: 0.35 },
    spiritEnergy: { initial: 4.8, max: 5.8, regenPerSecond: 0.42 },
    money: { initial: 7, max: 36, regenPerSecond: 0 },
    heroAttack: { damage: 64, range: 230, attackSpeed: 1.25, damageType: 'physical' },
    unitDamageMultiplier: 1,
    jobMoneyMultiplier: 1,
    jobPositiveWeightMultiplier: 1,
    jobNegativeWeightMultiplier: 1,
    mentalEventWeightMultiplier: 0.58,
    mentalDamageMultiplier: 0.9,
    mentalIllnessStageFloor: 2
  },
  {
    id: 'low_income_household',
    name: 'Low Income Household',
    nameZhHant: '中低收入戶',
    nameEn: 'Low Income Household',
    nameJa: '低所得世帯',
    bonusSummary: 'Starts broke, but units gain +15% damage',
    bonusSummaryZhHant: '初始金錢很少，但單位傷害 +15%',
    bonusSummaryEn: 'Starts broke, but units gain +15% damage',
    bonusSummaryJa: '初期資金は少ないが、ユニットのダメージが +15%',
    bonusKind: 'unit_damage_multiplier',
    bonusValue: 1.15,
    physicalHealth: { initial: 1520, max: 1520, regenPerSecond: 1.35 },
    spiritHealth: { initial: 1240, max: 1240, regenPerSecond: 0.92 },
    physicalEnergy: { initial: 4.8, max: 5.6, regenPerSecond: 0.4 },
    spiritEnergy: { initial: 3.8, max: 4.6, regenPerSecond: 0.28 },
    money: { initial: 2, max: 28, regenPerSecond: 0 },
    heroAttack: { damage: 76, range: 205, attackSpeed: 1.15, damageType: 'physical' },
    unitDamageMultiplier: 1.15,
    jobMoneyMultiplier: 1,
    jobPositiveWeightMultiplier: 1,
    jobNegativeWeightMultiplier: 1,
    mentalEventWeightMultiplier: 1,
    mentalDamageMultiplier: 1,
    mentalIllnessStageFloor: 1
  },
  {
    id: 'part_time_worker',
    name: 'Part-time Worker',
    nameZhHant: 'Part time打工仔',
    nameEn: 'Part-time Worker',
    nameJa: 'バイト戦士',
    bonusSummary: 'Job events spike higher, but outcomes are much less stable',
    bonusSummaryZhHant: '工作事件更容易出現高報酬，但整體結果更不穩定',
    bonusSummaryEn: 'Job events spike higher, but outcomes are much less stable',
    bonusSummaryJa: '仕事イベントは当たり外れが大きく、不安定になりやすい',
    bonusKind: 'job_positive_weight_multiplier',
    bonusValue: 1.35,
    physicalHealth: { initial: 1360, max: 1360, regenPerSecond: 1.1 },
    spiritHealth: { initial: 1200, max: 1200, regenPerSecond: 0.92 },
    physicalEnergy: { initial: 4.3, max: 5.0, regenPerSecond: 0.36 },
    spiritEnergy: { initial: 4.0, max: 4.8, regenPerSecond: 0.34 },
    money: { initial: 5, max: 34, regenPerSecond: 0 },
    heroAttack: { damage: 58, range: 220, attackSpeed: 0.95, damageType: 'physical' },
    unitDamageMultiplier: 1,
    jobMoneyMultiplier: 1.08,
    jobPositiveWeightMultiplier: 1.35,
    jobNegativeWeightMultiplier: 1.25,
    mentalEventWeightMultiplier: 1,
    mentalDamageMultiplier: 1,
    mentalIllnessStageFloor: 1
  }
]);

const HERO_BY_ID = new Map(HERO_DEFINITIONS.map((hero) => [hero.id, hero]));

function normalizedNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundToSingleDecimal(value) {
  return Number(normalizedNumber(value).toFixed(1));
}

function roundToWhole(value) {
  return Math.round(normalizedNumber(value));
}

function totalHealth(playerState) {
  return normalizedNumber(playerState.physicalHealth) + normalizedNumber(playerState.spiritHealth);
}

function totalMaxHealth(playerState) {
  return normalizedNumber(playerState.maxPhysicalHealth) + normalizedNumber(playerState.maxSpiritHealth);
}

function totalEnergy(playerState) {
  return normalizedNumber(playerState.physicalEnergy) + normalizedNumber(playerState.spiritEnergy);
}

function totalMaxEnergy(playerState) {
  return normalizedNumber(playerState.maxPhysicalEnergy) + normalizedNumber(playerState.maxSpiritEnergy);
}

function clampMeter(current, max) {
  return clamp(normalizedNumber(current), 0, Math.max(0, normalizedNumber(max)));
}

function ensureBattlePlayerMeters(playerState) {
  const next = playerState;

  const healthMaxTotal =
    normalizedNumber(next.maxPhysicalHealth) + normalizedNumber(next.maxSpiritHealth);
  if (healthMaxTotal <= 0) {
    const legacyMaxHealth = normalizedNumber(next.maxTowerHp, next.towerHp);
    next.physicalHealth = normalizedNumber(next.physicalHealth, next.towerHp);
    next.maxPhysicalHealth = normalizedNumber(next.maxPhysicalHealth, legacyMaxHealth);
    next.spiritHealth = normalizedNumber(next.spiritHealth, 0);
    next.maxSpiritHealth = normalizedNumber(next.maxSpiritHealth, 0);
  }

  const energyMaxTotal =
    normalizedNumber(next.maxPhysicalEnergy) + normalizedNumber(next.maxSpiritEnergy);
  if (energyMaxTotal <= 0) {
    const legacyMaxEnergy = normalizedNumber(next.maxElixir, LEGACY_ENERGY_CAP);
    next.physicalEnergy = normalizedNumber(next.physicalEnergy, next.elixir);
    next.maxPhysicalEnergy = normalizedNumber(next.maxPhysicalEnergy, legacyMaxEnergy);
    next.spiritEnergy = normalizedNumber(next.spiritEnergy, 0);
    next.maxSpiritEnergy = normalizedNumber(next.maxSpiritEnergy, 0);
    next.physicalEnergyRegen = normalizedNumber(
      next.physicalEnergyRegen,
      LEGACY_ENERGY_REGEN_PER_SECOND
    );
  }

  next.physicalHealthRegen = normalizedNumber(next.physicalHealthRegen);
  next.spiritHealthRegen = normalizedNumber(next.spiritHealthRegen);
  next.physicalEnergyRegen = normalizedNumber(next.physicalEnergyRegen);
  next.spiritEnergyRegen = normalizedNumber(next.spiritEnergyRegen);
  next.money = normalizedNumber(next.money);
  next.maxMoney = normalizedNumber(next.maxMoney, next.money);
  next.moneyPerSecond = normalizedNumber(next.moneyPerSecond);
  return next;
}

function fillMeter(playerState, field, maxField, regenField, dt) {
  const current = normalizedNumber(playerState[field]);
  const max = normalizedNumber(playerState[maxField]);
  const regen = normalizedNumber(playerState[regenField]);
  playerState[field] = clamp(current + regen * dt, 0, max);
}

function maxFieldForMeter(field) {
  return `max${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

function applyDamageToSingleHealthTrack(playerState, amount, field) {
  const maxField = maxFieldForMeter(field);
  const max = normalizedNumber(playerState[maxField]);
  if (max <= 0) {
    return false;
  }
  playerState[field] = clamp(
    normalizedNumber(playerState[field]) - Math.max(0, normalizedNumber(amount)),
    0,
    max
  );
  return true;
}

export function listHeroDefinitions() {
  return HERO_DEFINITIONS.map((hero) => buildHeroSnapshot(hero.id));
}

export function normalizeHeroId(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return HERO_BY_ID.has(candidate) ? candidate : DEFAULT_HERO_ID;
}

export function heroDefinitionById(value) {
  return HERO_BY_ID.get(normalizeHeroId(value)) || HERO_BY_ID.get(DEFAULT_HERO_ID);
}

export function heroTraitValue(heroId, key, fallback = 0) {
  const hero = heroDefinitionById(heroId);
  const value = hero?.[key];
  if (typeof fallback === 'number') {
    return normalizedNumber(value, fallback);
  }
  return value ?? fallback;
}

export function heroAttackDefinition(heroId) {
  const hero = heroDefinitionById(heroId);
  const attack = hero.heroAttack || DEFAULT_HERO_ATTACK;
  return {
    damage: Math.max(0, Math.round(normalizedNumber(attack.damage, DEFAULT_HERO_ATTACK.damage))),
    range: Math.max(0, Math.round(normalizedNumber(attack.range, DEFAULT_HERO_ATTACK.range))),
    attackSpeed: Math.max(0.2, normalizedNumber(attack.attackSpeed, DEFAULT_HERO_ATTACK.attackSpeed)),
    damageType: attack.damageType === 'spirit' ? 'spirit' : 'physical'
  };
}

export function buildHeroSnapshot(value) {
  const hero = heroDefinitionById(value);
  return {
    id: hero.id,
    name: hero.name,
    nameZhHant: hero.nameZhHant,
    nameEn: hero.nameEn,
    nameJa: hero.nameJa,
    bonusSummary: hero.bonusSummary,
    bonusSummaryZhHant: hero.bonusSummaryZhHant,
    bonusSummaryEn: hero.bonusSummaryEn,
    bonusSummaryJa: hero.bonusSummaryJa,
    bonusKind: hero.bonusKind,
    bonusValue: hero.bonusValue,
    physicalHealth: { ...hero.physicalHealth },
    spiritHealth: { ...hero.spiritHealth },
    physicalEnergy: { ...hero.physicalEnergy },
    spiritEnergy: { ...hero.spiritEnergy },
    money: { ...hero.money },
    heroAttack: heroAttackDefinition(hero.id),
    unitDamageMultiplier: hero.unitDamageMultiplier,
    jobMoneyMultiplier: hero.jobMoneyMultiplier,
    jobPositiveWeightMultiplier: hero.jobPositiveWeightMultiplier,
    jobNegativeWeightMultiplier: hero.jobNegativeWeightMultiplier,
    mentalEventWeightMultiplier: hero.mentalEventWeightMultiplier,
    mentalDamageMultiplier: hero.mentalDamageMultiplier,
    mentalIllnessStageFloor: hero.mentalIllnessStageFloor
  };
}

export function buildInitialBattlePlayerState(heroId, { isBot = false } = {}) {
  const hero = heroDefinitionById(heroId);
  return syncBattlePlayerTotals({
    physicalHealth: hero.physicalHealth.initial,
    maxPhysicalHealth: hero.physicalHealth.max,
    physicalHealthRegen: hero.physicalHealth.regenPerSecond,
    spiritHealth: hero.spiritHealth.initial,
    maxSpiritHealth: hero.spiritHealth.max,
    spiritHealthRegen: hero.spiritHealth.regenPerSecond,
    physicalEnergy: hero.physicalEnergy.initial,
    maxPhysicalEnergy: hero.physicalEnergy.max,
    physicalEnergyRegen: hero.physicalEnergy.regenPerSecond,
    spiritEnergy: hero.spiritEnergy.initial,
    maxSpiritEnergy: hero.spiritEnergy.max,
    spiritEnergyRegen: hero.spiritEnergy.regenPerSecond,
    money: hero.money.initial,
    maxMoney: hero.money.max,
    moneyPerSecond: hero.money.regenPerSecond,
    heroAttackCooldown: 0,
    heroAttackEventId: 0,
    heroAttackEvent: null,
    botThinkMs: isBot ? 0 : 0
  });
}

export function syncBattlePlayerTotals(playerState = {}) {
  const next = ensureBattlePlayerMeters(playerState);
  next.physicalHealth = clampMeter(next.physicalHealth, next.maxPhysicalHealth);
  next.spiritHealth = clampMeter(next.spiritHealth, next.maxSpiritHealth);
  next.physicalEnergy = clampMeter(next.physicalEnergy, next.maxPhysicalEnergy);
  next.spiritEnergy = clampMeter(next.spiritEnergy, next.maxSpiritEnergy);
  next.money = clampMeter(next.money, next.maxMoney);
  next.towerHp = Math.max(0, roundToWhole(totalHealth(next)));
  next.maxTowerHp = Math.max(0, roundToWhole(totalMaxHealth(next)));
  next.money = roundToSingleDecimal(next.money);
  next.maxMoney = roundToSingleDecimal(next.maxMoney);
  next.moneyPerSecond = roundToSingleDecimal(next.moneyPerSecond);
  next.physicalHealth = roundToSingleDecimal(next.physicalHealth);
  next.maxPhysicalHealth = roundToSingleDecimal(next.maxPhysicalHealth);
  next.physicalHealthRegen = roundToSingleDecimal(next.physicalHealthRegen);
  next.spiritHealth = roundToSingleDecimal(next.spiritHealth);
  next.maxSpiritHealth = roundToSingleDecimal(next.maxSpiritHealth);
  next.spiritHealthRegen = roundToSingleDecimal(next.spiritHealthRegen);
  next.physicalEnergy = roundToSingleDecimal(next.physicalEnergy);
  next.maxPhysicalEnergy = roundToSingleDecimal(next.maxPhysicalEnergy);
  next.physicalEnergyRegen = roundToSingleDecimal(next.physicalEnergyRegen);
  next.spiritEnergy = roundToSingleDecimal(next.spiritEnergy);
  next.maxSpiritEnergy = roundToSingleDecimal(next.maxSpiritEnergy);
  next.spiritEnergyRegen = roundToSingleDecimal(next.spiritEnergyRegen);
  return next;
}

export function regenerateBattlePlayerResources(playerState, dt) {
  ensureBattlePlayerMeters(playerState);
  fillMeter(playerState, 'physicalHealth', 'maxPhysicalHealth', 'physicalHealthRegen', dt);
  fillMeter(playerState, 'spiritHealth', 'maxSpiritHealth', 'spiritHealthRegen', dt);
  fillMeter(playerState, 'physicalEnergy', 'maxPhysicalEnergy', 'physicalEnergyRegen', dt);
  fillMeter(playerState, 'spiritEnergy', 'maxSpiritEnergy', 'spiritEnergyRegen', dt);
  fillMeter(playerState, 'money', 'maxMoney', 'moneyPerSecond', dt);
  return syncBattlePlayerTotals(playerState);
}

export function spendBattlePlayerEnergy(playerState, amount, preferredPool = 'physical') {
  ensureBattlePlayerMeters(playerState);
  const normalizedAmount = normalizedNumber(amount);
  if (preferredPool === 'spirit') {
    if (normalizedNumber(playerState.spiritEnergy) + 1e-6 < normalizedAmount) {
      return false;
    }
    playerState.spiritEnergy = normalizedNumber(playerState.spiritEnergy) - normalizedAmount;
  } else {
    if (normalizedNumber(playerState.physicalEnergy) + 1e-6 < normalizedAmount) {
      return false;
    }
    playerState.physicalEnergy = normalizedNumber(playerState.physicalEnergy) - normalizedAmount;
  }

  syncBattlePlayerTotals(playerState);
  return true;
}

export function spendBattlePlayerMoney(playerState, amount) {
  ensureBattlePlayerMeters(playerState);
  const normalizedAmount = normalizedNumber(amount);
  if (normalizedNumber(playerState.money) + 1e-6 < normalizedAmount) {
    return false;
  }
  playerState.money = normalizedNumber(playerState.money) - normalizedAmount;
  syncBattlePlayerTotals(playerState);
  return true;
}

export function battlePlayerEnergy(playerState, preferredPool = 'physical') {
  ensureBattlePlayerMeters(playerState);
  if (preferredPool === 'spirit') {
    return normalizedNumber(playerState.spiritEnergy);
  }
  return normalizedNumber(playerState.physicalEnergy);
}

export function totalBattlePlayerEnergy(playerState) {
  ensureBattlePlayerMeters(playerState);
  return totalEnergy(playerState);
}

export function canSpendBattlePlayerEnergy(playerState, amount, preferredPool = 'physical') {
  ensureBattlePlayerMeters(playerState);
  if (battlePlayerEnergy(playerState, preferredPool) + 1e-6 < normalizedNumber(amount)) {
    return false;
  }
  return true;
}

export function canSpendBattlePlayerMoney(playerState, amount) {
  ensureBattlePlayerMeters(playerState);
  return normalizedNumber(playerState.money) + 1e-6 >= normalizedNumber(amount);
}

export function applyBattlePlayerDamage(playerState, amount, preferredPool = 'physical') {
  ensureBattlePlayerMeters(playerState);
  if (preferredPool === 'spirit') {
    applyDamageToSingleHealthTrack(playerState, amount, 'spiritHealth') ||
      applyDamageToSingleHealthTrack(playerState, amount, 'physicalHealth');
  } else {
    applyDamageToSingleHealthTrack(playerState, amount, 'physicalHealth') ||
      applyDamageToSingleHealthTrack(playerState, amount, 'spiritHealth');
  }
  syncBattlePlayerTotals(playerState);
}

export function adjustBattlePlayerResources(playerState, deltas = {}) {
  ensureBattlePlayerMeters(playerState);
  playerState.money = normalizedNumber(playerState.money) + normalizedNumber(deltas.moneyDelta);
  playerState.physicalHealth =
    normalizedNumber(playerState.physicalHealth) + normalizedNumber(deltas.physicalHealthDelta);
  playerState.spiritHealth =
    normalizedNumber(playerState.spiritHealth) + normalizedNumber(deltas.spiritHealthDelta);
  playerState.physicalEnergy =
    normalizedNumber(playerState.physicalEnergy) + normalizedNumber(deltas.physicalEnergyDelta);
  playerState.spiritEnergy =
    normalizedNumber(playerState.spiritEnergy) + normalizedNumber(deltas.spiritEnergyDelta);
  return syncBattlePlayerTotals(playerState);
}

export function heroBonusMultiplier(heroId, bonusKind) {
  const hero = heroDefinitionById(heroId);
  return hero.bonusKind === bonusKind ? hero.bonusValue : 1;
}
