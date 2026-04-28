// royale_field_events.js
// Periodic field event system — fires every 30s during a battle, like Monopoly event cards.
import { adjustBattlePlayerResources } from './royale_heroes.js';

export const FIELD_EVENT_INTERVAL_MS = 30_000;

// ----------------------------------------------------------------
// Event catalog
// ----------------------------------------------------------------

/** @type {ReadonlyArray<object>} */
const FIELD_EVENT_CATALOG = Object.freeze([

  // ── TRAFFIC (交通) ──────────────────────────────────────────────
  {
    id: 'mountain_monkey',
    category: 'traffic',
    weight: 1.0,
    titleZhHant: '山道猴子肇事',
    titleEn: 'Road Monkey Incident',
    titleJa: '山道ドライバー乱走',
    descriptionZhHant: '山道猴子式駕駛擦撞後溜之大吉。',
    descriptionEn: 'A reckless mountain road driver hit someone and fled.',
    descriptionJa: '山岳道路で無謀な運転手が事故後に逃走。',
    hitRunChance: 0.50,
    insurancePayoutChance: 0.70,
    caughtChance: 0.30,
    physicalDamage: 90,
    insurancePayout: 20,
    caughtBonus: 25,
  },
  {
    id: 'road_three_treasures',
    category: 'traffic',
    weight: 1.0,
    titleZhHant: '馬路三寶肇事',
    titleEn: 'Traffic Hazard Trio',
    titleJa: '道路三大危険',
    descriptionZhHant: '馬路三寶危險駕駛，有機率擦撞或讓你重傷。',
    descriptionEn: 'Traffic hazard trio — hit-and-run or serious injury risk.',
    descriptionJa: '危険運転トリオ。接触逃走か重傷か。',
    hitRunChance: 0.30,
    insurancePayoutChance: 0.80,
    caughtChance: 0.25,
    disabledChance: 0.20,
    physicalDamage: 85,
    insurancePayout: 18,
    caughtBonus: 22,
  },
  {
    id: 'drunk_driver',
    category: 'traffic',
    weight: 0.9,
    titleZhHant: '酒癮慣犯肇事',
    titleEn: 'Drunk Driver Repeat Offender',
    titleJa: '常習飲酒運転犯',
    descriptionZhHant: '酒癮慣犯再度肇事，肇逃機率高，保險理賠機率偏低。',
    descriptionEn: 'Repeat drunk driver struck again — high flee chance, low insurance.',
    descriptionJa: '常習犯の飲酒運転。逃走確率高く、保険適用率は低い。',
    hitRunChance: 0.80,
    insurancePayoutChance: 0.30,
    caughtChance: 0.45,
    physicalDamage: 110,
    insurancePayout: 12,
    caughtBonus: 35,
  },
  {
    id: 'malicious_hit_run',
    category: 'traffic',
    weight: 0.75,
    titleZhHant: '惡意肇逃',
    titleEn: 'Deliberate Hit-and-Run',
    titleJa: '悪意ある轢き逃げ',
    descriptionZhHant: '蓄意車禍肇逃，傷害必然，然而保險理賠機率高。',
    descriptionEn: 'Deliberate hit-and-run. Damage guaranteed, but insurance comes through.',
    descriptionJa: '故意の轢き逃げ。被害は確定だが保険適用率は高い。',
    hitRunChance: 1.0,
    insurancePayoutChance: 0.90,
    caughtChance: 0.50,
    physicalDamage: 130,
    insurancePayout: 30,
    caughtBonus: 40,
  },
  {
    id: 'truck_driver',
    category: 'traffic',
    weight: 0.85,
    titleZhHant: '大卡車肇事',
    titleEn: 'Semi-Truck Accident',
    titleJa: '大型トラック事故',
    descriptionZhHant: '大卡車強行變道後肇逃，傷害較重，保險通常給付。',
    descriptionEn: 'Semi-truck forced lane change and fled — heavy damage, insurance likely.',
    descriptionJa: '大型トラックが無理な車線変更後に逃走。被害大、保険適用率高め。',
    hitRunChance: 0.85,
    insurancePayoutChance: 0.75,
    caughtChance: 0.35,
    physicalDamage: 150,
    insurancePayout: 28,
    caughtBonus: 38,
  },
  {
    id: 'severely_disabled',
    category: 'traffic',
    weight: 0.55,
    titleZhHant: '雷殘事故',
    titleEn: 'Catastrophic Crash',
    titleJa: '重傷障害事故',
    descriptionZhHant: '事故造成嚴重傷殘，無保險理賠，強制住院。',
    descriptionEn: 'Catastrophic accident leaves someone severely injured — no insurance.',
    descriptionJa: '大事故で重傷を負い、保険適用もなく入院が必要。',
    hitRunChance: 0,
    insurancePayoutChance: 0,
    caughtChance: 0,
    physicalDamage: 220,
    spiritDamage: 50,
  },

  // ── SECURITY (治安) ─────────────────────────────────────────────
  {
    id: 'fraud_epidemic',
    category: 'security',
    weight: 0.9,
    titleZhHant: '詐騙集團猖獗',
    titleEn: 'Fraud Gang Rampage',
    titleJa: '詐欺集団の横暴',
    descriptionZhHant: '詐騙集團活躍，商家品質下降，金錢持續縮水，且有機率買到假藥受傷。',
    descriptionEn: 'Fraud gangs run wild — money bleeds, and some goods may be poisoned.',
    descriptionJa: '詐欺集団が活発化。お金が減り続け、一部の商品は危険かもしれない。',
    duration: 25_000,
    fieldEffect: 'fraud_epidemic',
    fieldValue: 2.2,
  },

  // ── POLITICS (政治) ─────────────────────────────────────────────
  {
    id: 'world_war',
    category: 'politics',
    weight: 0.6,
    titleZhHant: '世界大戰爆發',
    titleEn: 'World War Outbreak',
    titleJa: '世界大戦勃発',
    descriptionZhHant: '全球衝突爆發！雙方直接承受砲擊傷害，並持續受損 20 秒。',
    descriptionEn: 'A world war breaks out! Both sides take artillery fire and bleed HP for 20s.',
    descriptionJa: '世界大戦が勃発！両陣営が砲撃を受け、20s間継続的な被害を受ける。',
    immediateDamage: 80,
    duration: 20_000,
    fieldEffect: 'world_war',
    fieldValue: 6.0,
  },

  // ── FAMILY (家庭) ────────────────────────────────────────────────
  {
    id: 'cockroach_poison',
    category: 'family',
    weight: 0.85,
    titleZhHant: '蟑螂藥下毒',
    titleEn: 'Cockroach Bait Incident',
    titleJa: 'ゴキブリ毒事件',
    descriptionZhHant: '有人加了蟑螂藥，藍白拖耐久度下降，雙方持續流失體力 12 秒。',
    descriptionEn: 'Cockroach bait was tampered with — HP drains for both sides for 12s.',
    descriptionJa: 'ゴキブリ毒が仕掛けられ、12s間両陣営のHPが徐々に減る。',
    duration: 12_000,
    fieldEffect: 'cockroach_poison',
    fieldValue: 5.0,
  },
  {
    id: 'power_outage',
    category: 'family',
    weight: 0.9,
    titleZhHant: '全區停電',
    titleEn: 'Power Outage',
    titleJa: '全域停電',
    descriptionZhHant: '突然停電！雙方能量回復大幅削減，持續 18 秒。',
    descriptionEn: 'Power goes out! Energy regeneration severely reduced for 18s.',
    descriptionJa: '突然の停電！エネルギー回復が大幅に低下、18s持続。',
    duration: 18_000,
    fieldEffect: 'power_outage',
    fieldValue: 0.5,
  },
  {
    id: 'water_outage',
    category: 'family',
    weight: 0.85,
    titleZhHant: '全區停水',
    titleEn: 'Water Outage',
    titleJa: '断水',
    descriptionZhHant: '停水了！雙方體能回復能量持續流失 15 秒。',
    descriptionEn: 'Water is cut off — physical energy drains for 15s.',
    descriptionJa: '断水！体力エネルギーが15s間じわじわ減る。',
    duration: 15_000,
    fieldEffect: 'water_outage',
    fieldValue: 0.8,
  },
  {
    id: 'dinosaur_parent',
    category: 'family',
    weight: 0.8,
    titleZhHant: '恐龍家長護航',
    titleEn: 'Dinosaur Parent Shields',
    titleJa: '恐竜系親の護衛',
    descriptionZhHant: '恐龍家長強勢護航，隨機護住一方，抵擋下一個負面場地效果。',
    descriptionEn: 'A dinosaur parent shields one side from the next negative field event.',
    descriptionJa: '恐竜系の親が一方を護り、次の負の場地効果を無効化する。',
    scope: 'one',
    fieldEffect: 'dino_shield',
  },
  {
    id: 'asian_parent',
    category: 'family',
    weight: 0.8,
    titleZhHant: '亞洲家長管教',
    titleEn: 'Asian Parent Outburst',
    titleJa: 'アジアの親の怒り',
    descriptionZhHant: '亞洲家長嚴格施壓，雙方精神與體能同時重創。',
    descriptionEn: 'The Asian parent lashes out — mental and physical energy both slammed.',
    descriptionJa: 'アジアの親が激怒。精神と体力が同時に大きく削られる。',
    scope: 'both',
    spiritDamage: 45,
    physicalEnergyDelta: -0.8,
    spiritEnergyDelta: -1.0,
  },

  // ── COMPANY (公司) ───────────────────────────────────────────────
  {
    id: 'good_boss',
    category: 'company',
    weight: 0.9,
    titleZhHant: '好老闆犒賞',
    titleEn: 'Good Boss Rewards',
    titleJa: '良い上司の報酬',
    descriptionZhHant: '好老闆給了月外薪資還帶了補品，雙方金錢與精神都大幅回升。',
    descriptionEn: 'The good boss gave bonus pay and supplements — money and spirit both rise.',
    descriptionJa: '良い上司がボーナスと栄養補給品をくれた。お金と精神が大きく上向く。',
    scope: 'both',
    moneyGain: 22,
    spiritGain: 28,
  },
  {
    id: 'exploitative_boss',
    category: 'company',
    weight: 0.85,
    titleZhHant: '慣老闆強制加班',
    titleEn: 'Exploitative Boss Overtime',
    titleJa: 'ブラック上司の強制残業',
    descriptionZhHant: '慣老闆強制無薪加班，精神重創，且過勞效果持續 20 秒。',
    descriptionEn: 'Unpaid overtime forced — spirit tanks, and overwork drains for 20s.',
    descriptionJa: '強制サービス残業。精神が深刻に傷つき、20s間オーバーワーク状態が続く。',
    scope: 'both',
    spiritDamage: 55,
    duration: 20_000,
    fieldEffect: 'overwork',
    fieldValue: 8.0,
  },

  // ── RECOVERY (回復) ─────────────────────────────────────────────
  {
    id: 'rehabilitation',
    category: 'recovery',
    weight: 0.7,
    titleZhHant: '強制戒毒療程',
    titleEn: 'Mandatory Rehabilitation',
    titleJa: '強制更生施設',
    descriptionZhHant: '被送去戒毒所。40% 機率成功清除負面狀態，否則反而更糟。',
    descriptionEn: '40% chance to clear mental/overwork effects — otherwise things get worse.',
    descriptionJa: '更生施設に送られる。40%で回復、失敗するとさらに悪化。',
    scope: 'each',
    recoveryChance: 0.40,
  },
  {
    id: 'hospital',
    category: 'recovery',
    weight: 0.75,
    titleZhHant: '緊急住院',
    titleEn: 'Emergency Hospitalization',
    titleJa: '緊急入院',
    descriptionZhHant: '意外受傷送醫，身體完整治療，但花了一些醫療費用。',
    descriptionEn: 'Admitted to hospital — physical health restored, but it cost you.',
    descriptionJa: '事故で入院。身体が回復したが費用がかかった。',
    scope: 'both',
    physicalGain: 80,
    moneyCost: 12,
  },

  // ── FOOD (食品) ─────────────────────────────────────────────────
  {
    id: 'food_poisoning',
    category: 'food',
    weight: 0.85,
    titleZhHant: '食品中毒',
    titleEn: 'Food Poisoning',
    titleJa: '食中毒',
    descriptionZhHant: '外食不慎食物中毒，雙方身體與體能同時大幅受損。',
    descriptionEn: 'Bad food hit everyone — both body and physical energy take a hit.',
    descriptionJa: '不衛生な食事で食中毒。体と体力エネルギーが同時にダメージを受ける。',
    scope: 'both',
    physicalDamage: 60,
    physicalEnergyDelta: -0.9,
  },

  // ── DELIVERY (外送) ─────────────────────────────────────────────
  {
    id: 'delivery_surge',
    category: 'delivery',
    weight: 0.8,
    titleZhHant: '外送尖峰潮',
    titleEn: 'Delivery Surge Rush',
    titleJa: '配達ラッシュ',
    descriptionZhHant: '外送需求爆炸，雙方結果各異：有人大賺，有人過勞。',
    descriptionEn: 'Delivery demand explodes — one side profits, the other burns out.',
    descriptionJa: '配達需要が急増。稼ぐ人と疲弊する人に分かれる。',
    scope: 'each',
  },
]);

