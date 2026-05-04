import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { ProxySubmitTransactionResultFromRest } from '../../../src/palette/rest.ts';

describe('ProxySubmitTransactionResult unit variant encoding', () => {
  it('encodes IncompleteVerifierSigs as { Key: [] } not bare string', () => {
    const encoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)({
      type: 'IncompleteVerifierSigs',
    });
    expect(encoded).toEqual({ IncompleteVerifierSigs: [] });
  });

  it('encodes IncompleteMultiSig as { Key: [] } not bare string', () => {
    const encoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)({
      type: 'IncompleteMultiSig',
    });
    expect(encoded).toEqual({ IncompleteMultiSig: [] });
  });

  it('round-trips IncompleteVerifierSigs through { Key: [] } form', () => {
    const decoded = Schema.decodeUnknownSync(ProxySubmitTransactionResultFromRest)({
      IncompleteVerifierSigs: [],
    });
    expect(decoded).toEqual({ type: 'IncompleteVerifierSigs' });
    const reencoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)(decoded);
    expect(reencoded).toEqual({ IncompleteVerifierSigs: [] });
  });

  it('round-trips IncompleteMultiSig through { Key: [] } form', () => {
    const decoded = Schema.decodeUnknownSync(ProxySubmitTransactionResultFromRest)({
      IncompleteMultiSig: [],
    });
    expect(decoded).toEqual({ type: 'IncompleteMultiSig' });
    const reencoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)(decoded);
    expect(reencoded).toEqual({ IncompleteMultiSig: [] });
  });
});
