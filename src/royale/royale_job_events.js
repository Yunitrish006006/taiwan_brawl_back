import {
  adjustBattlePlayerResources,
  heroTraitValue
} from './royale_heroes.js';

const MAX_BATTLE_EVENTS = 6;

const JOB_EVENT_PROFILES = Object.freeze({
  job_part_time: [
    {
      id: 'extra_shift',
      weight: 1.2,
      tone: 'positive',
      titleZhHant: '臨時頂班',
      titleEn: 'Extra Shift',
      titleJa: '臨時シフト',
      descriptionZhHant: '有人臨時請假，你硬補進班表，多賺到一筆現金。',
      descriptionEn: 'Someone bailed on their shift. You covered it and pocketed extra cash.',
      descriptionJa: '急な欠員が出て、代打でシフトに入り追加収入を得た。',
      moneyFactor: 1.25,
      physicalEnergyDelta: -0.4,
      spiritEnergyDelta: -0.3
    },
    {
      id: 'schedule_cut',
      weight: 1,
      tone: 'negative',
      titleZhHant: '班表被砍',
      titleEn: 'Hours Cut',
      titleJa: 'シフト削減',
      descriptionZhHant: '店裡突然砍班，你白跑一趟，只拿到很少的錢。',
      descriptionEn: 'The shop cut your hours at the last second. You barely earned anything.',
      descriptionJa: '急にシフトが削られ、ほとんど稼げなかった。',
      moneyFactor: 0.35,
      spiritHealthDelta: -18,
      spiritEnergyDelta: -0.5
    },
    {
      id: 'rude_customer',
      weight: 0.95,
      tone: 'negative',
      tags: ['mental'],
      mentalStage: 1,
      titleZhHant: '奧客爆氣',
      titleEn: 'Customer Meltdown',
      titleJa: '迷惑客の暴走',
      descriptionZhHant: '你被奧客連續輸出，錢是拿到了，但精神被磨掉一層。',
      descriptionEn: 'A nightmare customer unloaded on you. You got paid, but your mind took a hit.',
      descriptionJa: '迷惑客に絡まれ、給料は出たがメンタルを削られた。',
      moneyFactor: 0.78,
      spiritHealthDelta: -32,
      spiritEnergyDelta: -0.8
    },
    {
      id: 'tips_night',
      weight: 0.85,
      tone: 'positive',
      titleZhHant: '小費爆發',
      titleEn: 'Tip Frenzy',
      titleJa: 'チップ大当たり',
      descriptionZhHant: '今晚客人心情好，額外的小費讓收入直接拉高。',
      descriptionEn: 'Customers were generous tonight. Tips pushed your income way up.',
      descriptionJa: '客の機嫌が良く、チップで収入が一気に跳ねた。',
      moneyFactor: 1.65,
      physicalEnergyDelta: -0.5,
      spiritEnergyDelta: -0.2
    }
  ],
  job_delivery: [
    {
      id: 'surge_bonus',
      weight: 1.15,
      tone: 'positive',
      titleZhHant: '尖峰加成',
      titleEn: 'Surge Bonus',
      titleJa: 'ピーク加算',
      descriptionZhHant: '剛好卡進高峰獎勵區間，這趟外送意外很賺。',
      descriptionEn: 'You hit the surge window just right. This delivery paid unexpectedly well.',
      descriptionJa: 'ちょうどピーク加算に乗って、この配達はかなり稼げた。',
      moneyFactor: 1.45,
      physicalEnergyDelta: -0.8,
      spiritEnergyDelta: -0.3
    },
    {
      id: 'empty_trip',
      weight: 1,
      tone: 'negative',
      titleZhHant: '白跑一趟',
      titleEn: 'Dead Run',
      titleJa: '空振り配達',
      descriptionZhHant: '接單又被取消，你花了力氣，卻只拿到零碎補貼。',
      descriptionEn: 'The order got canceled mid-run. You burned energy for scraps.',
      descriptionJa: '配達中にキャンセルされ、体力だけ使って小銭しか残らなかった。',
      moneyFactor: 0.2,
      physicalEnergyDelta: -0.7,
      spiritHealthDelta: -16
    },
    {
      id: 'traffic_brush',
      weight: 0.92,
      tone: 'negative',
      titleZhHant: '擦撞驚魂',
      titleEn: 'Near Crash',
      titleJa: '接触事故寸前',
      descriptionZhHant: '趕單趕到差點出事，雖然有收入，但身體明顯被消耗。',
      descriptionEn: 'You pushed too hard chasing the order and almost crashed. Your body paid for it.',
      descriptionJa: '配達を急ぎすぎて事故寸前。収入はあっても体への負担が大きい。',
      moneyFactor: 0.92,
      physicalHealthDelta: -45,
      physicalEnergyDelta: -1
    },
    {
      id: 'big_tip',
      weight: 0.8,
      tone: 'positive',
      titleZhHant: '客人給大賞',
      titleEn: 'Big Tip',
      titleJa: '太っ腹チップ',
      descriptionZhHant: '客人心情太好，這單的回報幾乎翻倍。',
      descriptionEn: 'A generous customer doubled the value of the run with a huge tip.',
      descriptionJa: '太っ腹な客のおかげで、この配達はほぼ倍の価値になった。',
      moneyFactor: 1.8,
      physicalEnergyDelta: -0.9
    }
  ],
  job_day_labor: [
    {
      id: 'cash_job',
      weight: 1.05,
      tone: 'positive',
      titleZhHant: '現領粗工',
      titleEn: 'Cash Labor',
      titleJa: '現金日雇い',
      descriptionZhHant: '這班是現領，錢拿得快，但身體也被磨得很明顯。',
      descriptionEn: 'This was a cash job. The pay came fast, but your body felt every second.',
      descriptionJa: '現金払いの仕事で即金は入ったが、体への負荷も大きかった。',
      moneyFactor: 1.7,
      physicalHealthDelta: -28,
      physicalEnergyDelta: -1.1
    },
    {
      id: 'boss_meal',
      weight: 0.9,
      tone: 'mixed',
      titleZhHant: '老闆請便當',
      titleEn: 'Boss Bought Lunch',
      titleJa: '親方のおごり',
      descriptionZhHant: '工很硬，但中午有人請吃飯，精神稍微穩住一點。',
      descriptionEn: 'The work was rough, but lunch on the boss softened the blow.',
      descriptionJa: '仕事はきつかったが、親方のおごりで少し気持ちが持ち直した。',
      moneyFactor: 1.15,
      physicalEnergyDelta: -0.75,
      spiritHealthDelta: 18
    },
    {
      id: 'wage_docked',
      weight: 0.95,
      tone: 'negative',
      tags: ['mental'],
      mentalStage: 1,
      titleZhHant: '被莫名扣薪',
      titleEn: 'Pay Docked',
      titleJa: '謎の減給',
      descriptionZhHant: '工做完了卻被扣錢，精神壓力整個湧上來。',
      descriptionEn: 'You finished the work, but the pay got cut anyway. The stress hit hard.',
      descriptionJa: '仕事は終えたのに賃金を削られ、ストレスが一気にのしかかった。',
      moneyFactor: 0.48,
      spiritHealthDelta: -36,
      spiritEnergyDelta: -0.6
    },
    {
      id: 'veteran_rate',
      weight: 0.72,
      tone: 'positive',
      titleZhHant: '熟手價加成',
      titleEn: 'Veteran Rate',
      titleJa: '熟練手当',
      descriptionZhHant: '今天接到熟手價，賺得很多，但你也真的快散了。',
      descriptionEn: 'You landed a veteran-rate shift. The money was great, the wear was real.',
      descriptionJa: '熟練手当の現場に入れた。収入は大きいが、消耗も激しい。',
      moneyFactor: 2.08,
      physicalHealthDelta: -40,
      physicalEnergyDelta: -1.3
    }
  ]
});