// ----------------------------------------------------------------
// Field state initialisation
// ----------------------------------------------------------------

export function initFieldState() {
  return {
    nextEventMs: 0,
    activeEffects: [],
    shields: { left: false, right: false },
  };
}

function getFieldState(battle) {
  if (!battle.fieldState || typeof battle.fieldState !== 'object') {
    battle.fieldState = initFieldState();
  }
  return battle.fieldState;
}

// ----------------------------------------------------------------
// Active-effect helpers
// ----------------------------------------------------------------

function addActiveEffect(fieldState, kind, durationMs, value = 0, scope = 'both', side = null) {
  const existing = fieldState.activeEffects.find(
    (e) => e.kind === kind && (scope !== 'one' || e.side === side),
  );
  if (existing) {
    // Extend duration when an effect is renewed
    existing.remainingMs = Math.max(existing.remainingMs, durationMs);
    existing.value = value;
  } else {
    fieldState.activeEffects.push({ kind, remainingMs: durationMs, value, scope, side });
  }
}

function clearEffectsByKind(fieldState, ...kinds) {
  fieldState.activeEffects = fieldState.activeEffects.filter(
    (e) => !kinds.includes(e.kind),
  );
}

function tickActiveEffects(fieldState, dtMs) {
  fieldState.activeEffects = fieldState.activeEffects
    .map((e) => ({ ...e, remainingMs: e.remainingMs - dtMs }))
    .filter((e) => e.remainingMs > 0);
}

