import {
  CENTER_LATERAL,
  FIELD_ASPECT_RATIO,
  GLOBAL_ATTACK_SPEED_MULTIPLIER,
  LEFT_TOWER_X,
  MAX_FIELD_PROGRESS,
  MIN_FIELD_PROGRESS,
  RIGHT_TOWER_X,
  BRUISE_DAMAGE_PER_SECOND,
  BLEED_DAMAGE_PER_SECOND,
  BRUISE_DURATION_MS,
  BLEED_DURATION_MS,
  MENTAL_ILLNESS_DURATION_MS,
  MENTAL_ILLNESS_ATTACK_PENALTY,
  STUN_DURATION_MS,
  SLOW_DURATION_MS,
  SLOW_SPEED_FACTOR,
  UNIT_COLLISION_GAP,
  UNIT_FORMATION_BIAS_LIMIT,
  bodyRadiusForUnitType,
  clamp,
  distanceBetweenPoints,
  effectiveSpellReachToTower,
  effectiveSpellReachToUnit,
  effectiveAttackReachToTower,
  effectiveAttackReachToUnit,
  lateralOffsetForWorldDistance,
  minimumBodyContactDistance,
  sanitizeLateralPosition,
  sideDirection
} from './royale_battle_rules.js';
import {
  inferCardCollisionBehavior,
  normalizeCollisionBehavior
} from './royale_cards.js';
import {
  applyBattlePlayerDamage,
  heroAttackDefinition,
  heroBonusMultiplier,
  heroTraitValue,
  regenerateBattlePlayerResources
} from './royale_heroes.js';
import { applyEquipmentEffects } from './royale_room_combat.js';
import { stealLowValueItemUse } from './royale_card_progression.js';

export function getEnemySide(side) {
  return side === 'left' ? 'right' : 'left';
}

function getTowerProgressForSide(side) {
  return side === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
}

function facingDirectionForVector(progressDelta, lateralDelta) {
  const weightedLateralDelta = lateralDelta * FIELD_ASPECT_RATIO;
  if (
    Math.abs(weightedLateralDelta) >
    Math.max(16, Math.abs(progressDelta) * 0.35)
  ) {
    return lateralDelta < 0 ? 'left' : 'right';
  }
  return 'forward';
}

function updateUnitFacing(unit, target) {
  if (!target) {
    unit.facingDirection = 'forward';
    return;
  }

  const targetProgress =
    target.kind === 'unit'
      ? target.target.progress
      : getTowerProgressForSide(target.target);
  const targetLateral =
    target.kind === 'unit'
      ? target.target.lateralPosition
      : CENTER_LATERAL;
  unit.facingDirection = facingDirectionForVector(
    targetProgress - unit.progress,
    targetLateral - unit.lateralPosition
  );
}

function unitCollisionGap(unit, blocker) {
  return unit.side === blocker.side ? UNIT_COLLISION_GAP : 0;
}

function unitBodyContactDistance(unit, blocker) {
  return minimumBodyContactDistance(
    Number(unit.bodyRadius || bodyRadiusForUnitType(unit.type)),
    Number(blocker.bodyRadius || bodyRadiusForUnitType(blocker.type)),
    unitCollisionGap(unit, blocker)
  );
}

function unitDesiredLateral(unit, target) {
  const baseLateral =
    target?.kind === 'unit'
      ? Number(target.target.lateralPosition || CENTER_LATERAL)
      : CENTER_LATERAL;
  const laneBias = clamp(
    Number(unit.laneBias || 0),
    -UNIT_FORMATION_BIAS_LIMIT,
    UNIT_FORMATION_BIAS_LIMIT
  );
  return sanitizeLateralPosition(baseLateral + laneBias);
}

function unitCollisionBehavior(unit) {
  return normalizeCollisionBehavior(
    unit.collisionBehavior,
    inferCardCollisionBehavior(unit)
  );
}

