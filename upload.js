import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveFrontendDir() {
  const override = process.env.FRONTEND_DIR;
  const candidates = [
    override,
    path.join(__dirname, '..', 'taiwan_brawl_front'),
    path.join(__dirname, '..', 'front')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'pubspec.yaml'))) {
      return candidate;
    }
  }

  console.error('Unable to locate Flutter frontend directory.');
  console.error('Set FRONTEND_DIR or place the app at ../taiwan_brawl_front or ../front.');
  process.exit(1);
}

const frontendDir = resolveFrontendDir();
const buildDir = path.join(frontendDir, 'build', 'web');
const outputPath = path.join(__dirname, 'assets.json');

function getFiles(dir, prefix = '') {
  const files = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getFiles(fullPath, `${prefix}${item}/`));
    } else {
      const key = `${prefix}${item}`;
      const value = fs.readFileSync(fullPath, 'base64');
      files.push({ key, value, base64: true });
    }
  }

  return files;
}

if (!fs.existsSync(buildDir)) {
  console.error(`Build output not found: ${buildDir}`);
  console.error('Please run flutter build web first.');
  process.exit(1);
}

const files = getFiles(buildDir);
fs.writeFileSync(outputPath, JSON.stringify(files, null, 2));
console.log(`Generated assets.json with ${files.length} files from ${frontendDir}`);
