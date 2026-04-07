import {
  CENTER_LATERAL,
  FIELD_ASPECT_RATIO,
  GLOBAL_MOVE_SPEED_MULTIPLIER,
  LEFT_TOWER_X,
  MAX_COMBO_CARDS,
  RIGHT_TOWER_X,
  WORLD_SCALE,
  distanceBetweenPoints,
  sanitizeLanePosition,
  sanitizeLateralPosition,
  sideDirection
} from './royale_battle_rules.js';
import { isJobCard } from './royale_job_events.js';
import { battlePlayerEnergy, totalBattlePlayerEnergy } from './royale_heroes.js';

function cardEnergyCost(card) {
  return Number(card.energyCost || card.elixirCost || 0);
}

function cardEnergyType(card) {
  if (card.energyCostType === 'money') {
    return 'money';
  }
  return card.energyCostType === 'spirit' ? 'spirit' : 'physical';
}

function battlePlayerResourceForType(battlePlayer, resourceType) {
  if (resourceType === 'money') {
    return Number(battlePlayer?.money || 0);
  }
  return battlePlayerEnergy(battlePlayer, resourceType);
}

function canAffordCard(battlePlayer, card) {
  return battlePlayerResourceForType(battlePlayer, cardEnergyType(card)) + 1e-6 >= cardEnergyCost(card);
}

function ownTowerProgress(side) {
  return side === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
}

function averageLateralPosition(units) {
  if (units.length === 0) {
    return CENTER_LATERAL;
  }
  return units.reduce((sum, unit) => sum + unit.lateralPosition, 0) / units.length;
}

function distanceToOwnTower(side, progress) {
  return Math.abs(progress - ownTowerProgress(side));
}

function selectPriorityThreat(side, enemyUnits) {
  if (enemyUnits.length === 0) {
    return null;
  }
  return enemyUnits
    .slice()
    .sort((a, b) => {
      const aTowerDistance = distanceToOwnTower(side, a.progress);
      const bTowerDistance = distanceToOwnTower(side, b.progress);
      const aScore =
        (1000 - aTowerDistance) +
        Number(a.damage || 0) * 0.7 +
        Number(a.maxHp || a.hp || 0) * 0.08 +
        (a.targetRule === 'tower' ? 180 : 0) +
        (a.type === 'swarm' ? 70 : 0);
      const bScore =
        (1000 - bTowerDistance) +
        Number(b.damage || 0) * 0.7 +
        Number(b.maxHp || b.hp || 0) * 0.08 +
        (b.targetRule === 'tower' ? 180 : 0) +
        (b.type === 'swarm' ? 70 : 0);
      return bScore - aScore;
    })[0];
}

function selectAlliedFront(side, alliedUnits) {
  if (alliedUnits.length === 0) {
    return null;
  }
  const direction = sideDirection(side);
  return alliedUnits
    .slice()
    .sort((a, b) => b.progress * direction - a.progress * direction)[0];
}

function isUrgentThreat(side, threat) {
  if (!threat) {
    return false;
  }
  return distanceToOwnTower(side, threat.progress) < 260;
}

function cardPowerScore(card) {
  return (
    Number(card.damage || 0) * 1.25 +
    Number(card.hp || 0) * 0.06 +
    Number(card.attackRange || 0) * 0.18 +
    Number(card.moveSpeed || 0) * 0.1 +
    Math.max(1, Number(card.spawnCount || 1)) * 55
  );
}

function evaluateSpellTarget(room, side, spellCard) {
  const enemyUnits = room.battle.units.filter((unit) => unit.side !== side && unit.hp > 0);
  if (enemyUnits.length === 0) {
    return null;
  }

  let bestTarget = null;
  for (const candidate of enemyUnits) {
    const hitUnits = enemyUnits.filter(
      (unit) =>
        distanceBetweenPoints(
          unit.progress,
          unit.lateralPosition,
          candidate.progress,
          candidate.lateralPosition
        ) <= Number(spellCard.spellRadius || 0)
    );
    if (hitUnits.length === 0) {
      continue;
    }

    const totalDamage = hitUnits.reduce(
      (sum, unit) => sum + Math.min(Number(unit.hp || 0), Number(spellCard.spellDamage || 0)),
      0
    );
    const killCount = hitUnits.filter(
      (unit) => Number(unit.hp || 0) <= Number(spellCard.spellDamage || 0)
    ).length;
    const minimumThreatDistance = Math.min(
      ...hitUnits.map((unit) => distanceToOwnTower(side, unit.progress))
    );
    const score =
      totalDamage +
      hitUnits.length * 110 +
      killCount * 160 +
      (minimumThreatDistance < 260 ? 120 : 0);

    const progress = hitUnits.reduce((sum, unit) => sum + unit.progress, 0) / hitUnits.length;
    const lateralPosition = averageLateralPosition(hitUnits);

    if (!bestTarget || score > bestTarget.score) {
      bestTarget = {
        score,
        progress,
        lateralPosition,
        hits: hitUnits.length,
        kills: killCount
      };
    }
  }

  return bestTarget;
}