// ----------------------------------------------------------------
// Per-second passive deltas for each persistent field effect
// (all values are per-second; multiply by dt in tick)
// ----------------------------------------------------------------

const FIELD_EFFECT_TICK_TABLE = Object.freeze({
  power_outage:     { physicalEnergyDelta: -0.5, spiritEnergyDelta: -0.4 },
  water_outage:     { physicalEnergyDelta: -0.8 },
  overwork:         { spiritHealthDelta: -8 },
  fraud_epidemic:   { moneyDelta: -2.2 },
  cockroach_poison: { physicalHealthDelta: -5 },
  world_war:        { physicalHealthDelta: -6 },
});

function applyFieldEffectsTick(room, dt) {
  const fs = getFieldState(room.battle);
  for (const effect of fs.activeEffects) {
    const table = FIELD_EFFECT_TICK_TABLE[effect.kind];
    if (!table) continue;

    // Scale by dt
    const scaledDeltas = Object.fromEntries(
      Object.entries(table).map(([k, v]) => [k, v * dt]),
    );

    if (effect.scope === 'one' && effect.side) {
      const bp = room.battle.players[effect.side];
      if (bp) adjustBattlePlayerResources(bp, scaledDeltas);
    } else {
      for (const bp of Object.values(room.battle.players)) {
        adjustBattlePlayerResources(bp, scaledDeltas);
      }
    }
  }
}

