import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

export const PACKAGE_NAME = '@fastxyz/fastid-sdk';
export const DISCOVERY_URLS = Object.freeze({
  guide: 'https://id.fast.xyz/AGENTS.md',
  llms: 'https://id.fast.xyz/llms.txt',
  apiCatalog: 'https://id.fast.xyz/.well-known/api-catalog',
});

const SDK_GUIDE_LINK = `${DISCOVERY_URLS.guide}#agent-sdk`;
const LIVE_FLOWS = new Set(['name', 'website', 'github', 'orcid', 'x']);
const TESTNET_CONFIRMATION = 'TESTNET ONLY';

function hasHref(value, target) {
  if (Array.isArray(value)) return value.some((item) => hasHref(item, target));
  if (value === null || typeof value !== 'object') return false;
  if (value.href === target) return true;
  return Object.values(value).some((item) => hasHref(item, target));
}

export function inspectDiscoveryDocuments({ guide, llms, apiCatalog }) {
  const guideText = typeof guide === 'string' ? guide : '';
  const llmsText = typeof llms === 'string' ? llms : '';

  const npmInstall = /\bnpm\s+install\s+@fastxyz\/fastid-sdk(?:@latest)?(?=\s|$)/m.exec(guideText);
  const tarballFallback = /\btarball\b|fastxyz-fastid-sdk-[^\s]*\.tgz|--pack-destination/i.exec(guideText);
  const directNpmInstall = npmInstall !== null && (tarballFallback === null || npmInstall.index < tarballFallback.index);
  const stalePublicationClaim = /not\s+(?:yet\s+)?published\s+to\s+npm|before\s+(?:the\s+)?first\s+npm\s+publication/i.test(guideText);

  return [
    {
      name: 'AGENTS.md SDK section',
      ok: /^## Agent SDK\s*$/m.test(guideText),
      details: 'The served guide must expose an Agent SDK section.',
    },
    {
      name: 'npm install guidance',
      ok: directNpmInstall && !stalePublicationClaim,
      details:
        directNpmInstall && !stalePublicationClaim
          ? 'The published package is the primary install path.'
          : 'The guide must lead with npm install @fastxyz/fastid-sdk and must not claim the package is unpublished.',
    },
    {
      name: 'llms.txt SDK link',
      ok: llmsText.includes(`](${SDK_GUIDE_LINK})`),
      details: `The semantics map must link to ${SDK_GUIDE_LINK}.`,
    },
    {
      name: 'API catalog SDK link',
      ok: hasHref(apiCatalog, SDK_GUIDE_LINK),
      details: `The API catalog must expose ${SDK_GUIDE_LINK}.`,
    },
  ];
}

export function parseAgentSmokeArgs(args, env) {
  if (args.length === 0) return { mode: 'public-check' };
  if (args.length === 1 && args[0] === '--help') return { mode: 'help' };
  if (args.length !== 1 || args[0] !== '--testnet-live') {
    throw new Error('Unknown option. Use no option for read-only checks or --testnet-live for explicit testnet operations.');
  }
  if (env.ID_SDK_LIVE !== '1') {
    throw new Error('Live testnet mode requires ID_SDK_LIVE=1.');
  }
  if (typeof env.ID_SDK_KEY !== 'string' || !/^[0-9a-f]{64}$/i.test(env.ID_SDK_KEY)) {
    throw new Error('ID_SDK_KEY must be a throwaway testnet wallet key in bare 64-hex format.');
  }
  if (env.ID_SDK_ORIGIN || env.ID_SDK_PROXY) {
    throw new Error('Live testnet mode refuses ID_SDK_ORIGIN and ID_SDK_PROXY endpoint overrides.');
  }
  return { mode: 'testnet-live', key: env.ID_SDK_KEY };
}

export function parseLiveFlowSelection(value) {
  const flows = value
    .split(',')
    .map((flow) => flow.trim().toLowerCase())
    .filter(Boolean);
  const unknown = flows.filter((flow) => !LIVE_FLOWS.has(flow));
  if (unknown.length > 0) {
    throw new Error(`Unknown live flow(s): ${[...new Set(unknown)].join(', ')}. Choose name, website, github, orcid, x.`);
  }
  return [...new Set(flows)];
}

export async function createTestnetClient(sdk, key) {
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('A bare 64-hex throwaway wallet key is required.');
  }
  const signer = await sdk.KeySigner.fromPrivateKey(key);
  return {
    client: new sdk.IdClient({ network: 'fast:testnet', signer }),
    address: signer.address,
  };
}

function npmEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'ID_SDK_KEY' || key === 'ID_SDK_LIVE' || key === 'NODE_AUTH_TOKEN' || key === 'NPM_TOKEN' || /_AUTHTOKEN$/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