function findClosestAlliedMovementBlocker(room, unit) {
  let closest = null;
  let bestScore = Infinity;
  const forwardDirection = sideDirection(unit.side);
  const unitProgress = Number(unit.progress || 0);
  const unitLateral = Number(unit.lateralPosition || CENTER_LATERAL);

  for (const blocker of room.battle.units) {
    if (blocker === unit || blocker.hp <= 0 || blocker.side !== unit.side) {
      continue;
    }

    const blockerProgress = Number(blocker.progress || 0);
    const forwardGap = forwardDirection * (blockerProgress - unitProgress);
    if (
      forwardGap <
      -Math.max(
        8,
        Number(blocker.bodyRadius || bodyRadiusForUnitType(blocker.type))
      )
    ) {
      continue;
    }

    const distance = distanceBetweenPoints(
      unitProgress,
      unitLateral,
      blockerProgress,
      Number(blocker.lateralPosition || CENTER_LATERAL)
    );
    const contactDistance = unitBodyContactDistance(unit, blocker);
    if (distance > contactDistance + 48) {
      continue;
    }

    const score = Math.max(0, forwardGap) * 2 + distance;
    if (score < bestScore) {
      bestScore = score;
      closest = blocker;
    }
  }

  return closest;
}

function chooseUnitRerouteSide(room, unit, blocker) {
  const laneBias = Number(unit.laneBias || 0);
  if (laneBias > 1) {
    return 1;
  }
  if (laneBias < -1) {
    return -1;
  }

  if (blocker) {
    const lateralDelta =
      Number(blocker.lateralPosition || CENTER_LATERAL) -
      Number(unit.lateralPosition || CENTER_LATERAL);
    if (Math.abs(lateralDelta) > 1e-3) {
      return lateralDelta < 0 ? 1 : -1;
    }
  }

  let leftPenalty = 0;
  let rightPenalty = 0;
  const unitProgress = Number(unit.progress || 0);
  const unitLateral = Number(unit.lateralPosition || CENTER_LATERAL);

  for (const other of room.battle.units) {
    if (other === unit || other.hp <= 0 || other.side !== unit.side) {
      continue;
    }

    const progressGap = Math.abs(Number(other.progress || 0) - unitProgress);
    if (progressGap > 140) {
      continue;
    }

    const penalty = 160 - progressGap;
    if (Number(other.lateralPosition || CENTER_LATERAL) <= unitLateral) {
      leftPenalty += penalty;
    }
    if (Number(other.lateralPosition || CENTER_LATERAL) >= unitLateral) {
      rightPenalty += penalty;
    }
  }

  if (leftPenalty !== rightPenalty) {
    return leftPenalty < rightPenalty ? -1 : 1;
  }
  if (unitLateral < CENTER_LATERAL - 4) {
    return -1;
  }
  if (unitLateral > CENTER_LATERAL + 4) {
    return 1;
  }

  const idHash = Array.from(String(unit.id || '')).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0
  );
  return idHash % 2 === 0 ? -1 : 1;
}

function attemptUnitReroute(room, unit, blocker, effectiveMoveSpeed, dt) {
  if (unitCollisionBehavior(unit) !== 'reroute' || !blocker) {
    return null;
  }

  const rerouteSide = chooseUnitRerouteSide(room, unit, blocker);
  const moveBudget = Math.max(8, effectiveMoveSpeed * dt);
  const progressWeight = -sideDirection(unit.side) * 0.8;
  const scaledLateralWeight = rerouteSide * 0.6;
  const vectorLength = Math.hypot(progressWeight, scaledLateralWeight);
  const detourProgress =
    Number(unit.progress || 0) + (progressWeight / vectorLength) * moveBudget;
  const detourScaledLateral =
    Number(unit.lateralPosition || CENTER_LATERAL) * FIELD_ASPECT_RATIO +
    (scaledLateralWeight / vectorLength) * moveBudget;
  const rerouteMove = resolveUnitMovementCollision(
    room,
    unit,
    detourProgress,
    detourScaledLateral / FIELD_ASPECT_RATIO,
    MIN_FIELD_PROGRESS,
    MAX_FIELD_PROGRESS
  );
  const rerouteDistance = distanceBetweenPoints(
    Number(unit.progress || 0),
    Number(unit.lateralPosition || CENTER_LATERAL),
    rerouteMove.progress,
    rerouteMove.lateralPosition
  );
  return rerouteDistance > 1e-3 ? rerouteMove : null;
}

