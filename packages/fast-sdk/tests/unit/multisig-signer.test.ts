import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { bcsSchema, type VersionedTransaction, VersionedTransactionFromBcs } from '@fastxyz/schema';
import { getPublicKeyAsync } from '@noble/ed25519';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/core/run';
import { fromFastAddress, fromHex, Signer, toFastAddress, TransactionBuilder, toHex } from '../../src/index';
import {
  assertAuthorizedSigner,
  canonicalizeMultiSigSigners,
  deriveMultiSigAddress,
  deriveMultiSigAddressBytes,
  MultiSigConfigInvalidError,
  MultiSigSigner,
  NotAuthorizedSignerError,
  validateMultiSigConfig,
} from '../../src/interface/multisig-signer';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures/multisig-addresses.json'), 'utf8')) as Array<{
  comment: string;
  config: { authorized_signers: string[]; quorum: string; nonce: string };
  expectedAddressHex: string;
}>;

describe('deriveMultiSigAddress', () => {
  for (const f of fixtures) {
    it(`matches Rust derivation: ${f.comment}`, async () => {
      const config = {
        authorized_signers: f.config.authorized_signers.map((s) => fromHex(s)),
        quorum: BigInt(f.config.quorum),
        nonce: BigInt(f.config.nonce),
      };
      const bytes = await deriveMultiSigAddressBytes(config);
      expect(toHex(bytes)).toBe(f.expectedAddressHex);
    });
  }

  it('produces a bech32m fast1... address', async () => {
    const config = {
      authorized_signers: [new Uint8Array(32), new Uint8Array(32).fill(1)],
      quorum: 2n,
      nonce: 0n,
    };
    const addr = await deriveMultiSigAddress(config);
    expect(addr.startsWith('fast1')).toBe(true);
  });

  it('matches the Rust byte order when bech32 text order differs', async () => {
    const addresses = [
      'fast132yw8ht5p8cetl2jmvknewjawt9xwzdlrk2pyxlnwjyqrdq0dawqkehkfr',
      'fast1syuhwr4g05t4744r23nvxnr7en9cmz53knhr0gja7c84hr7fkw2q236m04',
      'fast1a4yj333g68pvd6hfqvufqkv4vy54jfe6t33ljd3kc9rpfty8xlgsuy3e37',
    ];
    const byteSorted = canonicalizeMultiSigSigners(addresses.map(fromFastAddress));
    expect(addresses.slice().sort()).not.toEqual(byteSorted.map(toFastAddress));
    await expect(deriveMultiSigAddress({ authorized_signers: byteSorted, quorum: 2n, nonce: 0n })).resolves.toBe(
      'fast1vqeq9q4j0d20x48kjcphrcydtpj2s3u4ld7kmu7segfzdtjrkrmsa9hu83',
    );
  });
});

describe('assertAuthorizedSigner', () => {
  const SECRET_A = new Uint8Array(32).fill(0xaa);
  const SECRET_B = new Uint8Array(32).fill(0xbb);

  it('returns void when secret derives a pubkey in authorized_signers', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([pkA, pkB]),
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).resolves.toBeUndefined();
  });

  it('throws NotAuthorizedSignerError when secret is not a member', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const otherSecret = new Uint8Array(32).fill(0xcc);
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([pkA, await getPublicKeyAsync(SECRET_B)]),
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, otherSecret)).rejects.toThrow(NotAuthorizedSignerError);
  });

  it('throws MultiSigConfigInvalidError on quorum < 1', async () => {
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([await getPublicKeyAsync(SECRET_A), await getPublicKeyAsync(SECRET_B)]),
      quorum: 0n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(MultiSigConfigInvalidError);
  });

  it('throws MultiSigConfigInvalidError on quorum > signer count', async () => {
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([await getPublicKeyAsync(SECRET_A), await getPublicKeyAsync(SECRET_B)]),
      quorum: 3n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(MultiSigConfigInvalidError);
  });

  it('throws MultiSigConfigInvalidError on signer count < 2', async () => {
    const config = {
      authorized_signers: [await getPublicKeyAsync(SECRET_A)],
      quorum: 1n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(MultiSigConfigInvalidError);
  });

  it('throws MultiSigConfigInvalidError on duplicate signers', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const config = {
      authorized_signers: [pkA, pkA],
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(MultiSigConfigInvalidError);
  });

  it('rejects signers that are not strictly byte-sorted', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const sorted = canonicalizeMultiSigSigners([pkA, pkB]);
    const config = {
      authorized_signers: sorted.reverse(),
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(/strictly sorted by raw address bytes/);
  });

  it('rejects signer addresses that are not exactly 32 bytes', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([pkA, new Uint8Array(31)]),
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(/must be 32 bytes/);
  });

  it.each([-1n, 1n << 64n])('rejects a config nonce outside u64: %s', async (nonce) => {
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([await getPublicKeyAsync(SECRET_A), await getPublicKeyAsync(SECRET_B)]),
      quorum: 2n,
      nonce,
    };

    expect(() => validateMultiSigConfig(config)).toThrow(/nonce must fit u64/);
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(MultiSigConfigInvalidError);
  });
});

