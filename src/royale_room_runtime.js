import {
  CENTER_LATERAL,
  FIELD_ASPECT_RATIO,
  GLOBAL_ATTACK_SPEED_MULTIPLIER,
  LEFT_TOWER_X,
  MAX_FIELD_PROGRESS,
  MIN_FIELD_PROGRESS,
  RIGHT_TOWER_X,
  bodyRadiusForUnitType,
  clamp,
  distanceBetweenPoints,
  effectiveAttackReachToTower,
  effectiveAttackReachToUnit,
  sanitizeLateralPosition,
  sideDirection
} from './royale_battle_rules.js';
import {
  applyBattlePlayerDamage,
  heroBonusMultiplier,
  heroTraitValue,
  regenerateBattlePlayerResources
} from './royale_heroes.js';
import { applyEquipmentEffects } from './royale_room_combat.js';

export function getEnemySide(side) {
  return side === 'left' ? 'right' : 'left';
}

export function regenerateBattleResources(room, dt) {
  for (const side of Object.keys(room.battle.players)) {
    const battlePlayer = room.battle.players[side];
    regenerateBattlePlayerResources(battlePlayer, dt);
  }
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
    if (
      distanceBetweenPoints(
        unit.progress,
        unit.lateralPosition,
        dropPoint.progress,
        dropPoint.lateralPosition
      ) <= card.spellRadius
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
    ) <=
    card.spellRadius + 50
  ) {
    applyBattlePlayerDamage(enemyBattleState, spellDamage, 'spirit');
  }
}

export function spawnBattleUnits(room, side, card, dropPoint, equipmentEffects = []) {
  const count = Math.max(1, card.spawnCount);
  const spacing = count === 1 ? 0 : 30 / FIELD_ASPECT_RATIO;
  const stats = applyEquipmentEffects(card, equipmentEffects);
  const caster = room.players?.[side];
  const unitHpMultiplier = heroBonusMultiplier(
    caster?.heroId,
    'unit_hp_multiplier'
  );
  const boostedHp = Math.max(1, Math.round(stats.hp * unitHpMultiplier));
  const unitDamageMultiplier = heroTraitValue(caster?.heroId, 'unitDamageMultiplier', 1);
  const boostedDamage = Math.max(1, Math.round(stats.damage * unitDamageMultiplier));
  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) / 2) * spacing;
    room.battle.units.push({
      id: `unit-${room.battle.nextUnitId++}`,
      cardId: card.id,
      name: card.name,
      nameZhHant: card.nameZhHant || card.name,
      nameEn: card.nameEn || card.name,
      nameJa: card.nameJa || card.name,
      imageUrl: card.imageUrl || null,
      type: card.type,
      side,
      progress: dropPoint.progress,
      lateralPosition: sanitizeLateralPosition(dropPoint.lateralPosition + offset),
      hp: boostedHp,
      maxHp: boostedHp,
      damage: boostedDamage,
      attackRange: Number(card.attackRange || 0),
      bodyRadius: Number(card.bodyRadius ?? bodyRadiusForUnitType(card.type)),
      moveSpeed: stats.moveSpeed,
      attackSpeed: (card.attackSpeed || 1) * GLOBAL_ATTACK_SPEED_MULTIPLIER,
      targetRule: card.targetRule,
      cooldown: 0,
      effects: equipmentEffects.map((effect) => effect.name)
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

export function performUnitAttack(room, unit, target) {
  if (target.kind === 'unit') {
    target.target.hp -= unit.damage;
    return;
  }

  const enemyBattleState = room.battle.players[target.target];
  applyBattlePlayerDamage(enemyBattleState, unit.damage, 'physical');
}

export function tickBattleUnits(room, dt) {
  for (const unit of room.battle.units) {
    if (unit.hp <= 0) {
      continue;
    }

    unit.cooldown = Math.max(0, unit.cooldown - dt);
    const target = selectUnitTarget(room, unit);
    const attackReach =
      !target
        ? 0
        : target.kind === 'unit'
          ? effectiveAttackReachToUnit(unit, target.target)
          : effectiveAttackReachToTower(unit);
    if (target && target.distance <= attackReach) {
      if (unit.cooldown <= 0) {
        performUnitAttack(room, unit, target);
        unit.cooldown = unit.attackSpeed;
      }
    } else {
      unit.progress = clamp(
        unit.progress + sideDirection(unit.side) * unit.moveSpeed * dt,
        MIN_FIELD_PROGRESS,
        MAX_FIELD_PROGRESS
      );
      const desiredLateral =
        target?.kind === 'unit' ? target.target.lateralPosition : CENTER_LATERAL;
      const lateralDelta = desiredLateral - unit.lateralPosition;
      const lateralStep = (unit.moveSpeed * 0.45 * dt) / FIELD_ASPECT_RATIO;
      unit.lateralPosition = sanitizeLateralPosition(
        unit.lateralPosition + clamp(lateralDelta, -lateralStep, lateralStep)
      );
    }
  }

  room.battle.units = room.battle.units.filter((unit) => unit.hp > 0);
}

export function towerHitPoints(room) {
  return {
    leftTowerHp: room.battle.players.left?.towerHp ?? 0,
    rightTowerHp: room.battle.players.right?.towerHp ?? 0
  };
}

export function winnerSideFromTowers(leftTowerHp, rightTowerHp) {
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