async function latestPackageManifest(fetchImpl) {
  const response = await fetchImpl('https://registry.npmjs.org/@fastxyz%2ffastid-sdk/latest', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}.`);
  const manifest = await response.json();
  if (
    manifest?.name !== PACKAGE_NAME ||
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version) ||
    typeof manifest.dist?.tarball !== 'string' ||
    !manifest.dist.tarball.startsWith('https://registry.npmjs.org/')
  ) {
    throw new Error('npm latest metadata is missing the expected public package identity, version, or tarball.');
  }
  return manifest;
}

async function installPublishedPackage(scratch, version) {
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({
      name: 'fastid-agent-smoke-consumer',
      private: true,
      type: 'module',
    }),
  );
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', `${PACKAGE_NAME}@${version}`], {
    cwd: scratch,
    env: npmEnvironment(),
    stdio: 'inherit',
  });

  const entry = pathToFileURL(resolve(scratch, 'node_modules/@fastxyz/fastid-sdk/dist/index.js'));
  const sdk = await import(entry.href);
  if (typeof sdk.IdClient !== 'function' || typeof sdk.KeySigner?.fromPrivateKey !== 'function') {
    throw new Error('The published package does not expose IdClient and KeySigner from its root entry point.');
  }
  const signer = await sdk.KeySigner.fromPrivateKey('01'.repeat(32));
  const client = new sdk.IdClient({ network: 'fast:testnet', signer });
  if (client.share.profileUrl('agent.smoke') !== 'https://testnet.id.fast.xyz/agent.smoke') {
    throw new Error('The installed package does not construct the expected testnet client URL.');
  }
  return sdk;
}

async function fetchResponse(fetchImpl, url, parse) {
  const response = await fetchImpl(url, {
    headers: { accept: parse === 'json' ? 'application/json' : 'text/plain, text/markdown' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return parse === 'json' ? response.json() : response.text();
}

async function getDiscoveryDocuments(fetchImpl) {
  const [guide, llms, apiCatalog] = await Promise.all([
    fetchResponse(fetchImpl, DISCOVERY_URLS.guide, 'text'),
    fetchResponse(fetchImpl, DISCOVERY_URLS.llms, 'text'),
    fetchResponse(fetchImpl, DISCOVERY_URLS.apiCatalog, 'json'),
  ]);
  return { guide, llms, apiCatalog };
}

function printChecks(checks, log) {
  for (const check of checks) {
    log(`${check.ok ? 'PASS' : 'DRIFT'} ${check.name}: ${check.details}`);
  }
}

export function formatOperationFailure(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error.';
  const recovery = error?.recovery;
  const txIdValue = error?.txIdHex ?? error?.submittedTxId ?? recovery?.txIdHex;
  const nonceValue = error?.nonce ?? recovery?.nonce;
  const txId = typeof txIdValue === 'string' ? ` txIdHex=${txIdValue}` : '';
  const nonce = nonceValue !== undefined ? ` nonce=${String(nonceValue)}` : '';
  const lines = [`STOP: ${message}${txId}${nonce}`];
  if (txId || error?.mayHavePaid === true || recovery) {
    lines.push('Do not retry this live flow. Reconcile the reported transaction with the testnet before any further payment.');
  }
  return lines;
}

function reportFailure(error, log) {
  for (const line of formatOperationFailure(error)) log(line);
}

async function runNameFlow(client, signerAddress, log) {
  const suffix = Date.now().toString(36).slice(-12);
  const name = `a${suffix}.smoke`;
  const availability = await client.availability(name);
  if (!availability.available) throw new Error(`Generated smoke name ${name} is not available; no claim was submitted.`);
  const claim = await client.claimName(name);
  log(`Name claim settled as ${claim.txIdHex}; continuing without retrying that payment.`);
  const resolved = await client.resolve(name);
  if (resolved.address !== signerAddress) {
    throw new Error(`Resolved owner did not match the testnet signer for ${name}.`);
  }
  await client.updateProfile({ bio: `Agent SDK testnet smoke ${suffix}` });
  const revoked = await client.revoke('name', name);
  log(`PASS name lifecycle (${name}) was claimed, read, updated, and revoked on fast:testnet (revoke ${revoked.txIdHex}).`);
}

async function runWebsiteFlow(client, ask, log) {
  const host = (await ask('Website hostname you control for this throwaway testnet wallet: ')).trim();
  if (!host) return;
  const proof = client.claimWebsite(host);
  log(`${proof.instructions}\nProof URL: ${proof.proofUrl}\nProof content:\n${proof.proofText}`);
  const ready = await ask('After publishing the proof file, type ready to verify and settle on testnet: ');
  if (ready.trim().toLowerCase() !== 'ready') return;
  const settled = await proof.verifyAndSettle({ timeoutMs: 300_000, intervalMs: 5_000 });
  log(`PASS website proof for ${proof.host} settled on fast:testnet (${settled.txIdHex}).`);
}

async function runOAuthFlow(client, provider, ask, log) {
  const identity = (await ask(`Known canonical ${provider} identity to link: `)).trim();
  if (!identity) return;
  const instructions = client.oauthClaimInstructions(provider);
  log(`${instructions.instructions}\nOpen: ${instructions.url}`);
  const ready = await ask(`After completing ${provider} authentication in the browser, type ready: `);
  if (ready.trim().toLowerCase() !== 'ready') return;
  await client.waitForOAuthProof(provider, identity, { timeoutMs: 300_000, intervalMs: 5_000 });
  const settled = await client.settleOAuthClaim(provider, identity);
  log(`PASS ${provider} proof settled on fast:testnet (${settled.txIdHex}).`);
}

async function runXFlow(client, ask, log) {
  const handle = (await ask('X handle for the throwaway testnet wallet: ')).trim();
  if (!handle) return;
  const started = await client.startXClaim(handle);
  if (started.status === 'already-settled') {
    log(`X claim @${handle} is already settled; no new transaction was submitted.`);
    return;
  }
  const post = started.getProofPost();
  log(`Publish this proof post, then submit its URL for verification.\nComposer: ${post.composerUrl}\nPost text:\n${post.text}`);
  const postUrl = (await ask('URL of the published X post: ')).trim();
  if (!postUrl) return;
  const verified = await started.verifyPost(postUrl);
  if (!verified.verified) throw new Error(`X proof was not verified (status: ${verified.status}).`);
  const settled = await started.settle();
  log(`PASS X proof for @${handle} settled on fast:testnet (${settled.txIdHex ?? settled.status}).`);
}

export async function runTestnetFlows(sdk, key, ask, log) {
  log('LIVE MODE: paid operations are hard-coded to fast:testnet; use only a throwaway wallet with testnet fee funds.');
  const confirmation = await ask(`Type '${TESTNET_CONFIRMATION}' to continue: `);
  if (confirmation.trim() !== TESTNET_CONFIRMATION) throw new Error('Live testnet confirmation did not match; no transaction was submitted.');

  const { client, address } = await createTestnetClient(sdk, key);
  log(`Signer address: ${address}; network: fast:testnet.`);
  const selection = await ask('Choose flows (comma-separated: name, website, github, orcid, x); blank cancels: ');
  const flows = parseLiveFlowSelection(selection);
  if (flows.length === 0) {
    log('No live flow selected; no transaction was submitted.');
    return;
  }
  log(`Selected testnet flow(s): ${flows.join(', ')}. Each may spend testnet fees.`);
  for (const flow of flows) {
    if (flow === 'name') await runNameFlow(client, address, log);
    else if (flow === 'website') await runWebsiteFlow(client, ask, log);
    else if (flow === 'github' || flow === 'orcid') await runOAuthFlow(client, flow, ask, log);
    else if (flow === 'x') await runXFlow(client, ask, log);
  }
}

async function main(args = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseAgentSmokeArgs(args, env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid arguments.');
    process.exitCode = 2;
    return;
  }
  if (options.mode === 'help') {
    console.log(
      'Read-only by default: pnpm --filter @fastxyz/fastid-sdk smoke:agent\nLive testnet only: ID_SDK_LIVE=1 ID_SDK_KEY=<throwaway-64-hex> pnpm --filter @fastxyz/fastid-sdk smoke:agent -- --testnet-live',
    );
    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'fastid-agent-smoke-'));
  const log = (message) => console.log(message);
  try {
    const manifest = await latestPackageManifest(fetch);
    const sdk = await installPublishedPackage(scratch, manifest.version);
    log(`PASS npm consumer: ${PACKAGE_NAME}@${manifest.version} installed with lifecycle scripts disabled and root exports imported.`);

    let checks;
    try {
      const documents = await getDiscoveryDocuments(fetch);
      checks = inspectDiscoveryDocuments(documents);
    } catch (error) {
      checks = [
        {
          name: 'deployed Fast ID discovery',
          ok: false,
          details: error instanceof Error ? error.message : 'Could not read the deployed documents.',
        },
      ];
    }
    printChecks(checks, log);

    if (options.mode === 'public-check') {
      if (checks.some((check) => !check.ok)) process.exitCode = 1;
      return;
    }

    if (checks.some((check) => !check.ok)) {
      log(
        'Discovery drift is reported above. Continuing only because --testnet-live was explicitly selected; no mainnet write path exists in this script.',
      );
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      await runTestnetFlows(sdk, options.key, (prompt) => rl.question(prompt), log);
    } finally {
      rl.close();
    }
  } catch (error) {
    reportFailure(error, log);
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await main();
