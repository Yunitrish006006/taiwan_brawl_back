import { getCardImageResponse, getCardCharacterImageResponse, getCardBgImageResponse } from './royale_repository.js';
import {
  matchCardImagePath,
  matchCardCharacterImagePath,
  matchCardBgImagePath,
  matchUserAvatarPath
} from './route_patterns.js';
import { getUserAvatarImageResponse } from './users.js';
import { jsonResponse } from './utils.js';

export async function handleMediaRequest(request, env, url) {
  const cardImageId = matchCardImagePath(url.pathname);
  if (cardImageId && request.method === 'GET') {
    const response = await getCardImageResponse(env, cardImageId);
    return response ?? jsonResponse({ error: 'Not Found' }, 404, request);
  }

  const cardCharImageId = matchCardCharacterImagePath(url.pathname);
  if (cardCharImageId && request.method === 'GET') {
    const response = await getCardCharacterImageResponse(env, cardCharImageId);
    return response ?? jsonResponse({ error: 'Not Found' }, 404, request);
  }

  const cardBgImageId = matchCardBgImagePath(url.pathname);
  if (cardBgImageId && request.method === 'GET') {
    const response = await getCardBgImageResponse(env, cardBgImageId);
    return response ?? jsonResponse({ error: 'Not Found' }, 404, request);
  }

  const userAvatarId = matchUserAvatarPath(url.pathname);
  if (userAvatarId && request.method === 'GET') {
    const response = await getUserAvatarImageResponse(env, userAvatarId);
    return response ?? jsonResponse({ error: 'Not Found' }, 404, request);
  }

  return null;
}