function resolveUnitMovementCollision(room, unit, nextProgress, nextLateral, minProgress, maxProgress) {
  // Use the same scaled lateral space as distanceBetweenPoints so body contact stays consistent.
  const startProgress = Number(unit.progress || 0);
  const startScaledLateral = Number(unit.lateralPosition || CENTER_LATERAL) * FIELD_ASPECT_RATIO;
  const desiredProgress = clamp(nextProgress, minProgress, maxProgress);
  const desiredLateral = sanitizeLateralPosition(nextLateral);
  const desiredScaledLateral = desiredLateral * FIELD_ASPECT_RATIO;
  const deltaProgress = desiredProgress - startProgress;
  const deltaScaledLateral = desiredScaledLateral - startScaledLateral;
  const movementLengthSquared =
    deltaProgress * deltaProgress + deltaScaledLateral * deltaScaledLateral;

  if (movementLengthSquared <= 1e-9) {
    return {
      progress: desiredProgress,
      lateralPosition: desiredLateral
    };
  }

  let bestT = 1;
  for (const blocker of room.battle.units) {
    if (blocker === unit || blocker.hp <= 0) {
      continue;
    }

    const minDistance = unitBodyContactDistance(unit, blocker);
    const blockerScaledLateral =
      Number(blocker.lateralPosition || CENTER_LATERAL) * FIELD_ASPECT_RATIO;
    const relativeStartProgress = startProgress - Number(blocker.progress || 0);
    const relativeStartScaledLateral = startScaledLateral - blockerScaledLateral;
    const a = movementLengthSquared;
    const b =
      2 *
      (
        relativeStartProgress * deltaProgress +
        relativeStartScaledLateral * deltaScaledLateral
      );
    const c =
      relativeStartProgress * relativeStartProgress +
      relativeStartScaledLateral * relativeStartScaledLateral -
      minDistance * minDistance;
    const inwardDot =
      relativeStartProgress * deltaProgress +
      relativeStartScaledLateral * deltaScaledLateral;

    // When units start exactly at body contact, allow tangent/outward movement.
    if (c <= 1e-6) {
      if (c < -1e-6 || inwardDot < -1e-6) {
        bestT = 0;
      }
      continue;
    }

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      continue;
    }

    const collisionT = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (collisionT >= 0 && collisionT <= 1 && collisionT < bestT) {
      bestT = collisionT;
    }
  }

  let resolvedProgress = startProgress + deltaProgress * bestT;
  let resolvedScaledLateral = startScaledLateral + deltaScaledLateral * bestT;

  for (let pass = 0; pass < 2; pass += 1) {
    let adjusted = false;
    for (const blocker of room.battle.units) {
      if (blocker === unit || blocker.hp <= 0) {
        continue;
      }

      const minDistance = unitBodyContactDistance(unit, blocker);
      const blockerProgress = Number(blocker.progress || 0);
      const blockerScaledLateral =
        Number(blocker.lateralPosition || CENTER_LATERAL) * FIELD_ASPECT_RATIO;
      let relativeProgress = resolvedProgress - blockerProgress;
      let relativeScaledLateral = resolvedScaledLateral - blockerScaledLateral;
      let distance = Math.hypot(relativeProgress, relativeScaledLateral);
      if (distance + 1e-6 >= minDistance) {
        continue;
      }

      if (distance <= 1e-6) {
        relativeProgress = startProgress - blockerProgress;
        relativeScaledLateral = startScaledLateral - blockerScaledLateral;
        distance = Math.hypot(relativeProgress, relativeScaledLateral);
      }

      if (distance <= 1e-6) {
        relativeProgress = -sideDirection(unit.side);
        relativeScaledLateral = 0;
        distance = 1;
      }

      const scale = minDistance / distance;
      resolvedProgress = blockerProgress + relativeProgress * scale;
      resolvedScaledLateral = blockerScaledLateral + relativeScaledLateral * scale;
      adjusted = true;
    }

    resolvedProgress = clamp(resolvedProgress, minProgress, maxProgress);
    const clampedLateral = sanitizeLateralPosition(
      resolvedScaledLateral / FIELD_ASPECT_RATIO
    );
    resolvedScaledLateral = clampedLateral * FIELD_ASPECT_RATIO;
    if (!adjusted) {
      return {
        progress: resolvedProgress,
        lateralPosition: clampedLateral
      };
    }
  }

  return {
    progress: resolvedProgress,
    lateralPosition: sanitizeLateralPosition(
      resolvedScaledLateral / FIELD_ASPECT_RATIO
    )
  };
}

