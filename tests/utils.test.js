/**
 * Unit tests for src/core/utils.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  generateRequestId,
  getRequestId,
  parseSessionId,
  parseSessionIdFromCookie,
  buildUploadedAvatarUrl,
  resolveAvatarUrlForSource,
} from '../src/core/utils.js';

// ── generateRequestId ──────────────────────────────────────────────────────

describe('generateRequestId', () => {
  it('returns a non-empty string', () => {
    const id = generateRequestId();
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0);
  });

  it('returns unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    assert.strictEqual(ids.size, 100);
  });
});

// ── getRequestId ──────────────────────────────────────────────────────────

describe('getRequestId', () => {
  it('returns header value when present', () => {
    const req = new Request('https://example.com', {
      headers: { 'X-Request-ID': 'abc123' },
    });
    assert.strictEqual(getRequestId(req), 'abc123');
  });

  it('generates new ID when header absent', () => {
    const req = new Request('https://example.com');
    const id = getRequestId(req);
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0);
  });
});

// ── parseSessionIdFromCookie ──────────────────────────────────────────────

describe('parseSessionIdFromCookie', () => {
  it('parses valid session_id cookie', () => {
    const req = new Request('https://example.com', {
      headers: { Cookie: 'other=value; session_id=abc-123-def; foo=bar' },
    });
    assert.strictEqual(parseSessionIdFromCookie(req), 'abc-123-def');
  });

  it('returns null when no session_id', () => {
    const req = new Request('https://example.com', {
      headers: { Cookie: 'foo=bar' },
    });
    assert.strictEqual(parseSessionIdFromCookie(req), null);
  });

  it('returns null for empty cookie', () => {
    const req = new Request('https://example.com');
    assert.strictEqual(parseSessionIdFromCookie(req), null);
  });

  it('handles session_id at start', () => {
    const req = new Request('https://example.com', {
      headers: { Cookie: 'session_id=xyz-789' },
    });
    assert.strictEqual(parseSessionIdFromCookie(req), 'xyz-789');
  });
});

// ── parseSessionId ────────────────────────────────────────────────────────

describe('parseSessionId (Bearer token)', () => {
  it('parses Bearer authorization header', () => {
    const req = new Request('https://example.com', {
      headers: { Authorization: 'Bearer my-session-token' },
    });
    assert.strictEqual(parseSessionId(req), 'my-session-token');
  });

  it('prefers Bearer over cookie', () => {
    const req = new Request('https://example.com', {
      headers: {
        Authorization: 'Bearer token-from-header',
        Cookie: 'session_id=cookie-token',
      },
    });
    assert.strictEqual(parseSessionId(req), 'token-from-header');
  });

  it('falls back to cookie when no Authorization', () => {
    const req = new Request('https://example.com', {
      headers: { Cookie: 'session_id=cookie-token' },
    });
    assert.strictEqual(parseSessionId(req), 'cookie-token');
  });

  it('handles missing Authorization and no cookie', () => {
    const req = new Request('https://example.com');
    assert.strictEqual(parseSessionId(req), null);
  });
});

// ── buildUploadedAvatarUrl ────────────────────────────────────────────────

describe('buildUploadedAvatarUrl', () => {
  it('returns null for version 0', () => {
    assert.strictEqual(buildUploadedAvatarUrl('user123', 0), null);
  });

  it('returns null for undefined version', () => {
    assert.strictEqual(buildUploadedAvatarUrl('user123', undefined), null);
  });

  it('returns null for negative version', () => {
    assert.strictEqual(buildUploadedAvatarUrl('user123', -1), null);
  });

  it('returns correct URL for valid version', () => {
    const url = buildUploadedAvatarUrl('user123', 3);
    assert.strictEqual(url, '/user-avatars/user123?v=3');
  });

  it('URL-encodes special characters in userId', () => {
    const url = buildUploadedAvatarUrl('user with spaces', 1);
    assert.strictEqual(url, '/user-avatars/user%20with%20spaces?v=1');
  });
});

// ── resolveAvatarUrlForSource ─────────────────────────────────────────────

describe('resolveAvatarUrlForSource', () => {
  const googleUrl = 'https://google.com/avatar.png';
  const customUrl = 'https://example.com/custom.png';
  const uploadUrl = '/uploads/avatar.png';
  const fallbackUrl = '/default-avatar.png';

  it('prefers custom source', () => {
    const result = resolveAvatarUrlForSource({
      avatarSource: 'custom',
      googleAvatarUrl: googleUrl,
      customAvatarUrl: customUrl,
      uploadedAvatarUrl: uploadUrl,
      fallbackAvatarUrl: fallbackUrl,
    });
    assert.strictEqual(result, customUrl);
  });

  it('prefers upload source over google', () => {
    const result = resolveAvatarUrlForSource({
      avatarSource: 'upload',
      googleAvatarUrl: googleUrl,
      customAvatarUrl: customUrl,
      uploadedAvatarUrl: uploadUrl,
      fallbackAvatarUrl: fallbackUrl,
    });
    assert.strictEqual(result, uploadUrl);
  });

  it('uses google as default source', () => {
    const result = resolveAvatarUrlForSource({
      avatarSource: 'google',
      googleAvatarUrl: googleUrl,
      customAvatarUrl: customUrl,
      uploadedAvatarUrl: uploadUrl,
      fallbackAvatarUrl: fallbackUrl,
    });
    assert.strictEqual(result, googleUrl);
  });

  it('falls back through sources when null', () => {
    const result = resolveAvatarUrlForSource({
      avatarSource: 'custom',
      googleAvatarUrl: null,
      customAvatarUrl: null,
      uploadedAvatarUrl: uploadUrl,
      fallbackAvatarUrl: fallbackUrl,
    });
    assert.strictEqual(result, uploadUrl);
  });

  it('returns null when all sources are null', () => {
    const result = resolveAvatarUrlForSource({
      avatarSource: 'google',
      googleAvatarUrl: null,
      customAvatarUrl: null,
      uploadedAvatarUrl: null,
      fallbackAvatarUrl: null,
    });
    assert.strictEqual(result, null);
  });

  it('handles unknown avatarSource as google', () => {
    const result = resolveAvatarUrlForSource({
      avatarSource: 'unknown',
      googleAvatarUrl: googleUrl,
      customAvatarUrl: customUrl,
      uploadedAvatarUrl: uploadUrl,
      fallbackAvatarUrl: fallbackUrl,
    });
    assert.strictEqual(result, googleUrl);
  });
});
