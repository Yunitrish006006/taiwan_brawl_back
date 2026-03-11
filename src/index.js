import {
  handleGoogleLogin,
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister
} from './auth.js';
import {
  handleGetCurrentUser,
  handleUpdateCurrentUser,
  handleUpdateThemeMode,
  handleUpdateUiPreferences
} from './users.js';
import { corsHeaders, jsonResponse } from './utils.js';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

async function handleHealth(request) {
  return jsonResponse({ ok: true, message: 'taiwan brawl api alive' }, 200, request);
}

const routes = {
  GET: {
    '/api/health': handleHealth,
    '/api/me': handleMe,
    '/api/users/me': handleGetCurrentUser
  },
  POST: {
    '/api/login': handleLogin,
    '/api/logout': handleLogout,
    '/api/register': handleRegister,
    '/api/google-login': handleGoogleLogin
  },
  PUT: {
    '/api/users/me': handleUpdateCurrentUser,
    '/api/users/theme-mode': handleUpdateThemeMode,
    '/api/users/ui-preferences': handleUpdateUiPreferences
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const methodRoutes = routes[request.method];
    const handler = methodRoutes && methodRoutes[url.pathname];
    if (handler) {
      try {
        return await handler(request, env);
      } catch (error) {
        return jsonResponse({ error: 'Internal server error', detail: error.message }, 500, request);
      }
    }

    if (!url.pathname.startsWith('/api/')) {
      try {
        let assetRequest = request;
        if (url.pathname === '/') {
          const indexUrl = new URL(request.url);
          indexUrl.pathname = '/index.html';
          assetRequest = new Request(indexUrl, request);
        }

        return await getAssetFromKV(
          { request: assetRequest },
          {
            ASSET_NAMESPACE: env.STATIC_ASSETS
          }
        );
      } catch (_) {
        // SPA fallback for client-side routes.
        try {
          const indexUrl = new URL(request.url);
          indexUrl.pathname = '/index.html';
          const indexRequest = new Request(indexUrl, request);
          return await getAssetFromKV(
            { request: indexRequest },
            {
              ASSET_NAMESPACE: env.STATIC_ASSETS
            }
          );
        } catch (error) {
          return jsonResponse({ error: 'Not Found', detail: error.message }, 404, request);
        }
      }
    }

    return jsonResponse({ error: 'Not Found' }, 404, request);
  }
};
