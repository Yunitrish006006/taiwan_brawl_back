import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

import { handleApiRequest } from './api_router.js';
import { handleMediaRequest } from './media_api.js';
import { RoyaleRoom } from './royale_room.js';
import { corsHeaders, jsonResponse } from './utils.js';

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
export { ChatRoom } from './chat_room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const mediaResponse = await handleMediaRequest(request, env, url);
    if (mediaResponse) {
      return mediaResponse;
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApiRequest(request, env, url);
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
