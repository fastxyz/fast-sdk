import { describe, expect, it, vi } from 'vitest';

import {
  createTestnetClient,
  formatOperationFailure,
  inspectDiscoveryDocuments,
  parseAgentSmokeArgs,
  parseLiveFlowSelection,
  runTestnetFlows,
} from '../scripts/agent-smoke.mjs';

const currentGuide = `
## Agent SDK
npm install @fastxyz/fastid-sdk
The tarball is available as a development alternative.
`;

const currentLlms = 'See [Agent SDK](https://id.fast.xyz/AGENTS.md#agent-sdk).';
const currentCatalog = {
  linkset: [{ item: [{ href: 'https://id.fast.xyz/AGENTS.md#agent-sdk' }] }],
};

describe('agent smoke discovery checks', () => {
  it('accepts published-package discovery across all three public documents', () => {
    const result = inspectDiscoveryDocuments({
      guide: currentGuide,
      llms: currentLlms,
      apiCatalog: currentCatalog,
    });

    expect(result.every((check) => check.ok)).toBe(true);
  });

  it('detects pre-publication guidance even when the SDK section exists', () => {
    const result = inspectDiscoveryDocuments({
      guide: `${currentGuide}\nThe package is not published to npm yet.\n`,
      llms: currentLlms,
      apiCatalog: currentCatalog,
    });

    expect(result.find((check) => check.name === 'npm install guidance')?.ok).toBe(false);
  });

  it('requires npm as the primary install path before any tarball fallback', () => {
    const result = inspectDiscoveryDocuments({
      guide: `## Agent SDK\nInstall the local tarball first.\n${currentGuide}`,
      llms: currentLlms,
      apiCatalog: currentCatalog,
    });

    expect(result.find((check) => check.name === 'npm install guidance')?.ok).toBe(false);
  });

  it('rejects discovery that omits any public SDK entry point', () => {
    const result = inspectDiscoveryDocuments({
      guide: currentGuide,
      llms: 'No SDK link here.',
      apiCatalog: { linkset: [] },
    });

    expect(result.filter((check) => !check.ok).map((check) => check.name)).toEqual(['llms.txt SDK link', 'API catalog SDK link']);
  });

  it('requires real llms links and API catalog hrefs instead of prose mentions', () => {
    const sdkLink = 'https://id.fast.xyz/AGENTS.md#agent-sdk';
    const result = inspectDiscoveryDocuments({
      guide: currentGuide,
      llms: `The guide is at ${sdkLink}`,
      apiCatalog: { description: `The guide is at ${sdkLink}`, linkset: [] },
    });

    expect(result.filter((check) => !check.ok).map((check) => check.name)).toEqual(['llms.txt SDK link', 'API catalog SDK link']);
  });
});

describe('agent smoke activation', () => {
  it('defaults to public read-only checks', () => {
    expect(parseAgentSmokeArgs([], {})).toEqual({ mode: 'public-check' });
    expect(
      parseAgentSmokeArgs([], {
        ID_SDK_LIVE: '1',
        ID_SDK_KEY: 'ab'.repeat(32),
      }),
    ).toEqual({ mode: 'public-check' });
  });

  it('reports recovery identity without serializing a signed recovery envelope', () => {
    const lines = formatOperationFailure(
      Object.assign(new Error('uncertain'), {
        recovery: {
          txIdHex: 'ab'.repeat(32),
          nonce: 9n,
          recoveryEnvelope: { secretPayload: 'never print this' },
        },
      }),
    );

    expect(lines.join('\n')).toContain(`txIdHex=${'ab'.repeat(32)}`);
    expect(lines.join('\n')).toContain('nonce=9');
    expect(lines.join('\n')).toContain('Do not retry');
    expect(lines.join('\n')).not.toContain('secretPayload');
  });

  it('requires explicit testnet activation and a throwaway key', () => {
    expect(() => parseAgentSmokeArgs(['--testnet-live'], {})).toThrow(/ID_SDK_LIVE=1/);
    expect(() =>
      parseAgentSmokeArgs(['--testnet-live'], {
        ID_SDK_LIVE: '1',
        ID_SDK_KEY: 'not-a-key',
      }),
    ).toThrow(/64-hex/);
  });

  it('activates only the explicitly requested testnet mode', () => {
    expect(
      parseAgentSmokeArgs(['--testnet-live'], {
        ID_SDK_LIVE: '1',
        ID_SDK_KEY: 'ab'.repeat(32),
      }),
    ).toEqual({ mode: 'testnet-live', key: 'ab'.repeat(32) });
  });

  it('refuses endpoint overrides and any non-testnet mode', () => {
    expect(() =>
      parseAgentSmokeArgs(['--testnet-live'], {
        ID_SDK_LIVE: '1',
        ID_SDK_KEY: 'ab'.repeat(32),
        ID_SDK_ORIGIN: 'https://id.fast.xyz',
      }),
    ).toThrow(/endpoint overrides/);
    expect(() => parseAgentSmokeArgs(['--mainnet'], {})).toThrow(/Unknown option/);
  });

  it('accepts only the named human-guided testnet flows', () => {
    expect(parseLiveFlowSelection('name, website,github,orcid,x,website')).toEqual(['name', 'website', 'github', 'orcid', 'x']);
    expect(() => parseLiveFlowSelection('name,mainnet')).toThrow(/Unknown live flow/);
  });

  it('constructs the live client for testnet only and returns its signer address', async () => {
    let options;
    const sdk = {
      KeySigner: { fromPrivateKey: async () => ({ address: 'fast1test' }) },
      IdClient: class {
        constructor(value) {
          options = value;
        }
      },
    };

    const result = await createTestnetClient(sdk, 'ab'.repeat(32));

    expect(result.client).toBeInstanceOf(sdk.IdClient);
    expect(result.address).toBe('fast1test');
    expect(options.network).toBe('fast:testnet');
    expect(options.signer.address).toBe('fast1test');
  });

  it('submits no transaction before the exact human confirmation', async () => {
    const fromPrivateKey = vi.fn(async () => ({ address: 'fast1test' }));
    const ask = vi.fn(async () => 'NO');
    const sdk = {
      KeySigner: { fromPrivateKey },
      IdClient: class {},
    };

    await expect(runTestnetFlows(sdk, 'ab'.repeat(32), ask, vi.fn())).rejects.toThrow(/confirmation did not match/);
    expect(fromPrivateKey).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
