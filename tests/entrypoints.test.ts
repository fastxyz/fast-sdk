import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as rootEntrypoint from '../src/index.js';
import * as browserEntrypoint from '../src/browser.js';

describe('entrypoints', () => {
  it('keeps the root entrypoint Node-oriented', () => {
    assert.equal(typeof rootEntrypoint.FastProvider, 'function');
    assert.equal(typeof rootEntrypoint.FastWallet, 'function');
    assert.equal(typeof rootEntrypoint.FastError, 'function');
    assert.equal('FastBrowserWallet' in rootEntrypoint, false);
    assert.equal('FAST_TOKEN_ID' in rootEntrypoint, false);
    assert.equal('getCertificateHash' in rootEntrypoint, false);
  });

  it('exposes browser-safe values from the browser entrypoint', () => {
    assert.equal(typeof browserEntrypoint.FastProvider, 'function');
    assert.equal(typeof browserEntrypoint.FastBrowserWallet, 'function');
    assert.ok(browserEntrypoint.FAST_TOKEN_ID instanceof Uint8Array);
    assert.equal(typeof browserEntrypoint.getCertificateHash, 'function');
  });
});