function triggerUnitAnimationEvent(unit, animation) {
  const nextId = Number(unit.animationEventId || unit.animationEvent?.id || 0) + 1;
  unit.animationEventId = nextId;
  unit.animationEvent = {
    animation,
    id: nextId
  };
}

export function regenerateBattleResources(room, dt) {
  for (const side of Object.keys(room.battle.players)) {
    const battlePlayer = room.battle.players[side];
    regenerateBattlePlayerResources(battlePlayer, dt);
  }
}

function towerPointForSide(side) {
  return {
    progress: getTowerProgressForSide(side),
    lateralPosition: CENTER_LATERAL
  };
}

function triggerHeroAttackEvent(battlePlayer, targetUnit, attack) {
  const nextId = Number(battlePlayer.heroAttackEventId || battlePlayer.heroAttackEvent?.id || 0) + 1;
  battlePlayer.heroAttackEventId = nextId;
  battlePlayer.heroAttackEvent = {
    id: nextId,
    animation: 'attack',
    targetUnitId: targetUnit.id,
    damage: attack.damage,
    damageType: attack.damageType
  };
}

function selectHeroAttackTarget(room, side, attack) {
  const origin = towerPointForSide(side);
  return room.battle.units
    .filter((unit) => unit.side !== side && unit.hp > 0)
    .map((unit) => ({
      unit,
      distance: distanceBetweenPoints(
        origin.progress,
        origin.lateralPosition,
        unit.progress,
        unit.lateralPosition
      )
    }))
    .filter((entry) => entry.distance <= attack.range + Number(entry.unit.bodyRadius || bodyRadiusForUnitType(entry.unit.type)))
    .sort((a, b) => a.distance - b.distance)[0]?.unit ?? null;
}

export function tickHeroAttacks(room, dt) {
  for (const [side, battlePlayer] of Object.entries(room.battle.players)) {
    const player = room.players?.[side];
    const attack = heroAttackDefinition(player?.heroId);
    battlePlayer.heroAttackCooldown = Math.max(
      0,
      Number(battlePlayer.heroAttackCooldown || 0) - dt
    );
    if (battlePlayer.heroAttackCooldown > 0 || attack.damage <= 0 || attack.range <= 0) {
      continue;
    }

    const target = selectHeroAttackTarget(room, side, attack);
    if (!target) {
      continue;
    }

    target.hp -= attack.damage;
    battlePlayer.heroAttackCooldown = attack.attackSpeed;
    triggerHeroAttackEvent(battlePlayer, target, attack);
  }

  room.battle.units = room.battle.units.filter((unit) => unit.hp > 0);
}

export function resolveSpellEffect(room, side, card, dropPoint) {
  const enemySide = getEnemySide(side);
  const enemyBattleState = room.battle.players[enemySide];
  const caster = room.players?.[side];
  const spellDamageMultiplier = heroBonusMultiplier(
    caster?.heroId,
    'spell_damage_multiplier'
  );
  const spellDamage = Math.round(Number(card.spellDamage || 0) * spellDamageMultiplier);

  for (const unit of room.battle.units) {
    if (unit.side === side) {
      continue;
    }
    const spellReach = effectiveSpellReachToUnit(card.spellRadius, unit);
    if (
      distanceBetweenPoints(
        unit.progress,
        unit.lateralPosition,
        dropPoint.progress,
        dropPoint.lateralPosition
      ) <= spellReach
    ) {
      unit.hp -= spellDamage;
    }
  }

  const towerProgress = enemySide === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
  if (
    distanceBetweenPoints(
      towerProgress,
      CENTER_LATERAL,
      dropPoint.progress,
      dropPoint.lateralPosition
    ) <= effectiveSpellReachToTower(card.spellRadius)
  ) {
    applyBattlePlayerDamage(enemyBattleState, spellDamage, 'spirit');
  }
}