function scorePrimaryCard(room, side, battlePlayer, card, alliedFront, threat) {
  const urgentThreat = isUrgentThreat(side, threat);
  const enemySide = side === 'left' ? 'right' : 'left';
  const ownTowerHp = Number(room.battle.players[side]?.towerHp || 0);
  const enemyTowerHp = Number(room.battle.players[enemySide]?.towerHp || 0);

  if (isJobCard(card)) {
    const currentMoney = Number(room.battle.players[side]?.money || 0);
    const maxMoney = Math.max(1, Number(room.battle.players[side]?.maxMoney || 1));
    let score = Number(card.effectValue || 0) * 12 - cardEnergyCost(card) * 6;
    if (currentMoney <= maxMoney * 0.25) {
      score += 180;
    } else if (currentMoney <= maxMoney * 0.5) {
      score += 90;
    } else {
      score -= 40;
    }
    if (urgentThreat) {
      score -= 70;
    }
    return score;
  }

  if (card.type === 'spell') {
    const spellTarget = evaluateSpellTarget(room, side, card);
    if (!spellTarget) {
      return -220;
    }
    let score = spellTarget.score - cardEnergyCost(card) * 12;
    if (spellTarget.kills >= 2) {
      score += 120;
    }
    if (urgentThreat) {
      score += 80;
    }
    return score;
  }

  let score = cardPowerScore(card) - cardEnergyCost(card) * 32;
  if (Number(card.attackRange || 0) >= 200) {
    score += 80;
  }
  if (card.targetRule === 'tower') {
    score += urgentThreat ? -140 : 180;
  }
  if (urgentThreat) {
    score += Number(card.attackRange || 0) >= 200 ? 120 : 50;
    score += Number(card.spawnCount || 1) >= 3 ? 110 : 0;
    score += cardEnergyCost(card) <= 3 ? 70 : 0;
  } else {
    score += alliedFront && Number(card.attackRange || 0) >= 200 ? 130 : 0;
    score += alliedFront && card.targetRule === 'tower' ? 60 : 0;
    score += !alliedFront && card.type === 'tank' ? 90 : 0;
  }

  if (ownTowerHp < enemyTowerHp - 500) {
    score += card.targetRule === 'tower' ? -80 : 90;
  } else if (ownTowerHp > enemyTowerHp + 400) {
    score += card.targetRule === 'tower' ? 60 : 0;
  }

  if (totalBattlePlayerEnergy(battlePlayer) >= 8 && card.type === 'tank') {
    score += 40;
  }

  return score;
}

function scoreEquipmentCard(primaryCard, equipmentCard) {
  let score = 40 - cardEnergyCost(equipmentCard) * 8;
  switch (equipmentCard.effectKind) {
    case 'damage_boost':
      score +=
        Number(primaryCard.damage || 0) * 0.18 +
        Math.max(1, Number(primaryCard.spawnCount || 1)) * 40;
      break;
    case 'health_boost':
      score += Number(primaryCard.hp || 0) * 0.07 + (primaryCard.type === 'tank' ? 80 : 0);
      break;
    case 'speed_boost':
      score += Number(primaryCard.moveSpeed || 0) * 0.18;
      score += primaryCard.targetRule === 'tower' ? 90 : 20;
      break;
    case 'hanger_strike':
      score += Number(primaryCard.damage || 0) * 0.10 + 15;
      break;
    case 'cane_strike':
      score += Number(primaryCard.damage || 0) * 0.16 + 20;
      break;
    case 'bottle_strike':
      score += Number(primaryCard.damage || 0) * 0.12 + 15 + (primaryCard.type === 'tank' ? -30 : 0);
      break;
    case 'western_med':
      score += 20;
      break;
    case 'eastern_med':
      score += 15 + (Number(primaryCard.moveSpeed || 0) > 160 ? 20 : 0);
      break;
    case 'electric_shock':
      score += 10 + (Number(primaryCard.spawnCount || 1) > 1 ? 25 : 0);
      break;
    default:
      score -= 40;
      break;
  }
  return score;
}