function roundMetric(value) {
  return Number((Number(value) || 0).toFixed(1));
}

function randomChoice(random, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(values.length - 1, Math.floor(random() * values.length)));
  return values[index];
}

function weightedPick(entries, random, side, heroId) {
  const weighted = entries.map((entry) => {
    let weight = Number(entry.weight || 0);
    const tags = entry.tags ?? [];
    if (tags.includes('mental')) {
      weight *= heroTraitValue(heroId, 'mentalEventWeightMultiplier', 1);
    }
    if (entry.tone === 'positive') {
      weight *= heroTraitValue(heroId, 'jobPositiveWeightMultiplier', 1);
    }
    if (entry.tone === 'negative') {
      weight *= heroTraitValue(heroId, 'jobNegativeWeightMultiplier', 1);
    }
    if (side === 'left' && entry.id === 'extra_shift') {
      weight *= 1;
    }
    return {
      ...entry,
      weight: Math.max(0.01, weight)
    };
  });

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = random() * totalWeight;
  for (const entry of weighted) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return entry;
    }
  }
  return weighted[weighted.length - 1];
}

function clampEventDelta(value, minimum = -9999, maximum = 9999) {
  return Math.max(minimum, Math.min(maximum, roundMetric(value)));
}

function buildMentalStageText(stage, random) {
  if (stage <= 1) {
    return {
      titleZhHant: '精神疾病 I：焦慮失眠',
      titleEn: 'Mental Illness I: Anxiety Spiral',
      titleJa: '精神疾患 I：不安と不眠',
      descriptionZhHant: '壓力累積到開始失眠與焦躁，精神恢復明顯變慢。',
      descriptionEn: 'Pressure built into insomnia and anxiety. Your mind is recovering much slower.',
      descriptionJa: 'ストレスが不眠と焦燥に変わり、メンタルの回復が鈍っている。'
    };
  }

  const mania = random() < 0.5;
  if (mania) {
    return {
      titleZhHant: '精神疾病 II：躁症發作',
      titleEn: 'Mental Illness II: Manic Break',
      titleJa: '精神疾患 II：躁状態',
      descriptionZhHant: '你被高壓與過勞推進躁症狀態，精神耗損進一步擴大。',
      descriptionEn: 'Stress and overwork tipped you into mania, amplifying the mental crash.',
      descriptionJa: '高圧と過労で躁状態に入り、精神の消耗がさらに増した。'
    };
  }

  return {
    titleZhHant: '精神疾病 II：鬱症發作',
    titleEn: 'Mental Illness II: Depressive Crash',
    titleJa: '精神疾患 II：うつ状態',
    descriptionZhHant: '壓力把你壓進鬱症發作，精神與體力一起往下掉。',
    descriptionEn: 'The pressure collapsed into depression, dragging both mind and body down.',
    descriptionJa: 'ストレスがうつ状態へ崩れ、心身の両方が落ち込んだ。'
  };
}

