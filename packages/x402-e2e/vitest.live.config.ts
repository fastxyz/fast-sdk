import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/live-matrix.test.ts'], fileParallelism: false, testTimeout: 120_000, retry: 0 } });
