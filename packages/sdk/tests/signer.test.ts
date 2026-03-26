import { describe, it, expect } from 'vitest';
import { Signer } from '../src/signer';
import { Address } from '../src/address';

describe('Signer', () => {
  it('creates a signer from a hex private key', () => {
    const privKey = '0x'.padEnd(66, '0'); // 32 bytes in hex
    const signer = new Signer(privKey);
    expect(signer.privateKey).toBe(privKey);
  });

  it('creates a signer from a Uint8Array private key', () => {
    const privKey = new Uint8Array(32).fill(0x42);
    const signer = new Signer(privKey);
    expect(signer.privateKey).toMatch(/^0x/);
  });

  it('derives consistent public key', async () => {
    const privKey = '0x'.padEnd(66, '1'); // 32 bytes of 0x11...
    const signer = new Signer(privKey);
    const pubKey1 = await signer.getPublicKey();
    const pubKey2 = await signer.getPublicKey();
    expect(pubKey1).toEqual(pubKey2);
  });

  it('derives address from public key', async () => {
    const privKey = '0x'.padEnd(66, '2');
    const signer = new Signer(privKey);
    const address = await signer.getAddress();
    expect(address).toBeInstanceOf(Address);
    expect(address.toString()).toMatch(/^fast/);
  });

  it('returns public key as hex', async () => {
    const privKey = '0x'.padEnd(66, '3');
    const signer = new Signer(privKey);
    const pubKeyHex = await signer.getPublicKeyHex();
    expect(pubKeyHex).toMatch(/^0x[0-9a-f]+$/i);
    expect(pubKeyHex).toHaveLength(66); // 0x + 64 hex chars = 32 bytes
  });

  it('signs a message', async () => {
    const privKey = '0x'.padEnd(66, '4');
    const signer = new Signer(privKey);
    const message = new TextEncoder().encode('test message');
    const signature = await signer.signMessage(message);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature).toHaveLength(64); // Ed25519 signature is 64 bytes
  });

  it('verifies a valid signature', async () => {
    const privKey = '0x'.padEnd(66, '5');
    const signer = new Signer(privKey);
    const message = new TextEncoder().encode('test message');
    const signature = await signer.signMessage(message);
    const pubKey = await signer.getPublicKey();
    
    const isValid = await Signer.verify(signature, message, pubKey);
    expect(isValid).toBe(true);
  });

  it('rejects invalid signature', async () => {
    const privKey = '0x'.padEnd(66, '6');
    const signer = new Signer(privKey);
    const message = new TextEncoder().encode('test message');
    const badSignature = new Uint8Array(64).fill(0);
    const pubKey = await signer.getPublicKey();
    
    const isValid = await Signer.verify(badSignature, message, pubKey);
    expect(isValid).toBe(false);
  });

  it('verifies with Address instance', async () => {
    const privKey = '0x'.padEnd(66, '7');
    const signer = new Signer(privKey);
    const message = new TextEncoder().encode('test message');
    const signature = await signer.signMessage(message);
    const address = await signer.getAddress();
    
    const isValid = await Signer.verify(signature, message, address);
    expect(isValid).toBe(true);
  });

  it('verifies with address string', async () => {
    const privKey = '0x'.padEnd(66, '8');
    const signer = new Signer(privKey);
    const message = new TextEncoder().encode('test message');
    const signature = await signer.signMessage(message);
    const addressStr = (await signer.getAddress()).toString();
    
    const isValid = await Signer.verify(signature, message, addressStr);
    expect(isValid).toBe(true);
  });
});