function localizedText(entry, key, fallback) {
  return entry[key] || fallback;
}

function appendBattleEvent(room, event) {
  room.battle.events = [...(room.battle.events ?? []), event].slice(-MAX_BATTLE_EVENTS);
}

function resolveMentalEvent(eventTemplate, heroId, random) {
  const baseStage = Number(eventTemplate.mentalStage || 0);
  if (baseStage <= 0) {
    return {
      ...eventTemplate,
      finalStage: 0,
      finalTitleZhHant: eventTemplate.titleZhHant,
      finalTitleEn: eventTemplate.titleEn,
      finalTitleJa: eventTemplate.titleJa,
      finalDescriptionZhHant: eventTemplate.descriptionZhHant,
      finalDescriptionEn: eventTemplate.descriptionEn,
      finalDescriptionJa: eventTemplate.descriptionJa,
      spiritHealthDelta: roundMetric(eventTemplate.spiritHealthDelta || 0),
      spiritEnergyDelta: roundMetric(eventTemplate.spiritEnergyDelta || 0),
      physicalEnergyDelta: roundMetric(eventTemplate.physicalEnergyDelta || 0)
    };
  }

  const finalStage = Math.max(
    baseStage,
    heroTraitValue(heroId, 'mentalIllnessStageFloor', 1)
  );
  const mentalDamageMultiplier = heroTraitValue(heroId, 'mentalDamageMultiplier', 1);
  let spiritHealthDelta = Number(eventTemplate.spiritHealthDelta || 0) * mentalDamageMultiplier;
  let spiritEnergyDelta = Number(eventTemplate.spiritEnergyDelta || 0) * mentalDamageMultiplier;
  let physicalEnergyDelta = Number(eventTemplate.physicalEnergyDelta || 0);
  if (finalStage >= 2) {
    spiritHealthDelta -= 26;
    spiritEnergyDelta -= 0.7;
    physicalEnergyDelta -= 0.25;
  }
  const mentalText = buildMentalStageText(finalStage, random);
  return {
    ...eventTemplate,
    finalStage,
    finalTitleZhHant: mentalText.titleZhHant,
    finalTitleEn: mentalText.titleEn,
    finalTitleJa: mentalText.titleJa,
    finalDescriptionZhHant: mentalText.descriptionZhHant,
    finalDescriptionEn: mentalText.descriptionEn,
    finalDescriptionJa: mentalText.descriptionJa,
    spiritHealthDelta: roundMetric(spiritHealthDelta),
    spiritEnergyDelta: roundMetric(spiritEnergyDelta),
    physicalEnergyDelta: roundMetric(physicalEnergyDelta)
  };
}

