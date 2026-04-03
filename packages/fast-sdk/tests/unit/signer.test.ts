import { describe, expect, it } from 'vitest';
import { Signer, verify, verifyTypedData } from '../../src/index';
import { bcs } from '@mysten/bcs';

const HEX_KEY_32 = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('Signer', () => {
  describe('construction', () => {
    it('accepts hex string private key', () => {
      const signer = new Signer(HEX_KEY_32);
      expect(signer).toBeInstanceOf(Signer);
    });

    it('accepts 0x-prefixed hex string', () => {
      const signer = new Signer(`0x${HEX_KEY_32}`);
      expect(signer).toBeInstanceOf(Signer);
    });

    it('accepts Uint8Array private key', () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      expect(signer).toBeInstanceOf(Signer);
    });

    it('accepts number[] private key', () => {
      const signer = new Signer(Array.from({ length: 32 }, (_, i) => i));
      expect(signer).toBeInstanceOf(Signer);
    });

    it('rejects wrong-length hex string', () => {
      expect(() => new Signer('abcd')).toThrow();
    });

    it('rejects wrong-length Uint8Array', () => {
      expect(() => new Signer(new Uint8Array(16))).toThrow();
    });

    it('rejects empty input', () => {
      expect(() => new Signer(new Uint8Array(0))).toThrow();
    });
  });

  describe('getPublicKey', () => {
    it('returns 32-byte public key', async () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      const pubKey = await signer.getPublicKey();
      expect(pubKey).toBeInstanceOf(Uint8Array);
      expect(pubKey).toHaveLength(32);
    });

    it('caches on repeated calls', async () => {
      const signer = new Signer(new Uint8Array(32).fill(2));
      const pk1 = await signer.getPublicKey();
      const pk2 = await signer.getPublicKey();
      expect(pk1).toBe(pk2); // same reference
    });

    it('different private keys produce different public keys', async () => {
      const s1 = new Signer(new Uint8Array(32).fill(1));
      const s2 = new Signer(new Uint8Array(32).fill(2));
      const pk1 = await s1.getPublicKey();
      const pk2 = await s2.getPublicKey();
      expect(pk1).not.toEqual(pk2);
    });
  });

  describe('getFastAddress', () => {
    it('returns a string starting with fast1', async () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      const addr = await signer.getFastAddress();
      expect(addr).toMatch(/^fast1/);
    });

    it('is deterministic', async () => {
      const signer = new Signer(new Uint8Array(32).fill(2));
      const a1 = await signer.getFastAddress();
      const a2 = await signer.getFastAddress();
      expect(a1).toBe(a2);
    });

    it('different private keys produce different addresses', async () => {
      const s1 = new Signer(new Uint8Array(32).fill(1));
      const s2 = new Signer(new Uint8Array(32).fill(2));
      const a1 = await s1.getFastAddress();
      const a2 = await s2.getFastAddress();
      expect(a1).not.toBe(a2);
    });
  });

  describe('signMessage', () => {
    it('returns 64-byte signature', async () => {
      const signer = new Signer(new Uint8Array(32).fill(3));
      const sig = await signer.signMessage(new TextEncoder().encode('hello'));
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig).toHaveLength(64);
    });

    it('produces deterministic signatures', async () => {
      const signer = new Signer(new Uint8Array(32).fill(3));
      const msg = new TextEncoder().encode('deterministic');
      const a = await signer.signMessage(msg);
      const b = await signer.signMessage(msg);
      expect(a).toEqual(b);
    });
  });

  describe('sign + verify roundtrip', () => {
    it('verifies a valid signature', async () => {
      const signer = new Signer(new Uint8Array(32).fill(4));
      const msg = new TextEncoder().encode('test message');
      const sig = await signer.signMessage(msg);
      const pubKey = await signer.getPublicKey();
      const valid = await verify(sig, msg, pubKey);
      expect(valid).toBe(true);
    });

    it('rejects a tampered message', async () => {
      const signer = new Signer(new Uint8Array(32).fill(5));
      const msg = new TextEncoder().encode('original');
      const sig = await signer.signMessage(msg);
      const pubKey = await signer.getPublicKey();
      const valid = await verify(sig, new TextEncoder().encode('tampered'), pubKey);
      expect(valid).toBe(false);
    });

    it('rejects wrong public key', async () => {
      const signer1 = new Signer(new Uint8Array(32).fill(6));
      const signer2 = new Signer(new Uint8Array(32).fill(7));
      const msg = new TextEncoder().encode('hello');
      const sig = await signer1.signMessage(msg);
      const wrongPubKey = await signer2.getPublicKey();
      const valid = await verify(sig, msg, wrongPubKey);
      expect(valid).toBe(false);
    });
  });

  describe('signTypedData + verifyTypedData roundtrip', () => {
    const TestSchema = bcs.struct('TestSchema', { amount: bcs.u64() });

    it('round-trips typed data', async () => {
      const signer = new Signer(new Uint8Array(32).fill(8));
      const data = { amount: 1000n };
      const sig = await signer.signTypedData(TestSchema, data);
      const pubKey = await signer.getPublicKey();
      const valid = await verifyTypedData(sig, TestSchema, data, pubKey);
      expect(valid).toBe(true);
    });

    it('rejects modified data', async () => {
      const signer = new Signer(new Uint8Array(32).fill(9));
      const sig = await signer.signTypedData(TestSchema, { amount: 100n });
      const pubKey = await signer.getPublicKey();
      const valid = await verifyTypedData(sig, TestSchema, { amount: 200n }, pubKey);
      expect(valid).toBe(false);
    });
  });
});
