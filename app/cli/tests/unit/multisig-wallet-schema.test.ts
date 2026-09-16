import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { parseMultiSigWalletConfig } from '../../src/schemas/multisig-wallet';

const SAMPLE = {
  version: 1,
  name: 'treasury',
  signers: ['fast1qqqq', 'fast1pppp'],
  quorum: 2,
  configNonce: '0',
  fastAddress: 'fast1xyz',
  network: 'testnet',
};

describe('MultiSigWalletConfigSchema', () => {
  it('decodes a valid wallet config JSON string', async () => {
    const decoded = await Effect.runPromise(parseMultiSigWalletConfig(JSON.stringify(SAMPLE)));
    expect(decoded.name).toBe('treasury');
    expect(decoded.quorum).toBe(2);
    expect(decoded.configNonce).toBe('0');
  });

  it('rejects unknown version', async () => {
    await expect(Effect.runPromise(parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, version: 99 })))).rejects.toThrow();
  });

  it('rejects quorum < 1', async () => {
    await expect(Effect.runPromise(parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, quorum: 0 })))).rejects.toThrow();
  });

  it('rejects quorum > signer count', async () => {
    await expect(Effect.runPromise(parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, quorum: 3 })))).rejects.toThrow();
  });

  it('rejects fewer than 2 signers', async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          JSON.stringify({
            ...SAMPLE,
            signers: [SAMPLE.signers[0]],
            quorum: 1,
          }),
        ),
      ),
    ).rejects.toThrow();
  });

  it('rejects duplicate signers', async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          JSON.stringify({
            ...SAMPLE,
            signers: [SAMPLE.signers[0], SAMPLE.signers[0]],
          }),
        ),
      ),
    ).rejects.toThrow();
  });

  it('normalizes the public Rust wallet.json format', async () => {
    const decoded = await Effect.runPromise(
      parseMultiSigWalletConfig(
        JSON.stringify({
          signers: SAMPLE.signers,
          quorum: 2,
          config_nonce: 7,
          address: 'fast1rustwallet',
          proxy_url: 'https://testnet.api.fast.xyz/proxy-rest',
          network_id: 'fast:testnet',
        }),
      ),
    );

    expect(decoded).toEqual({
      version: 1,
      name: 'rust-wallet',
      signers: SAMPLE.signers,
      quorum: 2,
      configNonce: '7',
      fastAddress: 'fast1rustwallet',
      network: 'testnet',
    });
  });

  it('preserves a Rust u64 config_nonce above Number.MAX_SAFE_INTEGER', async () => {
    const decoded = await Effect.runPromise(
      parseMultiSigWalletConfig(
        `{"signers":["fast1qqqq","fast1pppp"],"quorum":2,"config_nonce":18446744073709551615,"address":"fast1rustwallet","proxy_url":"https://testnet.api.fast.xyz/proxy-rest","network_id":"fast:testnet"}`,
      ),
    );

    expect(decoded.configNonce).toBe('18446744073709551615');
  });

  it('rejects config nonces outside u64', async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          `{"signers":["fast1qqqq","fast1pppp"],"quorum":2,"config_nonce":18446744073709551616,"address":"fast1rustwallet","proxy_url":"https://testnet.api.fast.xyz/proxy-rest","network_id":"fast:testnet"}`,
        ),
      ),
    ).rejects.toThrow(/not a valid u64/);
  });

  it('reports native-schema errors without falling through to Rust decoding', async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          JSON.stringify({
            ...SAMPLE,
            signers: [SAMPLE.signers[0], SAMPLE.signers[0]],
          }),
        ),
      ),
    ).rejects.toThrow(/duplicate signers/);
  });
});
