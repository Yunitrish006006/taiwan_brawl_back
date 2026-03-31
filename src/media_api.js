import { getCardImageResponse } from './royale_repository.js';
import {
  matchCardImagePath,
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

  const userAvatarId = matchUserAvatarPath(url.pathname);
  if (userAvatarId && request.method === 'GET') {
    const response = await getUserAvatarImageResponse(env, userAvatarId);
    return response ?? jsonResponse({ error: 'Not Found' }, 404, request);
  }

  return null;
}
