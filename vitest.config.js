import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.js',
      miniflare: {
        compatibilityDate: '2026-03-11',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'signal-room-test-db' },
        kvNamespaces: ['STATIC_ASSETS', 'CHAT_SYNC', 'PUSH_RETRY'],
        durableObjects: { SIGNAL_ROOM: 'SignalRoom' }
      }
    })
  ],
  test: {
    include: ['worker-tests/**/*.test.js']
  }
});
