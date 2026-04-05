import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLlmBotProtocol,
  decideLlmBotAction,
  handleLlmBotMcpPayload
} from '../src/royale_llm_bot.js';

function sampleState() {
  return {
    roomCode: 'BOT123',
    playerSide: 'right',
    timeRemainingMs: 42000,
    players: {
      left: {
        userId: 7,
        name: 'Player',
        heroId: 'ordinary_person',
        isBot: false,
        deckCards: [
          { id: 'knight', name: 'Knight', type: 'tank', energyCost: 4, hp: 980, damage: 150, attackRange: 100, moveSpeed: 140, attackSpeed: 1, spawnCount: 1, targetRule: 'tower' }
        ],
        handCardIds: ['knight'],
        queueCardIds: [],
        towerHp: 1800,
        maxTowerHp: 2000,
        physicalHealth: 900,
        maxPhysicalHealth: 1000,
        physicalHealthRegen: 2,
        spiritHealth: 900,
        maxSpiritHealth: 1000,
        spiritHealthRegen: 2,
        physicalEnergy: 5,
        maxPhysicalEnergy: 10,
        physicalEnergyRegen: 1,
        spiritEnergy: 5,
        maxSpiritEnergy: 10,
        spiritEnergyRegen: 1,
        money: 4,
        maxMoney: 10,
        moneyPerSecond: 0.5
      },
      right: {
        userId: 0,
        name: 'LLM Bot',
        heroId: 'ordinary_person',
        isBot: true,
        botController: 'llm',
        deckCards: [
          { id: 'knight', name: 'Knight', type: 'tank', energyCost: 4, hp: 980, damage: 150, attackRange: 100, moveSpeed: 140, attackSpeed: 1, spawnCount: 1, targetRule: 'tower' },
          { id: 'fireball', name: 'Fireball', type: 'spell', energyCost: 4, energyCostType: 'spirit', spellRadius: 130, spellDamage: 280, attackRange: 0, moveSpeed: 0, attackSpeed: 0, spawnCount: 1, targetRule: 'area' },
          { id: 'helmet', name: 'Helmet', type: 'equipment', energyCost: 2, energyCostType: 'money', effectKind: 'health_boost', effectValue: 120, attackRange: 0, moveSpeed: 0, attackSpeed: 0, spawnCount: 1, targetRule: 'ground' }
        ],
        handCardIds: ['knight', 'fireball', 'helmet'],
        queueCardIds: [],
        towerHp: 1700,
        maxTowerHp: 2000,
        physicalHealth: 850,
        maxPhysicalHealth: 1000,
        physicalHealthRegen: 2,
        spiritHealth: 900,
        maxSpiritHealth: 1000,
        spiritHealthRegen: 2,
        physicalEnergy: 6,
        maxPhysicalEnergy: 10,
        physicalEnergyRegen: 1,
        spiritEnergy: 6,
        maxSpiritEnergy: 10,
        spiritEnergyRegen: 1,
        money: 5,
        maxMoney: 10,
        moneyPerSecond: 0.5
      }
    },
    units: [
      {
        id: 'enemy-1',
        cardId: 'archer',
        side: 'left',
        type: 'ranged',
        progress: 620,
        lateralPosition: 500,
        hp: 180,
        maxHp: 260,
        damage: 110,
        attackRange: 280,
        bodyRadius: 40,
        moveSpeed: 140,
        attackSpeed: 1,
        targetRule: 'ground'
      }
    ],
    events: []
  };
}

test('buildLlmBotProtocol returns wait and playable actions', () => {
  const protocol = buildLlmBotProtocol(sampleState());

  assert.equal(protocol.specVersion, 'ghost-island-brawl-llm-bot/v1');
  assert.equal(protocol.legalActions[0].id, 'wait');
  assert.ok(protocol.legalActions.some((action) => action.kind === 'play'));
  assert.ok(protocol.legalActions.some((action) => action.cardIds.includes('fireball')));
});

test('decideLlmBotAction accepts OpenAI-compatible JSON choice', async () => {
  const protocol = buildLlmBotProtocol(sampleState());
  const chosenAction = protocol.legalActions.find((action) => action.kind === 'play');
  assert.ok(chosenAction);

  const decision = await decideLlmBotAction(
    sampleState(),
    {
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'secret'
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    actionId: chosenAction.id,
                    reason: 'Push now'
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    }
  );

  assert.equal(decision.action.id, chosenAction.id);
  assert.equal(decision.source, 'llm');
  assert.equal(decision.usedFallback, false);
});

test('handleLlmBotMcpPayload lists tools and legal actions', async () => {
  const toolsList = await handleLlmBotMcpPayload(
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    async () => ({})
  );
  assert.equal(toolsList.result.tools.length, 3);

  const toolCall = await handleLlmBotMcpPayload(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'list_legal_actions',
        arguments: {
          state: sampleState()
        }
      }
    },
    async () => ({})
  );

  assert.ok(toolCall.result.structuredContent.legalActions.length >= 2);
});
