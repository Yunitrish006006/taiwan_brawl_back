#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = process.cwd();
const defaultArtDir = path.join(rootDir, 'generated', 'card_art');
const artDir = path.resolve(process.argv[2] || defaultArtDir);

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit'
  });
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function detectContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  throw new Error(`Unsupported image extension for ${filename}`);
}

function existingFile(...segments) {
  const candidate = path.join(...segments);
  return fs.existsSync(candidate) ? candidate : null;
}

function collectUploads(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Art directory not found: ${directory}`);
  }

  const cards = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cardDir = path.join(directory, entry.name);
    const character =
      existingFile(cardDir, 'character.png') ||
      existingFile(cardDir, 'character.webp') ||
      existingFile(cardDir, 'character.jpg') ||
      existingFile(cardDir, 'character.jpeg');
    const background =
      existingFile(cardDir, 'bg.jpg') ||
      existingFile(cardDir, 'bg.jpeg') ||
      existingFile(cardDir, 'bg.png') ||
      existingFile(cardDir, 'bg.webp');

    if (!character || !background) {
      throw new Error(`Missing character or background asset in ${cardDir}`);
    }

    cards.push({
      id: entry.name,
      character,
      background
    });
  }

  if (!cards.length) {
    throw new Error(`No card art folders found in ${directory}`);
  }

  return cards.sort((a, b) => a.id.localeCompare(b.id));
}

function assertWithinLimit(filePath) {
  const size = fs.statSync(filePath).size;
  const maxBytes = 1024 * 1024;
  if (size > maxBytes) {
    throw new Error(`${filePath} is ${size} bytes, exceeds ${maxBytes} bytes`);
  }
}

function uploadKey(key, metaKey, filePath, contentType) {
  assertWithinLimit(filePath);
  run('npx', [
    'wrangler',
    'kv',
    'key',
    'put',
    key,
    '--path',
    filePath,
    '--binding',
    'STATIC_ASSETS',
    '--remote'
  ]);
  run('npx', [
    'wrangler',
    'kv',
    'key',
    'put',
    metaKey,
    JSON.stringify({
      contentType,
      uploadedAt: new Date().toISOString()
    }),
    '--binding',
    'STATIC_ASSETS',
    '--remote'
  ]);
}

function updateVersions(cards) {
  const timestampBase = Date.now();
  const statements = cards.flatMap((card, index) => {
    const charVersion = timestampBase + index * 2;
    const bgVersion = charVersion + 1;
    return [
      `UPDATE cards SET char_image_version = ${charVersion} WHERE id = ${sqlString(card.id)};`,
      `UPDATE cards SET bg_image_version = ${bgVersion} WHERE id = ${sqlString(card.id)};`
    ];
  });

  run('npx', [
    'wrangler',
    'd1',
    'execute',
    'taiwan_brawl_db',
    '--remote',
    '--command',
    statements.join(' ')
  ]);
}

const cards = collectUploads(artDir);
for (const card of cards) {
  uploadKey(
    `card-char-image:${card.id}`,
    `card-char-image-meta:${card.id}`,
    card.character,
    detectContentType(card.character)
  );
  uploadKey(
    `card-bg-image:${card.id}`,
    `card-bg-image-meta:${card.id}`,
    card.background,
    detectContentType(card.background)
  );
}
updateVersions(cards);
console.log(`Uploaded ${cards.length} card art bundles from ${artDir}`);
