import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  toRaw,
  toHuman,
  toHex,
  fromHex,
  compareDecimalStrings,
  expandHome,
  resolveHomeDir,
} from '../src/node/utils.js';

describe('utils', () => {
  describe('toRaw', () => {
    it('converts whole number "1" with 18 decimals', () => {
      assert.equal(toRaw('1', 18), 1000000000000000000n);
    });

    it('converts "0" with 18 decimals', () => {
      assert.equal(toRaw('0', 18), 0n);
    });

    it('converts "1.5" with 18 decimals', () => {
      assert.equal(toRaw('1.5', 18), 1500000000000000000n);
    });

    it('converts "0.000001" with 6 decimals', () => {
      assert.equal(toRaw('0.000001', 6), 1n);
    });

    it('converts large integer "1000000" with 18 decimals', () => {
      assert.equal(toRaw('1000000', 18), 1000000000000000000000000n);
    });

    it('truncates fractional digits beyond decimals precision', () => {
      // "0.123456789" with 6 decimals → truncates to "0.123456" → 123456n
      assert.equal(toRaw('0.123456789', 6), 123456n);
    });
  });

  describe('toHuman', () => {
    it('converts 1e18 raw bigint to "1"', () => {
      assert.equal(toHuman(1000000000000000000n, 18), '1');
    });

    it('converts 0n to "0"', () => {
      assert.equal(toHuman(0n, 18), '0');
    });

    it('converts 1.5e18 raw bigint to "1.5"', () => {
      assert.equal(toHuman(1500000000000000000n, 18), '1.5');
    });

    it('converts 1n with 6 decimals to "0.000001"', () => {
      assert.equal(toHuman(1n, 6), '0.000001');
    });

    it('accepts a string input', () => {
      assert.equal(toHuman('1000000', 6), '1');
    });
  });

  describe('toHex', () => {
    it('converts "1" with 18 decimals to hex', () => {
      // 1e18 = 0xde0b6b3a7640000
      assert.equal(toHex('1', 18), 'de0b6b3a7640000');
    });

    it('converts "0" with 18 decimals to "0"', () => {
      assert.equal(toHex('0', 18), '0');
    });
  });

  describe('fromHex', () => {
    it('converts hex "de0b6b3a7640000" with 18 decimals to "1"', () => {
      assert.equal(fromHex('de0b6b3a7640000', 18), '1');
    });

    it('converts "0" to "0"', () => {
      assert.equal(fromHex('0', 18), '0');
    });

    it('converts empty string to "0"', () => {
      assert.equal(fromHex('', 18), '0');
    });
  });

  describe('toHex / fromHex roundtrip', () => {
    it('roundtrips "1.5" with 18 decimals', () => {
      assert.equal(fromHex(toHex('1.5', 18), 18), '1.5');
    });

    it('roundtrips "0.000001" with 6 decimals', () => {
      assert.equal(fromHex(toHex('0.000001', 6), 6), '0.000001');
    });
  });

  describe('compareDecimalStrings', () => {
    it('returns 0 for equal values "1.0" and "1.0"', () => {
      assert.equal(compareDecimalStrings('1.0', '1.0'), 0);
    });

    it('returns 1 when a > b: "1.5" vs "1.0"', () => {
      assert.equal(compareDecimalStrings('1.5', '1.0'), 1);
    });

    it('returns -1 when a < b: "1.0" vs "1.5"', () => {
      assert.equal(compareDecimalStrings('1.0', '1.5'), -1);
    });

    it('returns 1 when a > b: "100" vs "99.99"', () => {
      assert.equal(compareDecimalStrings('100', '99.99'), 1);
    });

    it('returns -1 when a < b: "0.001" vs "0.01"', () => {
      assert.equal(compareDecimalStrings('0.001', '0.01'), -1);
    });
  });

  describe('expandHome', () => {
    it('expands bare "~" to the resolved writable home directory', () => {
      assert.equal(expandHome('~'), resolveHomeDir());
    });

    it('expands "~/foo" relative to the resolved writable home directory', () => {
      assert.equal(expandHome('~/foo'), path.join(resolveHomeDir(), 'foo'));
    });

    it('returns an absolute path unchanged (resolved)', () => {
      const abs = '/absolute/path';
      assert.equal(expandHome(abs), path.resolve(abs));
    });
  });
});
