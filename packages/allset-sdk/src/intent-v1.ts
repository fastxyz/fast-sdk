/**
 * Self-describing AllSet intent claims and transfer-leg tags.
 *
 * Fast signs canonical JSON. Cross-sign deterministically maps the JSON to the
 * unchanged ABI IntentClaim consumed by the bridge contracts.
 */

import { encodeAbiParameters, type Address, type Hex } from 'viem';
import { canonicalJson, type CanonicalValue, type KeyLayout } from './canonical-json.js';
import { fastAddressToBytes32 } from './address.js';
import { encodeIntentClaim } from './claims.js';
import { IntentAction, type Intent } from './intents.js';

export const INTENT_V1_SCHEMA = 'allset/intent/v1' as const;
export const TRANSFER_V1_TAG_PREFIX = 'allset/transfer/v1:' as const;
export const INTENT_V1_MAX_BYTES = 4096;

export type IntentKindV1 = 'withdraw' | 'execute' | 'deposit_back' | 'revoke' | 'batch';

export type IntentV1 =
  | {
      action: 'transfer';
      token: string;
      receiver: string;
      value: bigint;
    }
  | {
      action: 'execute';
      target: string;
      calldata: Hex;
      value: bigint;
    }
  | {
      action: 'deposit_back';
      token: string;
      fastReceiver: string;
      value: bigint;
    }
  | { action: 'revoke'; value: bigint };

export interface IntentDisplayV1 {
  amount: bigint;
  tokenSymbol: string;
  tokenDecimals: number;
}

export interface IntentClaimV1 {
  schema: typeof INTENT_V1_SCHEMA;
  kind: IntentKindV1;
  /** CAIP-2 destination identifier, for example `eip155:5042`. */
  chain: string;
  /** Destination bridge contract address. */
  bridge: string;
  /** Bound Fast TokenTransfer transaction id. */
  transferTx: Hex;
  /** Unsigned Unix seconds in the u64 domain. */
  deadline: bigint;
  intents: IntentV1[];
  /** Advisory display data. It is validated but never mapped into the ABI. */
  display?: IntentDisplayV1;
}

const HEX20 = /^0x[0-9a-f]{40}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const HEX_BYTES = /^0x(?:[0-9a-f]{2})*$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const CHAIN = /^eip155:(?:0|[1-9][0-9]{0,12})$/;
const U64_MAX = 2n ** 64n - 1n;
const U256_MAX = 2n ** 256n - 1n;
const textEncoder = new TextEncoder();

const TOP_LEVEL_ORDER = ['schema', 'kind', 'chain', 'bridge', 'transfer_tx', 'deadline', 'intents', 'display'];

const LAYOUT: KeyLayout = {
  schema: [],
  kind: [],
  chain: [],
  bridge: [],
  transfer_tx: [],
  deadline: [],
  intents: {
    '*': ['action', 'token', 'receiver', 'target', 'calldata', 'fast_receiver', 'value'],
  },
  display: ['amount', 'token_symbol', 'token_decimals'],
};

function lower(value: string): string {
  return value.toLowerCase();
}

function utf8Length(value: string): number {
  return textEncoder.encode(value).length;
}

function requireCanonicalUint(field: string, value: string): bigint {
  if (!UINT.test(value)) {
    throw new Error(`allset/intent/v1: ${field} must be a canonical unsigned decimal`);
  }
  return BigInt(value);
}

function requireU256(field: string, value: bigint): void {
  if (value < 0n || value > U256_MAX) {
    throw new Error(`allset/intent/v1: ${field} out of range`);
  }
}

function requireHex(field: string, value: unknown, pattern: RegExp, description: string): asserts value is string {
  if (typeof value !== 'string' || !pattern.test(lower(value))) {
    throw new Error(`allset/intent/v1: ${field} must be ${description}`);
  }
}

function fastReceiverBytes32(field: string, value: string): Hex {
  try {
    return fastAddressToBytes32(value);
  } catch (error) {
    throw new Error(`allset/intent/v1: ${field}: ${(error as Error).message}`);
  }
}

function derivedKind(intents: IntentV1[]): IntentKindV1 {
  if (intents.length >= 2) return 'batch';
  switch (intents[0]?.action) {
    case 'transfer':
      return 'withdraw';
    case 'execute':
      return 'execute';
    case 'deposit_back':
      return 'deposit_back';
    case 'revoke':
      return 'revoke';
    default:
      throw new Error('allset/intent/v1: intents must not be empty');
  }
}

