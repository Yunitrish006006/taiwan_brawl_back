// Rate limiting middleware using KV store

const RATE_LIMIT_KV_PREFIX = 'rl:';
const DEFAULT_WINDOW_MS = 60_000; // 1 minute window

// Rate limit rules: [endpoint pattern, window ms, max requests]
const RATE_RULES = [
  // Strict limits for sensitive endpoints
  [/^\/api\/login$/, 60_000, 5],      // 5 requests/min for login
  [/^\/api\/chat\/dm\/\d+\/send$/, 60_000, 20], // 20 messages/min
  [/^\/api\/register$/, 60_000, 3], // 3 registrations/min
  // General API limits
  [/^\/api\//, 60_000, 100],         // 100 requests/min for general API
];

function normalizeIp(request) {
  // Check for forwarded header (Cloudflare)
  const cfConnectingIp = request.headers.get('CF-Connecting-IP');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  // Fall back to x-forwarded-for
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  // Fall back to x-real-ip
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return 'unknown';
}

function findMatchingRule(pathname) {
  for (const [pattern, windowMs, maxRequests] of RATE_RULES) {
    if (pattern.test(pathname)) {
      return { windowMs, maxRequests };
    }
  }
  return null;
}

function rateKey(ip, windowStart) {
  return `${RATE_LIMIT_KV_PREFIX}${ip}:${windowStart}`;
}

function getCurrentWindowStart(windowMs) {
  return Math.floor(Date.now() / windowMs) * windowMs;
}

export async function checkRateLimit(request, env, url) {
  const rule = findMatchingRule(url.pathname);
  if (!rule) {
    return { allowed: true }; // No rate limit for this endpoint
  }

  const { windowMs, maxRequests } = rule;
  const ip = normalizeIp(request);
  const currentWindow = getCurrentWindowStart(windowMs);
  const key = rateKey(ip, currentWindow);

  try {
    const current = await env.CHAT_SYNC?.get(key);
    const count = Number(current || 0);

    if (count >= maxRequests) {
      const retryAfterMs = windowMs - (Date.now() - currentWindow);
      return {
        allowed: false,
        status: 429,
        retryAfter: Math.ceil(retryAfterMs / 1000),
        limit: maxRequests,
        remaining: 0,
      };
    }

    // Increment counter
    const newCount = count + 1;
    const ttlSeconds = Math.ceil(windowMs / 1000) + 10; // Buffer for TTL
    await env.CHAT_SYNC?.put(key, String(newCount), { expirationTtl: ttlSeconds });

    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - newCount,
    };
  } catch (_) {
    // KV error - allow request (fail open)
    return { allowed: true };
  }
}

export function rateLimitHeaders(result) {
  const headers = {};
  if (result.limit !== undefined) {
    headers['X-RateLimit-Limit'] = String(result.limit);
    headers['X-RateLimit-Remaining'] = String(result.remaining ?? 0);
  }
  if (result.retryAfter) {
    headers['Retry-After'] = String(result.retryAfter);
  }
  return headers;
}
