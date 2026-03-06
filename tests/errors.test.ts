import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FastError } from '../src/errors.js';
import type { FastErrorCode } from '../src/errors.js';

describe('FastError', () => {
  describe('constructor — all fields', () => {
    it('sets code, message, and note', () => {
      const err = new FastError('TX_FAILED', 'something broke', { note: 'retry' });

      assert.equal(err.code, 'TX_FAILED');
      assert.equal(err.message, 'something broke');
      assert.equal(err.note, 'retry');
    });
  });

  describe('constructor — minimal (no opts)', () => {
    it('sets code and message; note defaults to empty string', () => {
      const err = new FastError('INVALID_PARAMS', 'bad input');

      assert.equal(err.code, 'INVALID_PARAMS');
      assert.equal(err.message, 'bad input');
      assert.equal(err.note, '');
    });
  });

  describe('instanceof checks', () => {
    it('is an instance of Error', () => {
      const err = new FastError('TX_FAILED', 'failed');
      assert.ok(err instanceof Error);
    });

    it('is an instance of FastError', () => {
      const err = new FastError('TX_FAILED', 'failed');
      assert.ok(err instanceof FastError);
    });
  });

  describe('.name', () => {
    it('is "FastError"', () => {
      const err = new FastError('INVALID_ADDRESS', 'bad address');
      assert.equal(err.name, 'FastError');
    });
  });

  describe('toJSON', () => {
    it('returns a plain object with all fields when fully populated', () => {
      const err = new FastError(
        'TX_FAILED',
        'something broke',
        { note: 'retry' },
      );

      const json = err.toJSON();

      assert.equal(json['error'], true);
      assert.equal(json['code'], 'TX_FAILED');
      assert.equal(json['message'], 'something broke');
      assert.equal(json['note'], 'retry');
    });

    it('note is empty string when opts is omitted', () => {
      const err = new FastError('INVALID_PARAMS', 'bad input');
      const json = err.toJSON();

      assert.equal(json['error'], true);
      assert.equal(json['note'], '');
    });
  });

  describe('all error codes', () => {
    const codes: FastErrorCode[] = [
      'INSUFFICIENT_BALANCE',
      'CHAIN_NOT_CONFIGURED',
      'TX_FAILED',
      'INVALID_ADDRESS',
      'TOKEN_NOT_FOUND',
      'INVALID_PARAMS',
      'UNSUPPORTED_OPERATION',
    ];

    for (const code of codes) {
      it(`can construct FastError with code "${code}"`, () => {
        const err = new FastError(code, `test error for ${code}`);
        assert.equal(err.code, code);
        assert.ok(err instanceof FastError);
      });
    }
  });

  describe('throwable and catchable', () => {
    it('is catchable and narrowable via instanceof', () => {
      let caught: unknown;

      try {
        throw new FastError('TX_FAILED', 'simulated failure', {
          note: 'This is a test throw.',
        });
      } catch (err: unknown) {
        caught = err;
      }

      assert.ok(caught instanceof FastError);
      assert.equal((caught as FastError).code, 'TX_FAILED');
      assert.equal((caught as FastError).message, 'simulated failure');
    });
  });
});
