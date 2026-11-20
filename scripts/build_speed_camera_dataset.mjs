// Offline build step: converts a downloaded official CSV file to versioned JSON.
// Usage: node scripts/build_speed_camera_dataset.mjs source.csv output.json
// This intentionally does not fetch arbitrary URLs or deploy anything.
import { readFile, writeFile } from 'node:fs/promises';
import { parseCsvObjects } from '../src/speed_camera/csv.js';
import { buildNpaSnapshot } from '../src/speed_camera/camera_core.js';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/build_speed_camera_dataset.mjs <source.csv> <output.json>');
  process.exitCode = 2;
} else {
  try {
    const csv = await readFile(inputPath, 'utf8');
    const rows = parseCsvObjects(csv);
    const expected = ['CityName', 'RegionName', 'Address', 'Longitude', 'Latitude', 'direct', 'limit'];
    if (!rows.length) throw new Error('No data rows in CSV');
    if (!expected.every((col) => Object.hasOwn(rows[0], col))) {
      throw new Error('Official source columns changed; refuse to publish until reviewed');
    }
    const snapshot = buildNpaSnapshot(rows, { generatedAt: new Date().toISOString() });
    if (snapshot.recordCount === 0 || snapshot.rejectedCount > rows.length * 0.2) {
      throw new Error('Rejected too many rows; do not overwrite a healthy dataset');
    }
    await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({
      sourceRows: rows.length, valid: snapshot.recordCount,
      rejected: snapshot.rejectedCount, duplicates: snapshot.duplicateCount,
      outputPath,
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
