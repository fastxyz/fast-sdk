import { defineConfig } from 'vitest/config';
import liveConfig from '../../vitest.live.config.js';

// Exercise the real live runner policy, replacing only the funded test file.
export default defineConfig({
  ...liveConfig,
  test: { ...liveConfig.test, include: ['tests/fixtures/live-stop.scenario.ts'] },
});