describe('MultiSigSigner construction', () => {
  const SECRET_A = new Uint8Array(32).fill(0xaa);
  const SECRET_B = new Uint8Array(32).fill(0xbb);

  it('constructs with a member secret and exposes pubkey', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = { authorized_signers: canonicalizeMultiSigSigners([pkA, pkB]), quorum: 2n, nonce: 0n };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    expect(await signer.getSignerPublicKey()).toEqual(pkA);
  });

  it('getFastAddress returns derived multisig bech32m', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = { authorized_signers: canonicalizeMultiSigSigners([pkA, pkB]), quorum: 2n, nonce: 0n };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const fromSigner = await signer.getFastAddress();
    const direct = await deriveMultiSigAddress(config);
    expect(fromSigner).toBe(direct);
  });

  it('rejects construction when secret is not in authorized_signers', async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = { authorized_signers: canonicalizeMultiSigSigners([pkA, pkB]), quorum: 2n, nonce: 0n };
    const stranger = new Uint8Array(32).fill(0xcc);
    // Construction is sync; validation happens lazily on first method call
    const signer = new MultiSigSigner({ config, secretKey: stranger });
    await expect(signer.getSignerPublicKey()).rejects.toThrow(NotAuthorizedSignerError);
  });

  it('defensively copies config, secret and returned public keys', async () => {
    const secret = new Uint8Array(32).fill(0xaa);
    const pkA = await getPublicKeyAsync(secret);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const authorized_signers = canonicalizeMultiSigSigners([pkA, pkB]);
    const signer = new MultiSigSigner({
      config: { authorized_signers, quorum: 2n, nonce: 0n },
      secretKey: secret,
    });

    secret.fill(0);
    authorized_signers[0]!.fill(0);
    const exposed = signer.config;
    exposed.authorized_signers[0]!.fill(0);
    const firstPublicKey = await signer.getSignerPublicKey();
    firstPublicKey.fill(0);

    expect(await signer.getSignerPublicKey()).toEqual(pkA);
    expect(await signer.getFastAddress()).toMatch(/^fast1/);
  });
});

describe('MultiSigSigner.signEnvelopeFor', () => {
  it('produces a MultiSig envelope with one partial signature', async () => {
    const SECRET_A = new Uint8Array(32).fill(0xaa);
    const SECRET_B = new Uint8Array(32).fill(0xbb);
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([pkA, pkB]),
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const sender = await signer.getDerivedAddressBytes();

    // Build a versioned transaction by hand (single TokenTransfer).
    // Using TransactionBuilder against a throw-away Signer is the
    // simplest way to construct a valid VersionedTransaction shape.
    const builder = new TransactionBuilder({
      networkId: 'fast:testnet' as const,
      signer: new Signer(SECRET_A), // construction only; we replace sender below
      nonce: 0n,
    });
    const stubEnvelope = await builder
      .addTokenTransfer({
        tokenId: new Uint8Array(32),
        recipient: new Uint8Array(32),
        amount: 1n,
        userData: null,
      })
      .sign();

    // Replace sender to simulate a tx originated by the multisig wallet.
    // The spread loses the brand on `sender`; cast back to VersionedTransaction
    // since runtime shape is unchanged (test-only).
    const versioned = {
      ...stubEnvelope.transaction,
      value: { ...stubEnvelope.transaction.value, sender },
    } as VersionedTransaction;

    const envelope = await signer.signEnvelopeFor(versioned);
    expect(envelope.transaction).toBe(versioned);
    expect(envelope.signature.type).toBe('MultiSig');
    if (envelope.signature.type !== 'MultiSig') throw new Error('unreachable');
    // Envelope config is camelCase + branded (the SignatureOrMultiSig.Type shape).
    // Compare structurally — toEqual treats branded Uint8Arrays as equal to plain ones.
    expect(envelope.signature.value.config.authorizedSigners).toEqual(config.authorized_signers);
    expect(envelope.signature.value.config.quorum).toBe(config.quorum);
    expect(envelope.signature.value.config.nonce).toBe(config.nonce);
    expect(envelope.signature.value.signatures).toHaveLength(1);
    expect(envelope.signature.value.signatures[0]![0]).toEqual(pkA);

    // Byte-equivalence: a single-signer Signer.signTypedData over the same
    // versioned tx must produce the same 64-byte signature as a multisig
    // partial. This is what makes proxy aggregation correct.
    const single = await new Signer(SECRET_A).signTypedData(
      bcsSchema.VersionedTransaction,
      await run(Schema.encode(VersionedTransactionFromBcs)(versioned)),
    );
    expect(envelope.signature.value.signatures[0]![1]).toEqual(single);
  });

  it('refuses a transaction whose sender is not the derived multisig address', async () => {
    const SECRET_A = new Uint8Array(32).fill(0xaa);
    const SECRET_B = new Uint8Array(32).fill(0xbb);
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([await getPublicKeyAsync(SECRET_A), await getPublicKeyAsync(SECRET_B)]),
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const wrong = await new TransactionBuilder({
      networkId: 'fast:testnet',
      signer: new Signer(SECRET_A),
      nonce: 0n,
    })
      .addBurn({ tokenId: new Uint8Array(32), amount: 1n })
      .sign();

    await expect(signer.signEnvelopeFor(wrong.transaction)).rejects.toThrow(/sender does not match the derived multisig address/);
  });
});

describe('MultiSigSigner.signTransaction', () => {
  it('builds a versioned tx with sender=derived and signs as partial', async () => {
    const SECRET_A = new Uint8Array(32).fill(0xaa);
    const SECRET_B = new Uint8Array(32).fill(0xbb);
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([pkA, pkB]),
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const sender = await signer.getDerivedAddressBytes();

    const envelope = await signer.signTransaction({
      networkId: 'fast:testnet' as const,
      nonce: 0n,
      operations: [
        {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      ],
    });

    expect(envelope.transaction.value.sender).toEqual(sender);
    expect(envelope.signature.type).toBe('MultiSig');
  });
});
