import { NPA_DATASET_URL } from './camera_core.js';

export const CATALOG_KEY = 'npa7320:catalog:v1';
export const LEGACY_KEY = 'npa7320:snapshot';
export const MAX_BYTES = 15 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

export function snapshotVersion(snapshot) {
  return snapshot.contentSha256 ?? snapshot.generatedAt;
}

export function validateCameraSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 1 || snapshot.source !== 'NPA-7320' ||
      snapshot.sourceUrl !== NPA_DATASET_URL ||
      typeof snapshot.generatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
      (snapshot.contentSha256 !== undefined &&
        (typeof snapshot.contentSha256 !== 'string' || !SHA256.test(snapshot.contentSha256))) ||
      !Array.isArray(snapshot.points) || snapshot.recordCount !== snapshot.points.length ||
      snapshot.points.length < 1 || snapshot.points.length > 30000) return false;

  const ids = new Set();
  return snapshot.points.every(point => {
    if (!point || typeof point.id !== 'string' || !point.id.startsWith('npa7320:') ||
        ids.has(point.id) || !Number.isFinite(point.latitude) || point.latitude < 18 || point.latitude > 27 ||
        !Number.isFinite(point.longitude) || point.longitude < 115 || point.longitude > 124 ||
        typeof point.address !== 'string' || !point.address.trim() ||
        typeof point.directionRaw !== 'string' ||
        (point.speedLimitKmh !== null && (!Number.isInteger(point.speedLimitKmh) ||
          point.speedLimitKmh < 10 || point.speedLimitKmh > 130))) return false;
    ids.add(point.id);
    return true;
  });
}

export async function hashPoints(points) {
  const bytes = new TextEncoder().encode(JSON.stringify(points));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function parse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function verified(snapshot, version, requireHash) {
  return validateCameraSnapshot(snapshot) &&
    (version === null || snapshotVersion(snapshot) === version) &&
    (snapshot.contentSha256 ? await hashPoints(snapshot.points) === snapshot.contentSha256 : !requireHash);
}

export async function readPublication(kv, version = null) {
  const catalog = parse(await kv.get(CATALOG_KEY));
  if (catalog?.format === 1) {
    if (await verified(catalog.current, version, true)) return { snapshot: catalog.current, current: true };
    if (await verified(catalog.previous, version, true)) return { snapshot: catalog.previous, current: false };
  }
  const legacy = parse(await kv.get(LEGACY_KEY));
  return { snapshot: await verified(legacy, version, false) ? legacy : null, current: false };
}