// ----------------------------------------------------------------
// Event creation helper
// ----------------------------------------------------------------

let _uidCounter = 0;

function uid() {
  return `fe-${Date.now()}-${(++_uidCounter).toString(36)}`;
}

function makeEvent(template, side, overrides = {}) {
  return {
    id: uid(),
    kind: 'field_event',
    side: side ?? 'both',
    cardId: template.id,
    cardName: template.titleEn,
    cardNameZhHant: template.titleZhHant,
    cardNameEn: template.titleEn,
    cardNameJa: template.titleJa,
    title: template.titleEn,
    titleZhHant: template.titleZhHant,
    titleEn: template.titleEn,
    titleJa: template.titleJa,
    description: template.descriptionEn,
    descriptionZhHant: template.descriptionZhHant,
    descriptionEn: template.descriptionEn,
    descriptionJa: template.descriptionJa,
    tone: 'mixed',
    mentalStage: 0,
    moneyDelta: 0,
    physicalHealthDelta: 0,
    spiritHealthDelta: 0,
    physicalEnergyDelta: 0,
    spiritEnergyDelta: 0,
    ...overrides,
  };
}

function appendEvent(room, event) {
  const MAX = 6;
  room.battle.events = [...(room.battle.events ?? []), event].slice(-MAX);
}