function buildBotDropPoint(room, side, primaryCard) {
  const enemyUnits = room.battle.units.filter((unit) => unit.side !== side && unit.hp > 0);
  const alliedUnits = room.battle.units.filter((unit) => unit.side === side && unit.hp > 0);
  const threat = selectPriorityThreat(side, enemyUnits);
  const alliedFront = selectAlliedFront(side, alliedUnits);
  const defaultLateral = averageLateralPosition(enemyUnits);

  if (primaryCard.type === 'spell') {
    const spellTarget = evaluateSpellTarget(room, side, primaryCard);
    if (spellTarget) {
      return {
        progress: sanitizeLanePosition(side, spellTarget.progress),
        lateralPosition: sanitizeLateralPosition(spellTarget.lateralPosition)
      };
    }
  }

  let progress = primaryCard.targetRule === 'tower'
    ? side === 'left'
      ? 360
      : 640
    : side === 'left'
      ? 280
      : 720;
  let lateralPosition = defaultLateral;

  if (isUrgentThreat(side, threat)) {
    const defensiveOffset = Number(primaryCard.attackRange || 0) >= 200 ? 130 : 70;
    progress = threat.progress - sideDirection(side) * defensiveOffset;
    lateralPosition = threat.lateralPosition;
  } else if (alliedFront) {
    const supportOffset =
      Number(primaryCard.attackRange || 0) >= 200
        ? 110
        : primaryCard.targetRule === 'tower'
          ? 30
          : 75;
    progress = alliedFront.progress - sideDirection(side) * supportOffset;
    lateralPosition = alliedFront.lateralPosition;
  } else if (threat) {
    progress = threat.progress - sideDirection(side) * 90;
    lateralPosition = threat.lateralPosition;
  }

  return {
    progress: sanitizeLanePosition(side, progress),
    lateralPosition: sanitizeLateralPosition(lateralPosition)
  };
}

export function buildBotPayload(room, side, comboCards) {
  const primaryCard = comboCards.find((card) => card.type !== 'equipment') ?? comboCards[0];
  const dropPoint = buildBotDropPoint(room, side, primaryCard);
  const jitter = primaryCard?.type === 'spell' ? 0 : 28 / FIELD_ASPECT_RATIO;
  const lateralPosition = sanitizeLateralPosition(
    dropPoint.lateralPosition + (Math.random() - 0.5) * jitter
  );
  const progress = sanitizeLanePosition(side, dropPoint.progress);
  const dropY = side === 'left' ? WORLD_SCALE - progress : progress;

  return {
    cardIds: comboCards.map((card) => card.id),
    lanePosition: progress,
    dropX: lateralPosition,
    dropY
  };
}

export function chooseBotCombo(room, side, player, battlePlayer) {
  const handCards = battlePlayer.hand
    .map((cardId) => player.deckCards.find((card) => card.id === cardId))
    .filter(Boolean);
  const affordable = handCards.filter((card) => canAffordCard(battlePlayer, card));
  if (affordable.length === 0) {
    return [];
  }

  const playableJobs = affordable.filter((card) => isJobCard(card));
  const playableUnits = affordable.filter(
    (card) => !isJobCard(card) && card.type !== 'equipment' && card.type !== 'spell'
  );
  const playableSpells = affordable.filter((card) => card.type === 'spell');
  const playableEquipment = affordable.filter((card) => card.type === 'equipment');

  const enemyUnits = room.battle.units.filter((unit) => unit.side !== side && unit.hp > 0);
  const alliedUnits = room.battle.units.filter((unit) => unit.side === side && unit.hp > 0);
  const threat = selectPriorityThreat(side, enemyUnits);
  const alliedFront = selectAlliedFront(side, alliedUnits);

  const scoredCards = [...playableJobs, ...playableUnits, ...playableSpells]
    .map((card) => ({
      card,
      score: scorePrimaryCard(room, side, battlePlayer, card, alliedFront, threat)
    }))
    .sort((a, b) => b.score - a.score || cardEnergyCost(a.card) - cardEnergyCost(b.card));

  const primaryCard = scoredCards[0]?.card ?? null;

  if (!primaryCard) {
    return [];
  }

  const comboCards = [primaryCard];
  if (!isJobCard(primaryCard) && primaryCard.type !== 'spell' && playableEquipment.length > 0) {
    const remainingPools = {
      physical: battlePlayerEnergy(battlePlayer, 'physical'),
      spirit: battlePlayerEnergy(battlePlayer, 'spirit'),
      money: Number(battlePlayer.money || 0)
    };
    remainingPools[cardEnergyType(primaryCard)] -= cardEnergyCost(primaryCard);
    const scoredEquipment = playableEquipment
      .map((card) => ({
        card,
        score: scoreEquipmentCard(primaryCard, card)
      }))
      .filter((entry) => entry.score > 45)
      .sort((a, b) => b.score - a.score);

    for (const entry of scoredEquipment) {
      if (comboCards.length >= MAX_COMBO_CARDS) {
        break;
      }
      if (cardEnergyCost(entry.card) > remainingPools[cardEnergyType(entry.card)] + 1e-6) {
        continue;
      }
      comboCards.push(entry.card);
      remainingPools[cardEnergyType(entry.card)] -= cardEnergyCost(entry.card);
    }
  }

  return comboCards;
}