export function spawnBattleUnits(
  room,
  side,
  card,
  dropPoint,
  equipmentEffects = [],
  groupLateralOffset = 0
) {
  const count = Math.max(1, card.spawnCount);
  const stats = applyEquipmentEffects(card, equipmentEffects);
  const caster = room.players?.[side];
  const bodyRadius = Number(card.bodyRadius || bodyRadiusForUnitType(card.type));
  const spacing =
    count === 1
      ? 0
      : lateralOffsetForWorldDistance(
          minimumBodyContactDistance(bodyRadius, bodyRadius, UNIT_COLLISION_GAP)
        );
  const unitHpMultiplier = heroBonusMultiplier(
    caster?.heroId,
    'unit_hp_multiplier'
  );
  const boostedHp = Math.max(1, Math.round(stats.hp * unitHpMultiplier));
  const unitDamageMultiplier = heroTraitValue(
    caster?.heroId,
    'unitDamageMultiplier',
    1
  );
  const boostedDamage = Math.max(1, Math.round(stats.damage * unitDamageMultiplier));

  const aggregatedProcs = {};
  for (const effect of equipmentEffects) {
    if (!effect.procChances) continue;
    for (const [kind, chance] of Object.entries(effect.procChances)) {
      aggregatedProcs[kind] = (aggregatedProcs[kind] || 0) + chance;
    }
  }
  const hasProcChances = Object.keys(aggregatedProcs).length > 0;

  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) / 2) * spacing;
    const spawnLateral = sanitizeLateralPosition(
      dropPoint.lateralPosition + groupLateralOffset + offset
    );
    room.battle.units.push({
      id: `unit-${room.battle.nextUnitId++}`,
      cardId: card.id,
      name: card.name,
      nameZhHant: card.nameZhHant || card.name,
      nameEn: card.nameEn || card.name,
      nameJa: card.nameJa || card.name,
      imageUrl: card.imageUrl || null,
      characterImageUrl: card.characterImageUrl || card.imageUrl || null,
      characterFrontImageUrl:
        card.characterFrontImageUrl ||
        card.characterImageUrl ||
        card.imageUrl ||
        null,
      characterBackImageUrl: card.characterBackImageUrl || null,
      characterLeftImageUrl: card.characterLeftImageUrl || null,
      characterRightImageUrl: card.characterRightImageUrl || null,
      characterAssets: Array.isArray(card.characterAssets)
        ? card.characterAssets
        : [],
      type: card.type,
      side,
      facingDirection: 'forward',
      animationState: 'move',
      animationEvent: null,
      animationEventId: 0,
      progress: dropPoint.progress,
      lateralPosition: spawnLateral,
      hp: boostedHp,
      maxHp: boostedHp,
      damage: boostedDamage,
      attackRange: Number(card.attackRange || 0),
      bodyRadius,
      collisionBehavior: normalizeCollisionBehavior(
        card.collisionBehavior,
        inferCardCollisionBehavior(card)
      ),
      laneBias: clamp(
        spawnLateral - CENTER_LATERAL,
        -UNIT_FORMATION_BIAS_LIMIT,
        UNIT_FORMATION_BIAS_LIMIT
      ),
      moveSpeed: stats.moveSpeed,
      attackSpeed:
        (card.attackSpeed || 1) *
        GLOBAL_ATTACK_SPEED_MULTIPLIER *
        (stats.attackSpeedMultiplier ?? 1),
      degenerationPerSecond: Number(stats.degenerationPerSecond || 0),
      targetRule: card.targetRule,
      cooldown: 0,
      effects: equipmentEffects.map((effect) => effect.name),
      procChances: hasProcChances ? { ...aggregatedProcs } : undefined,
      statusEffects: []
    });
  }
}

