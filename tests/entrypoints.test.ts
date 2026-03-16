import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as rootEntrypoint from '../src/index.js';
import * as browserEntrypoint from '../src/browser.js';

describe('entrypoints', () => {
  it('keeps the root entrypoint Node-oriented while exporting the canonical codec helpers', () => {
    assert.equal(typeof rootEntrypoint.FastProvider, 'function');
    assert.equal(typeof rootEntrypoint.FastWallet, 'function');
    assert.equal(typeof rootEntrypoint.FastError, 'function');
    assert.equal('FastBrowserWallet' in rootEntrypoint, false);
    assert.ok(rootEntrypoint.FAST_TOKEN_ID instanceof Uint8Array);
    assert.equal(typeof rootEntrypoint.hashTransaction, 'function');
    assert.equal(typeof rootEntrypoint.encodeFastAddress, 'function');
    assert.equal(typeof rootEntrypoint.fastAddressToBytes, 'function');
    assert.equal(typeof rootEntrypoint.decodeFastAddress, 'function');
    assert.equal('pubkeyToAddress' in rootEntrypoint, false);
    assert.equal('addressToPubkey' in rootEntrypoint, false);
    assert.equal('normalizeFastAddress' in rootEntrypoint, false);
    assert.equal('getCertificateHash' in rootEntrypoint, false);
  });

  it('exposes browser-safe values and the canonical codec helpers from the browser entrypoint', () => {
    assert.equal(typeof browserEntrypoint.FastProvider, 'function');
    assert.equal('FastBrowserWallet' in browserEntrypoint, false);
    assert.ok(browserEntrypoint.FAST_TOKEN_ID instanceof Uint8Array);
    assert.equal(typeof browserEntrypoint.getCertificateHash, 'function');
    assert.equal(typeof browserEntrypoint.encodeFastAddress, 'function');
    assert.equal(typeof browserEntrypoint.fastAddressToBytes, 'function');
    assert.equal(typeof browserEntrypoint.decodeFastAddress, 'function');
    assert.equal('pubkeyToAddress' in browserEntrypoint, false);
    assert.equal('addressToPubkey' in browserEntrypoint, false);
    assert.equal('normalizeFastAddress' in browserEntrypoint, false);
  });
});