export function resolveComboCards(player, battlePlayer, cardIds, sendError) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    sendError('Select at least one card');
    return null;
  }

  if (cardIds.length > MAX_COMBO_CARDS) {
    sendError(`You can cast at most ${MAX_COMBO_CARDS} cards`);
    return null;
  }

  const remainingHand = battlePlayer.hand.slice();
  const comboCards = [];

  for (const rawId of cardIds) {
    const cardId = String(rawId);
    const handIndex = remainingHand.findIndex((entry) => entry === cardId);
    if (handIndex === -1) {
      sendError('One of the selected cards is not in hand');
      return null;
    }
    remainingHand.splice(handIndex, 1);

    const card = player.deckCards.find((entry) => entry.id === cardId);
    if (!card) {
      sendError('Unknown card');
      return null;
    }
    comboCards.push(card);
  }

  if (comboCards.some((card) => isJobCard(card)) && comboCards.length !== 1) {
    sendError('Job cards must be played alone');
    return null;
  }

  return comboCards;
}

export function drawReplacementCards(battlePlayer, cardIds) {
  for (const cardId of cardIds) {
    const handIndex = battlePlayer.hand.findIndex((entry) => entry === cardId);
    if (handIndex === -1) {
      continue;
    }
    battlePlayer.hand.splice(handIndex, 1);
    battlePlayer.queue.push(cardId);
  }

  for (let index = 0; index < cardIds.length; index += 1) {
    const nextCardId = battlePlayer.queue.shift();
    if (nextCardId) {
      battlePlayer.hand.push(nextCardId);
    }
  }
}

const MENTAL_STACK_KINDS = new Set(['hanger_strike', 'cane_strike']);
const STRIKE_DAMAGE_KINDS = new Set(['hanger_strike', 'cane_strike', 'bottle_strike']);

export function equipmentEffects(cards, opts = {}) {
  const { battleState, side } = opts;
  return cards
    .filter((card) => card.type === 'equipment')
    .map((card) => {
      let currentMentalBonus = 0;
      if (battleState && side && MENTAL_STACK_KINDS.has(card.effectKind) && Number(card.mentalStackRate) > 0) {
        if (!battleState.cardMentalBonus) battleState.cardMentalBonus = {};
        const key = `${side}:${card.id}`;
        currentMentalBonus = Number(battleState.cardMentalBonus[key] || 0);
        battleState.cardMentalBonus[key] = currentMentalBonus + Number(card.mentalStackRate);
      }

      const procChances = {};
      if (Number(card.bruiseChance) > 0) procChances.bruise = Number(card.bruiseChance);
      if (Number(card.bleedChance) > 0) procChances.bleed = Number(card.bleedChance);
      if (Number(card.missChance) > 0) procChances.miss = Number(card.missChance);
      const mentalTotal = Number(card.mentalChance || 0) + currentMentalBonus;
      if (mentalTotal > 0) procChances.mental = mentalTotal;
      if (card.effectKind === 'electric_shock') procChances.stun = Number(card.effectValue || 0);
      if (card.effectKind === 'eastern_med') procChances.slow = Number(card.effectValue || 0);

      return {
        id: card.id,
        name: card.name,
        kind: card.effectKind,
        value: Number(card.effectValue || 0),
        procChances: Object.keys(procChances).length > 0 ? procChances : undefined,
        westernMedRoll: card.effectKind === 'western_med' ? Math.random() : undefined
      };
    });
}

export function applyEquipmentEffects(card, effects) {
  let hp = card.hp;
  let damage = card.damage;
  let moveSpeed = card.moveSpeed * GLOBAL_MOVE_SPEED_MULTIPLIER;
  let attackSpeedMultiplier = 1;

  for (const effect of effects) {
    if (effect.kind === 'damage_boost' || STRIKE_DAMAGE_KINDS.has(effect.kind)) {
      damage += effect.value;
    } else if (effect.kind === 'health_boost') {
      hp += effect.value;
    } else if (effect.kind === 'speed_boost') {
      moveSpeed *= 1 + effect.value;
    } else if (effect.kind === 'western_med') {
      const roll = effect.westernMedRoll ?? Math.random();
      if (roll < 0.40) {
        hp += 120;
      } else if (roll < 0.70) {
        damage += 20;
      } else if (roll < 0.90) {
        hp = Math.max(1, hp - 60);
      } else {
        attackSpeedMultiplier *= 0.72;
      }
    }
  }

  return {
    hp: Math.round(hp),
    damage: Math.round(damage),
    moveSpeed: Number(moveSpeed.toFixed(4)),
    attackSpeedMultiplier
  };
}