export function selectUnitTarget(room, unit) {
  const direction = sideDirection(unit.side);
  const enemySide = getEnemySide(unit.side);
  const towerProgress = enemySide === 'left' ? LEFT_TOWER_X : RIGHT_TOWER_X;
  const towerForwardDistance = (towerProgress - unit.progress) * direction;
  const towerDistance = distanceBetweenPoints(
    unit.progress,
    unit.lateralPosition,
    towerProgress,
    CENTER_LATERAL
  );
  const towerReach = effectiveAttackReachToTower(unit);

  if (unit.targetRule === 'tower') {
    if (towerForwardDistance >= 0 && towerDistance <= towerReach) {
      return {
        kind: 'tower',
        target: enemySide,
        distance: towerDistance
      };
    }
    return null;
  }

  const enemyUnits = room.battle.units
    .filter((entry) => entry.side !== unit.side && entry.hp > 0)
    .map((entry) => ({
      kind: 'unit',
      target: entry,
      forwardDistance: (entry.progress - unit.progress) * direction,
      distance: distanceBetweenPoints(
        unit.progress,
        unit.lateralPosition,
        entry.progress,
        entry.lateralPosition
      )
    }))
    .filter((entry) => entry.forwardDistance >= -20);

  enemyUnits.sort((a, b) => a.distance - b.distance);
  const enemyUnit = enemyUnits[0];
  if (
    enemyUnit &&
    enemyUnit.distance <= effectiveAttackReachToUnit(unit, enemyUnit.target)
  ) {
    return enemyUnit;
  }

  if (towerForwardDistance >= 0 && towerDistance <= towerReach) {
    return {
      kind: 'tower',
      target: enemySide,
      distance: towerDistance
    };
  }

  return enemyUnit && enemyUnit.forwardDistance < 120 ? enemyUnit : null;
}

function applyStatusEffect(unit, kind) {
  const durations = {
    bruise: BRUISE_DURATION_MS,
    bleed: BLEED_DURATION_MS,
    mental_illness: MENTAL_ILLNESS_DURATION_MS,
    stun: STUN_DURATION_MS,
    slow: SLOW_DURATION_MS
  };
  const duration = durations[kind] ?? 3000;
  if (!unit.statusEffects) unit.statusEffects = [];
  const existing = unit.statusEffects.find((e) => e.kind === kind);
  if (existing) {
    existing.remainingMs = Math.max(existing.remainingMs, duration);
  } else {
    unit.statusEffects.push({ kind, remainingMs: duration });
  }
}

function rollStatusEffectProcs(attacker, targetUnit) {
  const procs = attacker.procChances;
  if (!procs) return;
  if (procs.bruise > 0 && Math.random() < procs.bruise) applyStatusEffect(targetUnit, 'bruise');
  if (procs.bleed > 0 && Math.random() < procs.bleed) applyStatusEffect(targetUnit, 'bleed');
  if (procs.mental > 0 && Math.random() < procs.mental) {
    applyStatusEffect(targetUnit, 'mental_illness');
  }
  if (procs.stun > 0 && Math.random() < procs.stun) applyStatusEffect(targetUnit, 'stun');
  if (procs.slow > 0 && Math.random() < procs.slow) applyStatusEffect(targetUnit, 'slow');
}

