import {
  CENTER_LATERAL,
  FIELD_ASPECT_RATIO,
  GLOBAL_MOVE_SPEED_MULTIPLIER,
  MAX_COMBO_CARDS,
  WORLD_SCALE,
  sanitizeLanePosition,
  sanitizeLateralPosition
} from './royale_battle_rules.js';

export function buildBotPayload(room, side, comboCards) {
  const enemyUnits = room.battle.units.filter((unit) => unit.side !== side && unit.hp > 0);
  const averageEnemyLateral = enemyUnits.length
    ? enemyUnits.reduce((sum, unit) => sum + unit.lateralPosition, 0) / enemyUnits.length
    : CENTER_LATERAL;
  const progress = sanitizeLanePosition(
    side,
    side === 'left' ? 260 + Math.random() * 80 : 660 + Math.random() * 80
  );
  const lateralPosition = sanitizeLateralPosition(
    averageEnemyLateral + (Math.random() - 0.5) * (140 / FIELD_ASPECT_RATIO)
  );
  const dropY = side === 'left' ? WORLD_SCALE - progress : progress;

  return {
    cardIds: comboCards.map((card) => card.id),
    lanePosition: progress,
    dropX: lateralPosition,
    dropY
  };
}

export function chooseBotCombo(player, battlePlayer) {
  const handCards = battlePlayer.hand
    .map((cardId) => player.deckCards.find((card) => card.id === cardId))
    .filter(Boolean);
  const affordable = handCards.filter(
    (card) => Number(card.elixirCost || 0) <= battlePlayer.elixir + 1e-6
  );
  if (affordable.length === 0) {
    return [];
  }

  const playableUnits = affordable.filter(
    (card) => card.type !== 'equipment' && card.type !== 'spell'
  );
  const playableSpells = affordable.filter((card) => card.type === 'spell');
  const playableEquipment = affordable.filter((card) => card.type === 'equipment');

  let primaryCard = null;
  if (playableUnits.length > 0) {
    primaryCard = playableUnits[Math.floor(Math.random() * playableUnits.length)];
  } else if (playableSpells.length > 0) {
    primaryCard = playableSpells[Math.floor(Math.random() * playableSpells.length)];
  }

  if (!primaryCard) {
    return [];
  }

  const comboCards = [primaryCard];
  if (primaryCard.type !== 'spell' && playableEquipment.length > 0 && Math.random() < 0.4) {
    const candidate = playableEquipment.find(
      (card) =>
        Number(card.elixirCost || 0) + Number(primaryCard.elixirCost || 0) <=
        battlePlayer.elixir + 1e-6
    );
    if (candidate) {
      comboCards.push(candidate);
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

export function equipmentEffects(cards) {
  return cards
    .filter((card) => card.type === 'equipment')
    .map((card) => ({
      id: card.id,
      name: card.name,
      kind: card.effectKind,
      value: Number(card.effectValue || 0)
    }));
}

export function applyEquipmentEffects(card, effects) {
  let hp = card.hp;
  let damage = card.damage;
  let moveSpeed = card.moveSpeed * GLOBAL_MOVE_SPEED_MULTIPLIER;

  for (const effect of effects) {
    if (effect.kind === 'damage_boost') {
      damage += effect.value;
    } else if (effect.kind === 'health_boost') {
      hp += effect.value;
    } else if (effect.kind === 'speed_boost') {
      moveSpeed *= 1 + effect.value;
    }
  }

  return {
    hp: Math.round(hp),
    damage: Math.round(damage),
    moveSpeed: Number(moveSpeed.toFixed(4))
  };
}
