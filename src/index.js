import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

import { handleApiRequest } from './api/api_router.js';
import { handleMediaRequest } from './api/media_api.js';
import { handlePrivacyPolicy } from './core/privacy_policy.js';
import { RoyaleRoom } from './royale/royale_room.js';
import { corsHeaders, jsonResponse } from './core/utils.js';

function buildAssetRequest(request, pathname) {
  if (pathname !== '/') {
    return request;
  }

  const indexUrl = new URL(request.url);
  indexUrl.pathname = '/index.html';
  return new Request(indexUrl, request);
}

async function fetchStaticAsset(env, request) {
  return getAssetFromKV(
    { request },
    {
      ASSET_NAMESPACE: env.STATIC_ASSETS
    }
  );
}

async function handleStaticAssetRequest(request, env, url) {
  try {
    return await fetchStaticAsset(env, buildAssetRequest(request, url.pathname));
  } catch (_) {
    try {
      return await fetchStaticAsset(env, buildAssetRequest(request, '/'));
    } catch (error) {
      return jsonResponse({ error: 'Not Found', detail: error.message }, 404, request);
    }
  }
}

export { RoyaleRoom };
export { ChatRoom } from './rooms/chat_room.js';
export { SignalRoom } from './rooms/signal_room.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === '/privacy') {
      return handlePrivacyPolicy(request);
    }

    const mediaResponse = await handleMediaRequest(request, env, url);
    if (mediaResponse) {
      return mediaResponse;
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApiRequest(request, env, url, ctx);
      } catch (error) {
        return jsonResponse(
          { error: 'Internal server error', detail: error.message },
          500,
          request
        );
      }
    }

    return handleStaticAssetRequest(request, env, url);
  }
};