function validateClaim(claim: IntentClaimV1): void {
  if (claim.schema !== INTENT_V1_SCHEMA) {
    throw new Error('allset/intent/v1: schema is invalid');
  }
  if (!CHAIN.test(claim.chain)) {
    throw new Error('allset/intent/v1: chain must match eip155:<decimal> with at most 13 digits');
  }
  requireHex('bridge', claim.bridge, HEX20, 'a 20-byte hex address');
  requireHex('transfer_tx', claim.transferTx, HEX32, 'a 32-byte hex value');
  if (claim.deadline < 0n || claim.deadline > U64_MAX) {
    throw new Error('allset/intent/v1: deadline out of range for u64');
  }
  if (!Array.isArray(claim.intents) || claim.intents.length === 0) {
    throw new Error('allset/intent/v1: intents must not be empty');
  }

  claim.intents.forEach((intent, index) => {
    const field = (name: string): string => `intents[${index}].${name}`;
    requireU256(field('value'), intent.value);

    switch (intent.action) {
      case 'transfer':
        requireHex(field('token'), intent.token, HEX20, 'a 20-byte hex address');
        requireHex(field('receiver'), intent.receiver, HEX20, 'a 20-byte hex address');
        break;
      case 'execute':
        requireHex(field('target'), intent.target, HEX20, 'a 20-byte hex address');
        requireHex(field('calldata'), intent.calldata, HEX_BYTES, 'even-length bytes hex');
        break;
      case 'deposit_back':
        requireHex(field('token'), intent.token, HEX20, 'a 20-byte hex address');
        fastReceiverBytes32(field('fast_receiver'), intent.fastReceiver);
        break;
      case 'revoke':
        if (intent.value !== 0n) {
          throw new Error(`allset/intent/v1: ${field('value')} must be 0 for revoke`);
        }
        break;
      default:
        throw new Error(`allset/intent/v1: ${field('action')} is not supported`);
    }
  });

  const expectedKind = derivedKind(claim.intents);
  if (claim.kind !== expectedKind) {
    throw new Error(`allset/intent/v1: kind "${claim.kind}" does not describe intents; expected "${expectedKind}"`);
  }

  if (claim.display !== undefined) {
    requireU256('display.amount', claim.display.amount);
    if (!Number.isInteger(claim.display.tokenDecimals) || claim.display.tokenDecimals < 0 || claim.display.tokenDecimals > 99) {
      throw new Error('allset/intent/v1: display.token_decimals must be between 0 and 99');
    }
    if (claim.display.tokenSymbol.length === 0 || utf8Length(claim.display.tokenSymbol) > 16) {
      throw new Error('allset/intent/v1: display.token_symbol must be 1..16 UTF-8 bytes');
    }
  }
}

function intentToWire(intent: IntentV1): CanonicalValue {
  switch (intent.action) {
    case 'transfer':
      return {
        action: intent.action,
        token: lower(intent.token),
        receiver: lower(intent.receiver),
        value: intent.value.toString(),
      };
    case 'execute':
      return {
        action: intent.action,
        target: lower(intent.target),
        calldata: lower(intent.calldata),
        value: intent.value.toString(),
      };
    case 'deposit_back':
      return {
        action: intent.action,
        token: lower(intent.token),
        fast_receiver: intent.fastReceiver,
        value: intent.value.toString(),
      };
    case 'revoke':
      return { action: intent.action, value: '0' };
  }
}

