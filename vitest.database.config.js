import { readFileSync } from 'node:fs';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins:[cloudflareTest({main:'./src/index.js',miniflare:{
    compatibilityDate:'2026-03-11',compatibilityFlags:['nodejs_compat'],
    d1Databases:{DB:'cd01-main-local',SOCIAL_DB:'cd01-social-local',GAME_DB:'cd01-games-local'},
    durableObjects:{SIGNAL_ROOM:'SignalRoom'},
    bindings:{DATABASE_MODE:'split',SOCIAL_MIGRATIONS:await readD1Migrations('migrations/social'),GAME_MIGRATIONS:await readD1Migrations('migrations/games'),
      MAIN_LIFECYCLE_SQL:readFileSync('migrations/0031_account_lifecycle.sql','utf8'),
      MAIN_MIGRATIONS:await readD1Migrations('migrations'),
      COUPLE_FIXTURES:readFileSync('database-tests/fixtures/couple-days-v1.json','utf8')}
  }})],
  test:{include:['database-tests/**/*.test.js']}
});
