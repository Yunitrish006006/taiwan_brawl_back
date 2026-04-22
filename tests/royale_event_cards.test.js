import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEventCard } from '../src/royale_event_cards.js';

test('mom event grants money immediately', () => {
  const room = {
    battle: {
      players: {
        left: {
          money: 2,
          maxMoney: 20,
          physicalHealth: 100,
          maxPhysicalHealth: 100,
          spiritHealth: 0,
          maxSpiritHealth: 0,
          physicalEnergy: 0,
          maxPhysicalEnergy: 0,
          spiritEnergy: 0,
          maxSpiritEnergy: 0
        }
      },
      events: []
    }
  };

  const event = resolveEventCard(room, 'left', {
    id: 'mom_gives_money',
    name: '媽媽砸摳',
    type: 'event',
    effectKind: 'event_money',
    effectValue: 10
  });

  assert.equal(room.battle.players.left.money, 12);
  assert.equal(event.moneyDelta, 10);
  assert.equal(room.battle.events[0].cardId, 'mom_gives_money');
});

test('pig brother event swaps used and remaining card durability', () => {
  const room = {
    players: {
      left: {
        deckCards: [
          { id: 'knight', type: 'melee' },
          { id: 'archer', type: 'ranged' }
        ]
      }
    },
    battle: {
      players: {
        left: {
          cardUses: { knight: 5, archer: 1 },
          cardUseLimits: { knight: 8, archer: 8 }
        }
      },
      events: []
    }
  };

  resolveEventCard(room, 'left', {
    id: 'pig_brother_alive',
    name: '豬大哥還沒死',
    type: 'event',
    effectKind: 'event_swap_card_uses'
  });

  assert.equal(room.battle.players.left.cardUses.knight, 3);
  assert.equal(room.battle.players.left.cardUses.archer, 7);
  assert.equal(room.battle.events[0].kind, 'card_event');
});