export function performUnitAttack(room, unit, target) {
  if (Number(unit.procChances?.miss) > 0 && Math.random() < unit.procChances.miss) {
    return;
  }

  if (target.kind === 'unit') {
    target.target.hp -= unit.damage;
    rollStatusEffectProcs(unit, target.target);
    return;
  }

  const enemyBattleState = room.battle.players[target.target];
  applyBattlePlayerDamage(enemyBattleState, unit.damage, 'physical');
  if (unit.cardId === 'roadside_elder') {
    const enemyPlayer = room.players?.[target.target];
    const stolen = stealLowValueItemUse(
      enemyBattleState,
      Array.isArray(enemyPlayer?.deckCards) ? enemyPlayer.deckCards : []
    );
    if (stolen) {
      if (!room.battle.events) {
        room.battle.events = [];
      }
      room.battle.events.unshift({
        id: crypto.randomUUID(),
        kind: 'item_stolen',
        side: unit.side,
        cardId: stolen.cardId,
        cardName: stolen.cardName || stolen.cardId,
        cardNameZhHant: stolen.cardName || stolen.cardId,
        cardNameEn: stolen.cardName || stolen.cardId,
        cardNameJa: stolen.cardName || stolen.cardId,
        title: 'Cheap Item Stolen',
        titleZhHant: '低價物品被偷',
        titleEn: 'Cheap Item Stolen',
        titleJa: '安いアイテムを盗まれた',
        description: 'A roadside elder stole one remaining use from a cheap item.',
        descriptionZhHant: '路邊老人摸走了一個低價道具的剩餘次數。',
        descriptionEn: 'A roadside elder stole one remaining use from a cheap item.',
        descriptionJa: '路上の老人が安いアイテムの残り使用回数を 1 回盗んだ。',
        tone: 'negative',
        mentalStage: 0,
        moneyDelta: 0,
        physicalHealthDelta: 0,
        spiritHealthDelta: 0,
        physicalEnergyDelta: 0,
        spiritEnergyDelta: 0
      });
      room.battle.events = room.battle.events.slice(0, 6);
    }
  }
}

export function tickBattleUnits(room, dt) {
  // Phase 1: tick status effect DoT and expiry
  for (const unit of room.battle.units) {
    if (!unit.statusEffects?.length) continue;
    const keepEffects = [];
    for (const effect of unit.statusEffects) {
      effect.remainingMs -= dt * 1000;
      if (effect.remainingMs > 0) {
        if (effect.kind === 'bruise') unit.hp -= BRUISE_DAMAGE_PER_SECOND * dt;
        else if (effect.kind === 'bleed') unit.hp -= BLEED_DAMAGE_PER_SECOND * dt;
        keepEffects.push(effect);
      }
    }
    unit.statusEffects = keepEffects;
  }

  // Phase 2: movement and combat
  for (const unit of room.battle.units) {
    if (unit.hp <= 0) {
      continue;
    }
    if (Number(unit.degenerationPerSecond || 0) > 0) {
      unit.hp -= Number(unit.degenerationPerSecond || 0) * dt;
      if (unit.hp <= 0) {
        continue;
      }
    }

    const isStunned = unit.statusEffects?.some((e) => e.kind === 'stun') ?? false;
    unit.cooldown = Math.max(0, unit.cooldown - dt);

    if (isStunned) {
      unit.animationState = 'idle';
      continue;
    }

    const hasSlow = unit.statusEffects?.some((e) => e.kind === 'slow') ?? false;
    const hasMentalIllness = unit.statusEffects?.some((e) => e.kind === 'mental_illness') ?? false;
    const effectiveMoveSpeed = hasSlow ? unit.moveSpeed * SLOW_SPEED_FACTOR : unit.moveSpeed;

    const target = selectUnitTarget(room, unit);
    const attackReach =
      !target
        ? 0
        : target.kind === 'unit'
          ? effectiveAttackReachToUnit(unit, target.target)
          : effectiveAttackReachToTower(unit);
    if (target && target.distance <= attackReach) {
      updateUnitFacing(unit, target);
      unit.animationState = 'idle';
      if (unit.cooldown <= 0) {
        performUnitAttack(room, unit, target);
        triggerUnitAnimationEvent(unit, 'attack');
        unit.cooldown = hasMentalIllness
          ? unit.attackSpeed * (1 + MENTAL_ILLNESS_ATTACK_PENALTY)
          : unit.attackSpeed;
      }
    } else {
      unit.animationState = 'move';
      const progressDelta = sideDirection(unit.side) * effectiveMoveSpeed * dt;
      const desiredLateral = unitDesiredLateral(unit, target);
      const lateralDelta = desiredLateral - unit.lateralPosition;
      unit.facingDirection = facingDirectionForVector(progressDelta, lateralDelta);
      const lateralStep = (effectiveMoveSpeed * 0.45 * dt) / FIELD_ASPECT_RATIO;
      const intendedProgress = unit.progress + progressDelta;
      const intendedLateral =
        unit.lateralPosition + clamp(lateralDelta, -lateralStep, lateralStep);
      let resolvedMove = resolveUnitMovementCollision(
        room,
        unit,
        intendedProgress,
        intendedLateral,
        MIN_FIELD_PROGRESS,
        MAX_FIELD_PROGRESS
      );
      const forwardGain =
        sideDirection(unit.side) * (resolvedMove.progress - unit.progress);
      const blockedForward =
        forwardGain <= Math.max(1, Math.abs(progressDelta) * 0.15);
      if (blockedForward) {
        const blocker = findClosestAlliedMovementBlocker(room, unit);
        const rerouteMove = attemptUnitReroute(
          room,
          unit,
          blocker,
          effectiveMoveSpeed,
          dt
        );
        if (rerouteMove) {
          resolvedMove = rerouteMove;
        }
      }
      unit.facingDirection = facingDirectionForVector(
        resolvedMove.progress - unit.progress,
        resolvedMove.lateralPosition - unit.lateralPosition
      );
      unit.progress = resolvedMove.progress;
      unit.lateralPosition = resolvedMove.lateralPosition;
    }
  }

  room.battle.units = room.battle.units.filter((unit) => unit.hp > 0);
}

