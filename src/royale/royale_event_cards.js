import { adjustBattlePlayerResources } from './royale_heroes.js';
import { isEventCard, swapCardUseDurability } from './royale_card_progression.js';

const MAX_BATTLE_EVENTS = 6;

function localizedEvent(card, overrides = {}) {
  return {
    id: crypto.randomUUID(),
    kind: 'card_event',
    side: overrides.side,
    cardId: card.id,
    cardName: card.name,
    cardNameZhHant: card.nameZhHant || card.name,
    cardNameEn: card.nameEn || card.name,
    cardNameJa: card.nameJa || card.name,
    title: overrides.titleEn,
    titleZhHant: overrides.titleZhHant,
    titleEn: overrides.titleEn,
    titleJa: overrides.titleJa,
    description: overrides.descriptionEn,
    descriptionZhHant: overrides.descriptionZhHant,
    descriptionEn: overrides.descriptionEn,
    descriptionJa: overrides.descriptionJa,
    tone: overrides.tone || 'mixed',
    mentalStage: 0,
    moneyDelta: Number(overrides.moneyDelta || 0),
    physicalHealthDelta: Number(overrides.physicalHealthDelta || 0),
    spiritHealthDelta: Number(overrides.spiritHealthDelta || 0),
    physicalEnergyDelta: Number(overrides.physicalEnergyDelta || 0),
    spiritEnergyDelta: Number(overrides.spiritEnergyDelta || 0)
  };
}

function pushBattleEvent(room, event) {
  if (!room.battle.events) {
    room.battle.events = [];
  }
  room.battle.events.unshift(event);
  room.battle.events = room.battle.events.slice(0, MAX_BATTLE_EVENTS);
}

export function resolveEventCard(room, side, card) {
  if (!isEventCard(card)) {
    return null;
  }

  const battlePlayer = room.battle.players[side];
  const player = room.players?.[side];

  switch (card.effectKind) {
    case 'event_money': {
      const moneyDelta = Number(card.effectValue || 10);
      adjustBattlePlayerResources(battlePlayer, { moneyDelta });
      const event = localizedEvent(card, {
        side,
        tone: 'positive',
        moneyDelta,
        titleZhHant: '媽媽砸摳',
        titleEn: 'Mom Slipped You Cash',
        titleJa: 'ママから小遣い',
        descriptionZhHant: `媽媽塞了 ${moneyDelta} 塊錢，當場補進你的錢包。`,
        descriptionEn: `Mom slipped you $${moneyDelta}, refilling your wallet immediately.`,
        descriptionJa: `ママから ${moneyDelta} ドルをもらい、所持金が増えた。`
      });
      pushBattleEvent(room, event);
      return event;
    }
    case 'event_swap_card_uses': {
      const changed = swapCardUseDurability(
        battlePlayer,
        Array.isArray(player?.deckCards) ? player.deckCards : []
      );
      const event = localizedEvent(card, {
        side,
        tone: 'mixed',
        titleZhHant: '活網仔的勝利',
        titleEn: 'Victory of the Living Meme',
        titleJa: '生きたネット民の勝利',
        descriptionZhHant: `你的卡牌耐久被反轉，${changed.length} 張牌重新計算剩餘次數。`,
        descriptionEn: `Your card durability was inverted across ${changed.length} cards.`,
        descriptionJa: `${changed.length} 枚のカード使用回数が反転した。`
      });
      pushBattleEvent(room, event);
      return event;
    }
    case 'event_weather': {
      if (room.battle.fieldState) {
        room.battle.fieldState.nextEventMs = 0;
      }
      const event = localizedEvent(card, {
        side,
        tone: 'mixed',
        titleZhHant: '天氣突變',
        titleEn: 'Weather Shift',
        titleJa: '天候変化',
        descriptionZhHant: '天氣事件被立刻推進，下一個場地事件會更快發生。',
        descriptionEn: 'The weather shifts immediately, accelerating the next field event.',
        descriptionJa: '天候が急変し、次のフィールドイベントが早まる。'
      });
      pushBattleEvent(room, event);
      return event;
    }
    default:
      return null;
  }
}