// ----------------------------------------------------------------
// Shield check — returns true if the event is absorbed
// ----------------------------------------------------------------

const NEGATIVE_EVENT_IDS = new Set([
  'mountain_monkey', 'road_three_treasures', 'drunk_driver',
  'malicious_hit_run', 'truck_driver', 'severely_disabled',
  'fraud_epidemic', 'world_war', 'cockroach_poison',
  'power_outage', 'water_outage', 'asian_parent',
  'exploitative_boss', 'food_poisoning',
]);

function checkShield(fieldState, side, template) {
  if (!NEGATIVE_EVENT_IDS.has(template.id)) return false;
  if (fieldState.shields[side]) {
    fieldState.shields[side] = false;
    return true;           // absorbed
  }
  return false;
}

// ----------------------------------------------------------------
// Individual event resolvers
// ----------------------------------------------------------------

function resolveTrafficEvent(room, template, random) {
  const sides = Object.keys(room.battle.players);
  const victimSide = sides[Math.floor(random() * sides.length)];
  const fs = getFieldState(room.battle);

  // Shield can absorb the whole event for the victim
  if (checkShield(fs, victimSide, template)) {
    const ev = makeEvent(template, victimSide, {
      descriptionZhHant: `[${template.titleZhHant}] 恐龍家長擋下了這起事故！`,
      descriptionEn: `[${template.titleEn}] Dinosaur Parent absorbed the impact!`,
      descriptionJa: `[${template.titleJa}] 恐竜系の親が衝撃を防いだ！`,
      tone: 'positive',
    });
    appendEvent(room, ev);
    return;
  }

  const isHitRun = random() < (template.hitRunChance ?? 0);
  const isSeverelyDisabled = (template.disabledChance ?? 0) > 0 && random() < template.disabledChance;

  let physicalHealthDelta = 0;
  let spiritHealthDelta = 0;
  let moneyDelta = 0;
  const descParts = [];

  if (template.id === 'severely_disabled' || isSeverelyDisabled) {
    physicalHealthDelta = -(template.physicalDamage ?? 220);
    spiritHealthDelta = -(template.spiritDamage ?? 50);
    descParts.push('雷殘住院，無保險理賠');
  } else if (isHitRun) {
    physicalHealthDelta = -(template.physicalDamage ?? 100);
    descParts.push('肇逃受傷');
    if (random() < (template.insurancePayoutChance ?? 0.5)) {
      moneyDelta += (template.insurancePayout ?? 20);
      descParts.push('獲得保險理賠');
    }
    if (random() < (template.caughtChance ?? 0)) {
      moneyDelta += (template.caughtBonus ?? 25);
      descParts.push('肇事者被逮，獲個人理賠');
    }
  } else {
    descParts.push('有驚無險，未受傷');
  }

  const victimBp = room.battle.players[victimSide];
  if (victimBp && (physicalHealthDelta !== 0 || moneyDelta !== 0 || spiritHealthDelta !== 0)) {
    adjustBattlePlayerResources(victimBp, { physicalHealthDelta, spiritHealthDelta, moneyDelta });
  }

  const tone = physicalHealthDelta < 0 ? 'negative' : 'mixed';
  const ev = makeEvent(template, victimSide, {
    tone,
    physicalHealthDelta,
    spiritHealthDelta,
    moneyDelta,
    descriptionZhHant: `[${template.titleZhHant}] ${descParts.join('，')}。`,
    descriptionEn: `[${template.titleEn}] ${isHitRun ? 'Hit-and-run' : 'Near miss'}.${moneyDelta > 0 ? ' Compensation received.' : ''}`,
    descriptionJa: template.descriptionJa,
  });
  appendEvent(room, ev);
}

