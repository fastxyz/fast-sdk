import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { exclude: ['**/node_modules/**', '**/live-matrix.test.ts', '**/fast-payment.test.ts'] } });
