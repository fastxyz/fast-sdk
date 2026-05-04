/**
 * Transport-tolerant composite schemas.
 *
 * Factory-derived from `TransportPalette`. Use these in code paths where a
 * REST-encoded payload has crossed a JSON-string transport boundary
 * (Chrome extension `port.postMessage` after a `JSON.stringify(bigint→String)`
 * mangling). The schemas have the same encoded shape as their REST
 * counterparts on every byte/hex/decimal field, but additionally accept
 * string-form input on bigint-typed primitives (Nonce, Quorum, etc.).
 *
 * Scope is intentionally narrow — only the schemas the wallet extension
 * decodes are exported. Add more here only when a real consumer needs them.
 */

import { makeTransactionCertificate } from '../composite/envelope.ts';
import {
  makeAccountInfoResponse,
  makeTokenInfoResponse,
} from '../composite/response.ts';
import { TransportPalette } from './definition.ts';

const p = TransportPalette;

export const TransactionCertificateFromTransport = makeTransactionCertificate(p);
export const AccountInfoResponseFromTransport = makeAccountInfoResponse(p);
export const TokenInfoResponseFromTransport = makeTokenInfoResponse(p);

// Domain type aliases — the Type form is identical to REST counterparts;
// these aliases are for ergonomics at consumer call-sites.
export type TransactionCertificateTransport = typeof TransactionCertificateFromTransport.Type;
export type AccountInfoResponseTransport = typeof AccountInfoResponseFromTransport.Type;
export type TokenInfoResponseTransport = typeof TokenInfoResponseFromTransport.Type;
