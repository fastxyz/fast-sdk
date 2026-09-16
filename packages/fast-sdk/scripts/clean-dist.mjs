import { cleanDist } from './clean-dist-lib.mjs';

// Deliberately no trailing slash: lstat must observe dist itself, not a
// symlink target.
await cleanDist(new URL('../dist', import.meta.url));
