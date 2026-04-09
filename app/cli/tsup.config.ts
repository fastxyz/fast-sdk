import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  outDir: 'dist',
  platform: 'node',
  // Bundle all internal workspace packages so the CLI can be published
  // standalone without requiring @fastxyz/* packages on npm.
  // @noble/* are pure-JS and also bundled. Native addons (better-sqlite3)
  // must remain external and are declared as real npm dependencies.
  noExternal: [
    '@fastxyz/allset-sdk',
    '@fastxyz/schema',
    '@fastxyz/sdk',
    '@fastxyz/x402-client',
    '@noble/curves',
    '@noble/ciphers',
    '@noble/hashes',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
