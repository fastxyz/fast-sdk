import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const refName = process.env.GITHUB_REF_NAME;

if (!refName) {
  throw new Error('GITHUB_REF_NAME is required to verify the release tag');
}

const tagVersion = refName.startsWith('v') ? refName.slice(1) : refName;

if (tagVersion !== manifest.version) {
  throw new Error(`Tag ${refName} does not match package.json version ${manifest.version}`);
}

console.log(`Verified tag ${refName} matches package version ${manifest.version}`);