export function towerHitPoints(room) {
  const leftPlayer = room.battle.players.left;
  const rightPlayer = room.battle.players.right;
  return {
    leftTowerHp: leftPlayer?.towerHp ?? 0,
    rightTowerHp: rightPlayer?.towerHp ?? 0,
    leftPhysicalHealth: Number(leftPlayer?.physicalHealth ?? leftPlayer?.towerHp ?? 0),
    rightPhysicalHealth: Number(rightPlayer?.physicalHealth ?? rightPlayer?.towerHp ?? 0),
    leftSpiritHealth: Number(leftPlayer?.spiritHealth ?? 0),
    rightSpiritHealth: Number(rightPlayer?.spiritHealth ?? 0),
    leftDefeated: battlePlayerIsDefeated(leftPlayer),
    rightDefeated: battlePlayerIsDefeated(rightPlayer)
  };
}

export function battlePlayerIsDefeated(player) {
  if (!player) {
    return true;
  }

  const hasPhysicalTrack = Number(player.maxPhysicalHealth || 0) > 0;
  const hasSpiritTrack = Number(player.maxSpiritHealth || 0) > 0;
  if (hasPhysicalTrack && Number(player.physicalHealth || 0) <= 0) {
    return true;
  }
  if (hasSpiritTrack && Number(player.spiritHealth || 0) <= 0) {
    return true;
  }
  if (!hasPhysicalTrack && !hasSpiritTrack) {
    return Number(player.towerHp || 0) <= 0;
  }
  return false;
}

export function winnerSideFromTowers(leftTowerHpOrState, maybeRightTowerHp) {
  if (typeof leftTowerHpOrState === 'object' && leftTowerHpOrState !== null) {
    const {
      leftTowerHp,
      rightTowerHp,
      leftDefeated = false,
      rightDefeated = false
    } = leftTowerHpOrState;
    if (leftDefeated || rightDefeated) {
      return leftDefeated && rightDefeated
        ? null
        : leftDefeated
          ? 'right'
          : 'left';
    }
    return winnerSideFromTowers(leftTowerHp, rightTowerHp);
  }

  const leftTowerHp = Number(leftTowerHpOrState || 0);
  const rightTowerHp = Number(maybeRightTowerHp || 0);
  if (leftTowerHp <= 0 || rightTowerHp <= 0) {
    return leftTowerHp <= 0 && rightTowerHp <= 0
      ? null
      : leftTowerHp <= 0
        ? 'right'
        : 'left';
  }

  if (leftTowerHp !== rightTowerHp) {
    return leftTowerHp > rightTowerHp ? 'left' : 'right';
  }

  return null;
}