function resolveFraudEpidemicEvent(room, template, random) {
  const fs = getFieldState(room.battle);
  const sides = Object.keys(room.battle.players);
  const victimSide = sides[Math.floor(random() * sides.length)];

  if (checkShield(fs, victimSide, template)) {
    addActiveEffect(fs, template.fieldEffect, template.duration, template.fieldValue);
    const ev = makeEvent(template, 'both', {
      tone: 'mixed',
      descriptionZhHant: `${template.descriptionZhHant} 恐龍家長幫 ${victimSide === 'left' ? '左' : '右'}方擋下直接傷害，但場地效果仍啟動。`,
      descriptionEn: `${template.descriptionEn} Dinosaur Parent blocked direct harm on ${victimSide} side, but field effect is active.`,
      descriptionJa: template.descriptionJa,
    });
    appendEvent(room, ev);
    return;
  }

  addActiveEffect(fs, template.fieldEffect, template.duration, template.fieldValue);
  const isPoisoned = random() < 0.25;
  const deltas = isPoisoned
    ? { spiritHealthDelta: -30, physicalHealthDelta: -20 }
    : { moneyDelta: -10 };
  adjustBattlePlayerResources(room.battle.players[victimSide], deltas);

  const ev = makeEvent(template, victimSide, {
    tone: 'negative',
    ...deltas,
    descriptionZhHant: isPoisoned
      ? `${template.descriptionZhHant} 有人買到毒藥！直接受傷。`
      : `${template.descriptionZhHant} 被詐騙走了一些錢。`,
    descriptionEn: isPoisoned
      ? `${template.descriptionEn} Someone bought poisoned goods!`
      : `${template.descriptionEn} Got scammed for some cash.`,
    descriptionJa: template.descriptionJa,
  });
  appendEvent(room, ev);
}

function resolveWorldWarEvent(room, template, random) {
  const fs = getFieldState(room.battle);
  addActiveEffect(fs, template.fieldEffect, template.duration, template.fieldValue);
  const dmg = template.immediateDamage ?? 80;

  for (const bp of Object.values(room.battle.players)) {
    adjustBattlePlayerResources(bp, { physicalHealthDelta: -dmg });
  }

  const ev = makeEvent(template, 'both', {
    tone: 'negative',
    physicalHealthDelta: -dmg,
    descriptionZhHant: `${template.descriptionZhHant} 雙方各承受 ${dmg} 點砲擊傷害。`,
    descriptionEn: `${template.descriptionEn} Both sides take ${dmg} artillery damage.`,
    descriptionJa: template.descriptionJa,
  });
  appendEvent(room, ev);
}

