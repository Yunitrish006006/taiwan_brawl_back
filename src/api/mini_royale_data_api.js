import {
  getDeckForUser,
  listCards,
  listDecksForUser,
  listDeckSummariesForUser,
  saveDeckForUser
} from '../royale/royale_repository.js';
import {
  listDeckProgressionForUser,
  listProgressionHeroOptions,
  selectDeckProgressionHero
} from '../royale/royale_progression.js';
import { listHeroDefinitions, registerUnitHeroDefinitions } from '../royale/royale_heroes.js';
import { withAuthenticatedUser } from '../core/request_helpers.js';
import { jsonResponse } from '../core/utils.js';
import { mapMiniRoyaleApiPath } from './game_api_paths.js';

async function handleListCards(request, env) {
  const cards = await listCards(env);
  return jsonResponse({ ok: true, cards }, 200, request);
}

async function handleListHeroes(request, env) {
  const cards = await listCards(env);
  registerUnitHeroDefinitions(cards);
  return jsonResponse({ ok: true, heroes: listHeroDefinitions() }, 200, request);
}

async function handleListProgression(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const cards = await listCards(env);
    const progression = await listDeckProgressionForUser(env, user.id);
    return jsonResponse(
      {
        ok: true,
        heroOptions: listProgressionHeroOptions(cards),
        progression
      },
      200,
      request
    );
  });
}

async function handleListDecks(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const url = new URL(request.url);
    const summary = ['1', 'true', 'yes'].includes(
      String(url.searchParams.get('summary') || '').toLowerCase()
    );
    const decks = summary
      ? await listDeckSummariesForUser(user.id, env)
      : await listDecksForUser(user.id, env);
    return jsonResponse({ ok: true, decks }, 200, request);
  });
}

async function handleSaveDeck(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    if (!body) {
      return jsonResponse({ error: 'Invalid body' }, 400, request);
    }

    try {
      const deck = await saveDeckForUser(user.id, body, env);
      return jsonResponse({ ok: true, deck }, 200, request);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400, request);
    }
  });
}

async function handleSelectDeckHero(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    if (!body) {
      return jsonResponse({ error: 'Invalid body' }, 400, request);
    }
    const deckId = Number(body.deckId);
    if (!Number.isInteger(deckId) || deckId <= 0) {
      return jsonResponse({ error: 'deckId is required' }, 400, request);
    }
    const cards = await listCards(env);
    const cardMap = new Map(cards.map((card) => [card.id, card]));
    const deck = await getDeckForUser(user.id, deckId, env, { cardMap });
    if (!deck) {
      return jsonResponse({ error: 'Deck not found' }, 404, request);
    }
    try {
      const progression = await selectDeckProgressionHero(
        env,
        user.id,
        deckId,
        body.heroId,
        listProgressionHeroOptions(cards)
      );
      return jsonResponse({ ok: true, progression }, 200, request);
    } catch (error) {
      return jsonResponse({ error: error.message }, 409, request);
    }
  });
}

export function exactMiniRoyaleDataApiRouteHandler(request, env, url) {
  const path = mapMiniRoyaleApiPath(url.pathname) ?? url.pathname;
  switch (`${request.method} ${path}`) {
    case 'GET /api/cards':
      return () => handleListCards(request, env);
    case 'GET /api/heroes':
      return () => handleListHeroes(request, env);
    case 'GET /api/progression':
      return () => handleListProgression(request, env);
    case 'GET /api/decks':
      return () => handleListDecks(request, env);
    case 'POST /api/decks':
      return () => handleSaveDeck(request, env);
    case 'POST /api/decks/hero':
      return () => handleSelectDeckHero(request, env);
    default:
      return null;
  }
}
