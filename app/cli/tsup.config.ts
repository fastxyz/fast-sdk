import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  noExternal: [
    "@noble/curves",
    "@noble/ciphers",
    "@noble/hashes",
  ],
  banner: {
    js: "#!/usr/bin/env node",
  },
})
