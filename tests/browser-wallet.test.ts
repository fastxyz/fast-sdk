import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FastProvider, FastWallet } from '../src/browser.js';

describe('Browser FastWallet', () => {
  describe('generate', () => {
    it('should generate a new wallet with address and privateKey', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);

      assert.ok(wallet.address.startsWith('fast1'), 'Address should start with fast1');
      assert.ok(wallet.privateKey.length === 64, 'Private key should be 64 hex chars');
      assert.ok(wallet.provider === provider, 'Provider should be the same instance');
    });

    it('should generate unique wallets each time', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet1 = await FastWallet.generate(provider);
      const wallet2 = await FastWallet.generate(provider);

      assert.notEqual(wallet1.address, wallet2.address);
      assert.notEqual(wallet1.privateKey, wallet2.privateKey);
    });
  });

  describe('fromPrivateKey', () => {
    it('should create wallet from valid private key', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const privateKey = 'a919e405ec3c4f8fdfcd892c434043ccf97742432e7cf686530e17fd842f74e3';
      
      const wallet = await FastWallet.fromPrivateKey(privateKey, provider);

      assert.ok(wallet.address.startsWith('fast1'));
      assert.equal(wallet.privateKey, privateKey);
    });

    it('should accept private key with 0x prefix', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const privateKey = '0xa919e405ec3c4f8fdfcd892c434043ccf97742432e7cf686530e17fd842f74e3';
      
      const wallet = await FastWallet.fromPrivateKey(privateKey, provider);

      assert.ok(wallet.address.startsWith('fast1'));
      // Private key stored without prefix
      assert.equal(wallet.privateKey, privateKey.slice(2));
    });

    it('should throw for invalid private key length', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      
      await assert.rejects(
        () => FastWallet.fromPrivateKey('abc123', provider),
        /Private key must be 32 bytes/
      );
    });

    it('should derive same address from same private key', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const privateKey = 'a919e405ec3c4f8fdfcd892c434043ccf97742432e7cf686530e17fd842f74e3';
      
      const wallet1 = await FastWallet.fromPrivateKey(privateKey, provider);
      const wallet2 = await FastWallet.fromPrivateKey(privateKey, provider);

      assert.equal(wallet1.address, wallet2.address);
    });
  });

  describe('sign and verify', () => {
    it('should sign a message and verify the signature', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);
      
      const message = 'Hello, Fast!';
      const signed = await wallet.sign({ message });

      assert.ok(signed.signature.length > 0);
      assert.equal(signed.address, wallet.address);

      const verified = await wallet.verify({
        message,
        signature: signed.signature,
        address: wallet.address,
      });

      assert.equal(verified.valid, true);
    });

    it('should reject invalid signature', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);
      
      const verified = await wallet.verify({
        message: 'Hello, Fast!',
        signature: '00'.repeat(64), // Invalid signature
        address: wallet.address,
      });

      assert.equal(verified.valid, false);
    });

    it('should sign bytes directly', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);
      
      const messageBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const signed = await wallet.sign({ message: messageBytes });

      assert.ok(signed.signature.length > 0);
      assert.equal(signed.address, wallet.address);
    });
  });

  describe('exportKeys', () => {
    it('should export public key and address (not private key)', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);
      
      const exported = await wallet.exportKeys();

      assert.equal(exported.address, wallet.address);
      assert.ok(exported.publicKey.length === 64, 'Public key should be 64 hex chars');
      assert.ok(!('privateKey' in exported), 'Should not include private key');
    });
  });

  describe('balance', () => {
    it('should have balance method that calls provider', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);
      
      // This will fail with network error, but we're just testing the method exists
      assert.equal(typeof wallet.balance, 'function');
    });
  });

  describe('tokens', () => {
    it('should have tokens method that calls provider', async () => {
      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);
      
      assert.equal(typeof wallet.tokens, 'function');
    });
  });
});
