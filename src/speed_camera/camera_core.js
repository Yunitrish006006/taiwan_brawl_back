// Pure, platform-independent helpers for Taiwan Brawl speed-camera data.
// Official source: NPA open data dataset 7320.
// A direction label from source data is preserved, NOT interpreted as a
// numeric travel heading. Road matching must occur before production alerts.

export const NPA_DATASET_URL = 'https://data.gov.tw/dataset/7320';

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseCoordinate(value, minimum, maximum) {
  const raw = clean(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum
    ? numeric : null;
}

export function parseSpeedLimit(value) {
  const raw = clean(value);
  const match = raw.match(/^(?:速限\s*)?(\d{2,3})(?:\s*(?:公里(?:\/小時)?|km\/h|kph))?$/i);
  if (!match) return null;
  const limit = Number(match[1]);
  return limit >= 10 && limit <= 130 ? limit : null;
}

export function normalizeNpaRow(row) {
  if (!row || typeof row !== 'object') return null;
  // Broad Taiwan-and-islands bounds; these are not a road-map validation.
  const latitude = parseCoordinate(row.Latitude ?? row.latitude, 18, 27);
  const longitude = parseCoordinate(row.Longitude ?? row.longitude, 115, 124);
  const city = clean(row.CityName ?? row.cityname);
  const region = clean(row.RegionName ?? row.regionname);
  const address = clean(row.Address ?? row.address);
  if (latitude === null || longitude === null || !address) return null;

  const directionRaw = clean(row.direct ?? row.Direction);
  const idPieces = [
    city, region, address,
    latitude.toFixed(6), longitude.toFixed(6), directionRaw,
  ];
  return {
    id: 'npa7320:' + idPieces.map(encodeURIComponent).join(':'),
    type: 'speed_enforcement_point',
    latitude,
    longitude,
    city,
    region,
    address,
    directionRaw, // ambiguous free text: never assume this is a road bearing
    speedLimitKmh: parseSpeedLimit(row.limit ?? row.Limit),
    agency: clean(row.DeptNm ?? row.deptnm),
    precinct: clean(row.BranchNm ?? row.branchnm),
    source: 'NPA-7320',
  };
}

export function buildNpaSnapshot(rows, { generatedAt = null } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const byId = new Map();
  let rejected = 0;
  let duplicates = 0;
  for (const row of rows) {
    const camera = normalizeNpaRow(row);
    if (!camera) {
      rejected += 1;
      continue;
    }
    if (byId.has(camera.id)) duplicates += 1;
    byId.set(camera.id, camera);
  }
  const points = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    source: 'NPA-7320',
    sourceUrl: NPA_DATASET_URL,
    generatedAt,
    recordCount: points.length,
    rejectedCount: rejected,
    duplicateCount: duplicates,
    points,
  };
}

function radians(degrees) { return degrees * Math.PI / 180; }

export function distanceMeters(a, b) {
  const aLat = radians(a.latitude);
  const bLat = radians(b.latitude);
  const dLat = bLat - aLat;
  const dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function bearingDegrees(a, b) {
  const y = Math.sin(radians(b.longitude - a.longitude)) * Math.cos(radians(b.latitude));
  const x = Math.cos(radians(a.latitude)) * Math.sin(radians(b.latitude)) -
    Math.sin(radians(a.latitude)) * Math.cos(radians(b.latitude)) *
    Math.cos(radians(b.longitude - a.longitude));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function differenceDegrees(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// Candidate search only. It cannot distinguish parallel/elevated roads,
// verify source "direct", or guarantee an enforcement point faces the driver.
export function findAheadCandidates(points, location, {
  radiusMeters = 600,
  maxBearingDifferenceDegrees = 60,
  maxLocationAccuracyMeters = 100,
} = {}) {
  if (!Array.isArray(points) || !location ||
      !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      !Number.isFinite(location.accuracyMeters) ||
      location.accuracyMeters > maxLocationAccuracyMeters ||
      location.accuracyMeters < 0) return [];
  const heading = location.headingDegrees;
  if (!Number.isFinite(heading)) return [];
  const normalizedHeading = ((heading % 360) + 360) % 360;
  const results = [];
  for (const point of points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    const meters = distanceMeters(location, point);
    if (meters > radiusMeters || meters < 5) continue;
    const bearing = bearingDegrees(location, point);
    if (differenceDegrees(normalizedHeading, bearing) > maxBearingDifferenceDegrees) continue;
    results.push({ point, distanceMeters: Math.round(meters), matchStatus: 'candidate_only' });
  }
  return results.sort((a, b) => a.distanceMeters - b.distanceMeters);
}