function resolvePersistentOnlyEvent(room, template, _random) {
  // Events that only add a field effect without immediate deltas
  const fs = getFieldState(room.battle);
  addActiveEffect(fs, template.fieldEffect, template.duration, template.fieldValue);
  appendEvent(room, makeEvent(template, 'both', { tone: 'negative' }));
}

function resolveDinoParentEvent(room, template, random) {
  const fs = getFieldState(room.battle);
  const sides = Object.keys(room.battle.players);
  const shieldedSide = sides[Math.floor(random() * sides.length)];
  fs.shields[shieldedSide] = true;

  const sideLabel = shieldedSide === 'left' ? '左' : '右';
  const ev = makeEvent(template, shieldedSide, {
    tone: 'positive',
    descriptionZhHant: `${template.descriptionZhHant} ${sideLabel}方受到庇護。`,
    descriptionEn: `${template.descriptionEn} ${shieldedSide} side is protected.`,
    descriptionJa: template.descriptionJa,
  });
  appendEvent(room, ev);
}

function resolveAsianParentEvent(room, template, _random) {
  const deltas = {
    spiritHealthDelta: -(template.spiritDamage ?? 45),
    physicalEnergyDelta: template.physicalEnergyDelta ?? -0.8,
    spiritEnergyDelta: template.spiritEnergyDelta ?? -1.0,
  };
  for (const bp of Object.values(room.battle.players)) {
    adjustBattlePlayerResources(bp, deltas);
  }
  appendEvent(room, makeEvent(template, 'both', { tone: 'negative', ...deltas }));
}

function resolveGoodBossEvent(room, template, _random) {
  const deltas = {
    moneyDelta: template.moneyGain ?? 22,
    spiritHealthDelta: template.spiritGain ?? 28,
  };
  for (const bp of Object.values(room.battle.players)) {
    adjustBattlePlayerResources(bp, deltas);
  }
  appendEvent(room, makeEvent(template, 'both', { tone: 'positive', ...deltas }));
}

function resolveExploitativeBossEvent(room, template, _random) {
  const fs = getFieldState(room.battle);
  addActiveEffect(fs, template.fieldEffect, template.duration, template.fieldValue);
  const deltas = { spiritHealthDelta: -(template.spiritDamage ?? 55) };
  for (const bp of Object.values(room.battle.players)) {
    adjustBattlePlayerResources(bp, deltas);
  }
  appendEvent(room, makeEvent(template, 'both', { tone: 'negative', ...deltas }));
}

function resolveRehabEvent(room, template, random) {
  const fs = getFieldState(room.battle);
  for (const [side, bp] of Object.entries(room.battle.players)) {
    const success = random() < (template.recoveryChance ?? 0.4);
    if (success) {
      clearEffectsByKind(fs, 'overwork', 'fraud_epidemic');
      adjustBattlePlayerResources(bp, { spiritHealthDelta: 40, physicalHealthDelta: 20 });
    } else {
      adjustBattlePlayerResources(bp, { spiritHealthDelta: -20, spiritEnergyDelta: -0.5 });
    }
  }
  appendEvent(room, makeEvent(template, 'both', { tone: 'mixed' }));
}

function resolveHospitalEvent(room, template, _random) {
  const deltas = {
    physicalHealthDelta: template.physicalGain ?? 80,
    moneyDelta: -(template.moneyCost ?? 12),
  };
  for (const bp of Object.values(room.battle.players)) {
    adjustBattlePlayerResources(bp, deltas);
  }
  appendEvent(room, makeEvent(template, 'both', { tone: 'mixed', ...deltas }));
}

function resolveFoodPoisoningEvent(room, template, _random) {
  const deltas = {
    physicalHealthDelta: -(template.physicalDamage ?? 60),
    physicalEnergyDelta: template.physicalEnergyDelta ?? -0.9,
  };
  for (const bp of Object.values(room.battle.players)) {
    adjustBattlePlayerResources(bp, deltas);
  }
  appendEvent(room, makeEvent(template, 'both', { tone: 'negative', ...deltas }));
}

