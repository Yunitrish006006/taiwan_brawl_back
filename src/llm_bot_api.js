import { withAuthenticatedUser } from './request_helpers.js';
import { jsonResponse } from './utils.js';
import {
  buildLlmBotSpec,
  decideLlmBotAction,
  fetchUserLlmBotSettings,
  handleLlmBotMcpPayload
} from './royale_llm_bot.js';

async function handleGetSpec(request) {
  return jsonResponse({ ok: true, spec: buildLlmBotSpec() }, 200, request);
}

async function handleDecide(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    if (!body?.state) {
      return jsonResponse({ error: 'state is required' }, 400, request);
    }

    const settings = await fetchUserLlmBotSettings(env, user.id);
    if (!settings.apiKey) {
      return jsonResponse({ error: 'LLM bot API key is not configured' }, 409, request);
    }

    try {
      const decision = await decideLlmBotAction(body.state, settings);
      return jsonResponse({ ok: true, ...decision }, 200, request);
    } catch (error) {
      return jsonResponse(
        { error: error.message || 'LLM bot decision failed' },
        502,
        request
      );
    }
  });
}

async function handleMcp(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid MCP payload' }, 400, request);
    }

    try {
      const response = await handleLlmBotMcpPayload(
        body,
        () => fetchUserLlmBotSettings(env, user.id)
      );
      return jsonResponse(response, 200, request);
    } catch (error) {
      const id = body?.id ?? null;
      return jsonResponse(
        {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: error.message || 'MCP request failed'
          }
        },
        200,
        request
      );
    }
  });
}

export function exactLlmBotApiRouteHandler(request, env, url) {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/llm-bot/spec':
      return () => handleGetSpec(request);
    case 'POST /api/llm-bot/decide':
      return () => handleDecide(request, env);
    case 'POST /api/llm-bot/mcp':
      return () => handleMcp(request, env);
    default:
      return null;
  }
}
