import {
  CENTER_LATERAL,
  FIELD_ASPECT_RATIO,
  LEFT_TOWER_X,
  MAX_FIELD_PROGRESS,
  MIN_FIELD_PROGRESS,
  RIGHT_TOWER_X,
  UNIT_COLLISION_GAP,
  UNIT_FORMATION_BIAS_LIMIT,
  bodyRadiusForUnitType,
  clamp,
  distanceBetweenPoints,
  minimumBodyContactDistance,
  sanitizeLateralPosition,
  sanitizeTerrainLateralForProgress,
  sideDirection,
  terrainLimitedProgressForMove,
  terrainNavigationLateralForMove
} from './royale_battle_rules.js';
import {
  inferCardCollisionBehavior,
  normalizeCollisionBehavior
} from './royale_cards.js';

function unitCollisionGap(unit, blocker) {
  return unit.side === blocker.side ? UNIT_COLLISION_GAP : 0;
}

export function unitBodyContactDistance(unit, blocker) {
  return minimumBodyContactDistance(
    Number(unit.bodyRadius || bodyRadiusForUnitType(unit.type)),
    Number(blocker.bodyRadius || bodyRadiusForUnitType(blocker.type)),
    unitCollisionGap(unit, blocker)
  );
}

export function unitDesiredLateral(unit, target) {
  const baseLateral =
    target?.kind === 'unit'
      ? Number(target.target.lateralPosition || CENTER_LATERAL)
      : CENTER_LATERAL;
  const targetProgress =
    target?.kind === 'unit'
      ? Number(target.target.progress || unit.progress || 0)
      : target?.kind === 'tower'
        ? target.target === 'left'
          ? LEFT_TOWER_X
          : RIGHT_TOWER_X
        : unit.side === 'left'
          ? RIGHT_TOWER_X
          : LEFT_TOWER_X;
  const laneBias = clamp(
    Number(unit.laneBias || 0),
    -UNIT_FORMATION_BIAS_LIMIT,
    UNIT_FORMATION_BIAS_LIMIT
  );
  return terrainNavigationLateralForMove(
    Number(unit.progress || 0),
    targetProgress,
    baseLateral + laneBias
  );
}

function unitCollisionBehavior(unit) {
  return normalizeCollisionBehavior(
    unit.collisionBehavior,
    inferCardCollisionBehavior(unit)
  );
}

function findClosestAlliedMovementBlocker(units, unit) {
  let closest = null;
  let bestScore = Infinity;
  const forwardDirection = sideDirection(unit.side);
  const unitProgress = Number(unit.progress || 0);
  const unitLateral = Number(unit.lateralPosition || CENTER_LATERAL);

  for (const blocker of units) {
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

function chooseUnitRerouteSide(units, unit, blocker) {
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

  for (const other of units) {
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

function resolveUnitMovementCollision(
  units,
  unit,
  nextProgress,
  nextLateral,
  minProgress,
  maxProgress
) {
  const startProgress = Number(unit.progress || 0);
  const startScaledLateral =
    Number(unit.lateralPosition || CENTER_LATERAL) * FIELD_ASPECT_RATIO;
  const boundedProgress = clamp(nextProgress, minProgress, maxProgress);
  const rawDesiredLateral = sanitizeLateralPosition(nextLateral);
  const desiredProgress = terrainLimitedProgressForMove(
    startProgress,
    boundedProgress,
    rawDesiredLateral
  );
  const desiredLateral = sanitizeTerrainLateralForProgress(
    desiredProgress,
    rawDesiredLateral
  );
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
  for (const blocker of units) {
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

    if (c <= 1e-6) {
      if (inwardDot < -1e-6) {
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
    for (const blocker of units) {
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
    const clampedLateral = sanitizeTerrainLateralForProgress(
      resolvedProgress,
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
    lateralPosition: sanitizeTerrainLateralForProgress(
      resolvedProgress,
      resolvedScaledLateral / FIELD_ASPECT_RATIO
    )
  };
}

function attemptUnitReroute(units, unit, blocker, effectiveMoveSpeed, dt) {
  if (unitCollisionBehavior(unit) !== 'reroute' || !blocker) {
    return null;
  }

  const rerouteSide = chooseUnitRerouteSide(units, unit, blocker);
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
    units,
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

function movementPlanOrder(left, right) {
  if (left.unit.side === right.unit.side) {
    const direction = sideDirection(left.unit.side);
    const leftForward = Number(left.unit.progress || 0) * direction;
    const rightForward = Number(right.unit.progress || 0) * direction;
    if (leftForward !== rightForward) {
      return rightForward - leftForward;
    }
  }
  return left.index - right.index;
}

export function solveUnitMovementPlan(units, plans) {
  const solverUnits = units.map((unit) => ({ ...unit }));
  const unitIndex = new Map(units.map((unit, index) => [unit, index]));
  const solverByUnit = new Map(
    units.map((unit, index) => [unit, solverUnits[index]])
  );
  const solved = new Map();

  const orderedPlans = plans
    .map((plan) => ({ ...plan, index: unitIndex.get(plan.unit) ?? 0 }))
    .sort(movementPlanOrder);

  for (const plan of orderedPlans) {
    const solverUnit = solverByUnit.get(plan.unit);
    if (!solverUnit || solverUnit.hp <= 0) {
      continue;
    }

    let resolvedMove = resolveUnitMovementCollision(
      solverUnits,
      solverUnit,
      plan.intendedProgress,
      plan.intendedLateral,
      MIN_FIELD_PROGRESS,
      MAX_FIELD_PROGRESS
    );
    const forwardGain =
      sideDirection(solverUnit.side) * (resolvedMove.progress - solverUnit.progress);
    const blockedForward =
      forwardGain <= Math.max(1, Math.abs(plan.progressDelta) * 0.15);
    if (blockedForward) {
      const blocker = findClosestAlliedMovementBlocker(solverUnits, solverUnit);
      const rerouteMove = attemptUnitReroute(
        solverUnits,
        solverUnit,
        blocker,
        plan.effectiveMoveSpeed,
        plan.dt
      );
      if (rerouteMove) {
        resolvedMove = rerouteMove;
      }
    }

    solverUnit.progress = resolvedMove.progress;
    solverUnit.lateralPosition = resolvedMove.lateralPosition;
    solved.set(plan.unit, {
      progress: resolvedMove.progress,
      lateralPosition: resolvedMove.lateralPosition,
      blockedForward
    });
  }

  return solved;
}