export function encodeIntentClaimV1(claim: IntentClaimV1): Uint8Array {
  validateClaim(claim);

  const wire: Record<string, CanonicalValue | undefined> = {
    schema: claim.schema,
    kind: claim.kind,
    chain: claim.chain,
    bridge: lower(claim.bridge),
    transfer_tx: lower(claim.transferTx),
    deadline: claim.deadline.toString(),
    intents: claim.intents.map(intentToWire),
    display: claim.display
      ? {
          amount: claim.display.amount.toString(),
          token_symbol: claim.display.tokenSymbol,
          token_decimals: claim.display.tokenDecimals.toString(),
        }
      : undefined,
  };
  const bytes = canonicalJson(wire, TOP_LEVEL_ORDER, LAYOUT);
  if (bytes.length > INTENT_V1_MAX_BYTES) {
    throw new Error(`allset/intent/v1: document exceeds ${INTENT_V1_MAX_BYTES} bytes`);
  }
  return bytes;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`allset/intent/v1: ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw new Error(`allset/intent/v1: unknown key ${field}.${unknown}`);
  }
}

function requireString(value: Record<string, unknown>, key: string, path = key): string {
  if (typeof value[key] !== 'string') {
    throw new Error(`allset/intent/v1: ${path} must be a string`);
  }
  return value[key];
}

function decodeWireIntent(value: unknown, index: number): IntentV1 {
  const path = `intents[${index}]`;
  const object = requireRecord(value, path);
  const action = requireString(object, 'action', `${path}.action`);
  const uint = (key: string): bigint => requireCanonicalUint(`${path}.${key}`, requireString(object, key, `${path}.${key}`));

  switch (action) {
    case 'transfer':
      rejectUnknownKeys(object, ['action', 'token', 'receiver', 'value'], path);
      return {
        action,
        token: requireString(object, 'token', `${path}.token`),
        receiver: requireString(object, 'receiver', `${path}.receiver`),
        value: uint('value'),
      };
    case 'execute':
      rejectUnknownKeys(object, ['action', 'target', 'calldata', 'value'], path);
      return {
        action,
        target: requireString(object, 'target', `${path}.target`),
        calldata: requireString(object, 'calldata', `${path}.calldata`) as Hex,
        value: uint('value'),
      };
    case 'deposit_back':
      rejectUnknownKeys(object, ['action', 'token', 'fast_receiver', 'value'], path);
      return {
        action,
        token: requireString(object, 'token', `${path}.token`),
        fastReceiver: requireString(object, 'fast_receiver', `${path}.fast_receiver`),
        value: uint('value'),
      };
    case 'revoke':
      rejectUnknownKeys(object, ['action', 'value'], path);
      return { action, value: uint('value') };
    default:
      throw new Error(`allset/intent/v1: ${path}.action is unknown`);
  }
}

export function decodeIntentClaimV1(bytes: Uint8Array): IntentClaimV1 {
  if (bytes.length > INTENT_V1_MAX_BYTES) {
    throw new Error(`allset/intent/v1: document exceeds ${INTENT_V1_MAX_BYTES} bytes`);
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('allset/intent/v1: invalid UTF-8');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('allset/intent/v1: invalid JSON');
  }
  const object = requireRecord(raw, 'root');
  if (object.schema !== INTENT_V1_SCHEMA) {
    throw new Error('allset/intent/v1: unrelated schema');
  }
  rejectUnknownKeys(object, TOP_LEVEL_ORDER, 'root');

  if (!Array.isArray(object.intents)) {
    throw new Error('allset/intent/v1: intents must be an array');
  }
  const intents = object.intents.map(decodeWireIntent);
  const claim: IntentClaimV1 = {
    schema: INTENT_V1_SCHEMA,
    kind: requireString(object, 'kind') as IntentKindV1,
    chain: requireString(object, 'chain'),
    bridge: requireString(object, 'bridge'),
    transferTx: requireString(object, 'transfer_tx') as Hex,
    deadline: requireCanonicalUint('deadline', requireString(object, 'deadline')),
    intents,
  };

  if (object.display !== undefined) {
    const display = requireRecord(object.display, 'display');
    rejectUnknownKeys(display, ['amount', 'token_symbol', 'token_decimals'], 'display');
    const tokenDecimals = requireCanonicalUint('display.token_decimals', requireString(display, 'token_decimals', 'display.token_decimals'));
    claim.display = {
      amount: requireCanonicalUint('display.amount', requireString(display, 'amount', 'display.amount')),
      tokenSymbol: requireString(display, 'token_symbol', 'display.token_symbol'),
      tokenDecimals: Number(tokenDecimals),
    };
  }

  validateClaim(claim);
  const canonical = encodeIntentClaimV1(claim);
  if (canonical.length !== bytes.length || canonical.some((byte, index) => byte !== bytes[index])) {
    throw new Error('allset/intent/v1: document is not canonical');
  }
  return claim;
}

/** Map one v1 intent to the legacy ABI action without normalising its value. */
export function intentV1ToLegacy(intent: IntentV1): Intent {
  switch (intent.action) {
    case 'transfer':
      return {
        action: IntentAction.DynamicTransfer,
        payload: encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [intent.token as Address, intent.receiver as Address]),
        value: intent.value,
      };
    case 'execute':
      return {
        action: IntentAction.Execute,
        payload: encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [intent.target as Address, intent.calldata]),
        value: intent.value,
      };
    case 'deposit_back':
      return {
        action: IntentAction.DynamicDeposit,
        payload: encodeAbiParameters(
          [{ type: 'address' }, { type: 'bytes32' }],
          [intent.token as Address, fastReceiverBytes32('fast_receiver', intent.fastReceiver)],
        ),
        value: intent.value,
      };
    case 'revoke':
      return {
        action: IntentAction.Revoke,
        payload: '0x',
        value: intent.value,
      };
  }
}

export function intentClaimV1ToAbi(claim: IntentClaimV1): Hex {
  validateClaim(claim);
  return encodeIntentClaim({
    transferFastTxId: claim.transferTx,
    deadline: claim.deadline,
    intents: claim.intents.map(intentV1ToLegacy),
  });
}

export function transferUserDataTag(chainId: number): Uint8Array {
  if (!Number.isInteger(chainId) || chainId < 0 || chainId > 9_999_999_999_999) {
    throw new Error('allset/transfer/v1: chain id must be a non-negative integer of at most 13 digits');
  }
  const bytes = textEncoder.encode(`${TRANSFER_V1_TAG_PREFIX}${chainId}`);
  const output = new Uint8Array(32);
  output.set(bytes);
  return output;
}

export function readTransferUserDataTag(userData: Uint8Array | null): number | null {
  if (userData === null || userData.length !== 32) return null;
  const text = new TextDecoder().decode(userData).replace(/\0+$/, '');
  if (!text.startsWith(TRANSFER_V1_TAG_PREFIX)) return null;
  const value = text.slice(TRANSFER_V1_TAG_PREFIX.length);
  if (!UINT.test(value) || value.length > 13) return null;
  return Number(value);
}