export function isJobCard(card) {
  return String(card?.type || '').trim().toLowerCase() === 'job';
}

export function resolveJobCardEffect(room, side, card, random = Math.random) {
  const profileKey = String(card.effectKind || 'job_part_time');
  const profile = JOB_EVENT_PROFILES[profileKey] ?? JOB_EVENT_PROFILES.job_part_time;
  const heroId = room.players?.[side]?.heroId;
  const picked = weightedPick(profile, random, side, heroId);
  const resolvedMental = resolveMentalEvent(picked, heroId, random);
  const basePay = Number(card.effectValue || 0);
  const moneyMultiplier = heroTraitValue(heroId, 'jobMoneyMultiplier', 1);
  const moneyDelta = clampEventDelta(basePay * Number(resolvedMental.moneyFactor || 0) * moneyMultiplier);
  const physicalHealthDelta = clampEventDelta(resolvedMental.physicalHealthDelta || 0);
  const spiritHealthDelta = clampEventDelta(resolvedMental.spiritHealthDelta || 0);
  const physicalEnergyDelta = clampEventDelta(resolvedMental.physicalEnergyDelta || 0);
  const spiritEnergyDelta = clampEventDelta(resolvedMental.spiritEnergyDelta || 0);

  adjustBattlePlayerResources(room.battle.players[side], {
    moneyDelta,
    physicalHealthDelta,
    spiritHealthDelta,
    physicalEnergyDelta,
    spiritEnergyDelta
  });

  const event = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'job_outcome',
    side,
    cardId: card.id,
    cardName: card.name,
    cardNameZhHant: card.nameZhHant || card.name,
    cardNameEn: card.nameEn || card.name,
    cardNameJa: card.nameJa || card.name,
    title: localizedText(resolvedMental, 'finalTitleEn', resolvedMental.titleEn),
    titleZhHant: localizedText(
      resolvedMental,
      'finalTitleZhHant',
      resolvedMental.titleZhHant
    ),
    titleEn: localizedText(resolvedMental, 'finalTitleEn', resolvedMental.titleEn),
    titleJa: localizedText(resolvedMental, 'finalTitleJa', resolvedMental.titleJa),
    description: localizedText(
      resolvedMental,
      'finalDescriptionEn',
      resolvedMental.descriptionEn
    ),
    descriptionZhHant: localizedText(
      resolvedMental,
      'finalDescriptionZhHant',
      resolvedMental.descriptionZhHant
    ),
    descriptionEn: localizedText(
      resolvedMental,
      'finalDescriptionEn',
      resolvedMental.descriptionEn
    ),
    descriptionJa: localizedText(
      resolvedMental,
      'finalDescriptionJa',
      resolvedMental.descriptionJa
    ),
    tone: resolvedMental.tone || 'mixed',
    mentalStage: Number(resolvedMental.finalStage || 0),
    moneyDelta,
    physicalHealthDelta,
    spiritHealthDelta,
    physicalEnergyDelta,
    spiritEnergyDelta
  };
  appendBattleEvent(room, event);
  return event;
}
