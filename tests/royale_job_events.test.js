import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInitialBattlePlayerState } from '../src/royale_heroes.js';
import { resolveJobCardEffect } from '../src/royale_job_events.js';

test('resolveJobCardEffect applies money gains and stage-two mental illness for ordinary people', () => {
  const room = {
    players: {
      left: { heroId: 'ordinary_person' }
    },
    battle: {
      players: {
        left: buildInitialBattlePlayerState('ordinary_person'),
        right: buildInitialBattlePlayerState('rich_heir')
      },
      events: []
    }
  };

  const beforeMoney = room.battle.players.left.money;
  const event = resolveJobCardEffect(
    room,
    'left',
    {
      id: 'convenience_shift',
      name: 'Convenience Shift',
      nameZhHant: '超商班',
      nameEn: 'Convenience Shift',
      nameJa: 'コンビニシフト',
      type: 'job',
      effectKind: 'job_part_time',
      effectValue: 10
    },
    () => 0.65
  );

  assert.equal(event.kind, 'job_outcome');
  assert.equal(event.mentalStage, 2);
  assert.ok(event.titleZhHant.includes('II'));
  assert.ok(room.battle.players.left.money > beforeMoney);
  assert.ok(event.spiritHealthDelta < 0);
  assert.equal(room.battle.events.length, 1);
});