function resolveDeliverySurgeEvent(room, template, random) {
  for (const [side, bp] of Object.entries(room.battle.players)) {
    const profit = random() < 0.5;
    const deltas = profit
      ? { moneyDelta: 18, physicalEnergyDelta: -0.6 }
      : { physicalHealthDelta: -30, physicalEnergyDelta: -1.0, spiritHealthDelta: -15 };
    adjustBattlePlayerResources(bp, deltas);
  }
  appendEvent(room, makeEvent(template, 'both', { tone: 'mixed' }));
}

// ----------------------------------------------------------------
// Dispatch table
// ----------------------------------------------------------------

const EVENT_RESOLVERS = {
  mountain_monkey:        resolveTrafficEvent,
  road_three_treasures:   resolveTrafficEvent,
  drunk_driver:           resolveTrafficEvent,
  malicious_hit_run:      resolveTrafficEvent,
  truck_driver:           resolveTrafficEvent,
  severely_disabled:      resolveTrafficEvent,
  fraud_epidemic:         resolveFraudEpidemicEvent,
  world_war:              resolveWorldWarEvent,
  cockroach_poison:       resolvePersistentOnlyEvent,
  power_outage:           resolvePersistentOnlyEvent,
  water_outage:           resolvePersistentOnlyEvent,
  dinosaur_parent:        resolveDinoParentEvent,
  asian_parent:           resolveAsianParentEvent,
  good_boss:              resolveGoodBossEvent,
  exploitative_boss:      resolveExploitativeBossEvent,
  rehabilitation:         resolveRehabEvent,
  hospital:               resolveHospitalEvent,
  food_poisoning:         resolveFoodPoisoningEvent,
  delivery_surge:         resolveDeliverySurgeEvent,
};

// ----------------------------------------------------------------
// Weighted random pick
// ----------------------------------------------------------------

function weightedPick(catalog, random) {
  const total = catalog.reduce((s, e) => s + (e.weight || 1), 0);
  let threshold = random() * total;
  for (const e of catalog) {
    threshold -= (e.weight || 1);
    if (threshold <= 0) return e;
  }
  return catalog[catalog.length - 1];
}

// ----------------------------------------------------------------
// Public exports
// ----------------------------------------------------------------

/**
 * Trigger a random field event immediately.
 * @param {object} room
 * @param {() => number} [random]
 */
export function resolveFieldEvent(room, random = Math.random) {
  const template = weightedPick(FIELD_EVENT_CATALOG, random);
  const resolver = EVENT_RESOLVERS[template.id];
  if (resolver) resolver(room, template, random);
}

/**
 * Called every tick from royale_room.js.
 * @param {object} room
 * @param {number} dt  seconds
 */
export function tickFieldEvents(room, dt) {
  if (!room?.battle) return;
  const fs = getFieldState(room.battle);
  const dtMs = dt * 1_000;

  // 1. Apply passive deltas from active persistent effects
  applyFieldEffectsTick(room, dt);

  // 2. Count down remaining durations
  tickActiveEffects(fs, dtMs);

  // 3. Countdown to next scheduled event
  fs.nextEventMs -= dtMs;
  if (fs.nextEventMs <= 0) {
    fs.nextEventMs = FIELD_EVENT_INTERVAL_MS;
    resolveFieldEvent(room);
  }
}

/**
 * Returns a serialisable snapshot of the current field state.
 * @param {object} battle
 * @returns {object|null}
 */
export function getFieldStateSnapshot(battle) {
  if (!battle?.fieldState) return null;
  const fs = battle.fieldState;
  return {
    nextEventMs: Math.max(0, Math.round(fs.nextEventMs ?? FIELD_EVENT_INTERVAL_MS)),
    activeEffects: (fs.activeEffects ?? [])
      .filter((e) => e.remainingMs > 0)
      .map((e) => ({
        kind: e.kind,
        remainingMs: Math.round(e.remainingMs),
        scope: e.scope ?? 'both',
        side: e.side ?? null,
      })),
    shields: { left: !!fs.shields?.left, right: !!fs.shields?.right },
  };
}
