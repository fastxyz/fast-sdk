import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FAST_DECIMALS,
  SET_TOKEN_ID,
  EXPLORER_BASE,
  tokenIdEquals,
  hexToTokenId,
  hashTransaction,
  type FastTransaction,
} from '../src/bcs.js';

describe('bcs', () => {
  describe('constants', () => {
    it('FAST_DECIMALS should equal 18', () => {
      assert.equal(FAST_DECIMALS, 18);
    });

    it('SET_TOKEN_ID should be a Uint8Array', () => {
      assert.ok(SET_TOKEN_ID instanceof Uint8Array);
    });

    it('SET_TOKEN_ID should have length 32', () => {
      assert.equal(SET_TOKEN_ID.length, 32);
    });

    it('SET_TOKEN_ID[0] should be 0xfa', () => {
      assert.equal(SET_TOKEN_ID[0], 0xfa);
    });

    it('SET_TOKEN_ID[1] should be 0x57', () => {
      assert.equal(SET_TOKEN_ID[1], 0x57);
    });

    it('SET_TOKEN_ID[2] should be 0x5e', () => {
      assert.equal(SET_TOKEN_ID[2], 0x5e);
    });

    it('SET_TOKEN_ID[3] should be 0x70', () => {
      assert.equal(SET_TOKEN_ID[3], 0x70);
    });

    it('SET_TOKEN_ID bytes 4-31 should all be 0', () => {
      assert.ok(
        SET_TOKEN_ID.slice(4).every((b) => b === 0),
        'Expected bytes 4-31 to all be 0',
      );
    });

    it('EXPLORER_BASE should equal the expected URL', () => {
      assert.equal(EXPLORER_BASE, 'https://explorer.fastset.xyz/txs');
    });
  });

  describe('tokenIdEquals', () => {
    it('should return true when comparing SET_TOKEN_ID to itself', () => {
      assert.equal(tokenIdEquals(SET_TOKEN_ID, SET_TOKEN_ID), true);
    });

    it('should return true with number[] first arg matching SET_TOKEN_ID', () => {
      assert.equal(tokenIdEquals(Array.from(SET_TOKEN_ID), SET_TOKEN_ID), true);
    });

    it('should return false for different arrays of same length', () => {
      assert.equal(tokenIdEquals(new Uint8Array(32), SET_TOKEN_ID), false);
    });

    it('should return false for arrays of different lengths', () => {
      assert.equal(tokenIdEquals(new Uint8Array(16), new Uint8Array(32)), false);
    });

    it('should return true for two empty arrays', () => {
      assert.equal(tokenIdEquals([], new Uint8Array(0)), true);
    });
  });

  describe('hexToTokenId', () => {
    it('should parse 0xfa575e70 to match SET_TOKEN_ID', () => {
      const result = hexToTokenId('0xfa575e70');
      assert.equal(tokenIdEquals(result, SET_TOKEN_ID), true);
    });

    it('should parse fa575e70 (no 0x prefix) to match SET_TOKEN_ID', () => {
      const result = hexToTokenId('fa575e70');
      assert.equal(tokenIdEquals(result, SET_TOKEN_ID), true);
    });

    it('should parse 0X-prefixed all-ff hex to all 0xff bytes', () => {
      const result = hexToTokenId('0X' + 'ff'.repeat(32));
      assert.ok(
        Array.from(result).every((b) => b === 255),
        'Expected every byte to be 255',
      );
    });

    it('result should always be 32 bytes', () => {
      assert.equal(hexToTokenId('0xfa575e70').length, 32);
    });

    it('should pad 0x00 to all-zero 32 bytes', () => {
      const result = hexToTokenId('0x00');
      assert.ok(
        Array.from(result).every((b) => b === 0),
        'Expected every byte to be 0',
      );
    });
  });

  describe('hashTransaction', () => {
    const tx: FastTransaction = {
      sender: new Uint8Array(32),
      recipient: new Uint8Array(32),
      nonce: 0,
      timestamp_nanos: 0n,
      claim: {
        TokenTransfer: {
          token_id: SET_TOKEN_ID,
          amount: 'de0b6b3a7640000',
          user_data: null,
        },
      },
      archival: false,
    };

    it('result should start with 0x', () => {
      assert.ok(hashTransaction(tx).startsWith('0x'));
    });

    it('result should have length 66 (0x + 64 hex chars)', () => {
      assert.equal(hashTransaction(tx).length, 66);
    });

    it('should be deterministic — same transaction hashed twice gives same result', () => {
      assert.equal(hashTransaction(tx), hashTransaction(tx));
    });

    it('should produce a different hash when nonce changes', () => {
      const tx2: FastTransaction = { ...tx, nonce: 1 };
      assert.notEqual(hashTransaction(tx), hashTransaction(tx2));
    });
  });
});
