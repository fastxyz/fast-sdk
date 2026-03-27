import { Address } from '../address';
import { hexToBytes } from '../bytes';
import { FastError } from '../errors';
import type { BytesLike } from '../types';
import type {
  FastSignatureOrMultiSig,
  FastSignatureOrMultiSigInput,
} from './types';

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function toNumberArray(value: BytesLike): number[] {
  return Array.from(value instanceof Uint8Array ? value : new Uint8Array(value));
}

export function isBytesLikeValue(value: unknown): value is BytesLike {
  return value instanceof Uint8Array || Array.isArray(value) || ArrayBuffer.isView(value);
}

export function hexToFixed32(value: string, fieldName: string): number[] {
  const bytes = hexToBytes(value);
  if (bytes.length !== 32) {
    throw new FastError('INVALID_PARAMS', `${fieldName} must be exactly 32 bytes`, {
      note: `Pass a 0x-prefixed 32-byte hex string for ${fieldName}.`,
    });
  }
  return Array.from(bytes);
}

export function normalizeBytes32(value: string | BytesLike, fieldName: string): number[] {
  if (typeof value === 'string') {
    return hexToFixed32(value, fieldName);
  }
  const bytes = toNumberArray(value);
  if (bytes.length !== 32) {
    throw new FastError('INVALID_PARAMS', `${fieldName} must be exactly 32 bytes`, {
      note: `Pass a 32-byte byte sequence or hex string for ${fieldName}.`,
    });
  }
  return bytes;
}

export function normalizeAddress(value: string | BytesLike, fieldName: string): number[] {
  if (typeof value !== 'string') {
    return normalizeBytes32(value, fieldName);
  }
  if (value.startsWith('fast')) {
    try {
      return Array.from(Address.fromString(value).bytes);
    } catch {
      throw new FastError('INVALID_ADDRESS', `Invalid Fast address: "${value}"`, {
        note: 'Pass a valid fast... bech32m address or a 32-byte value.',
      });
    }
  }
  return hexToFixed32(value, fieldName);
}

export function normalizeBytes32Array(
  values: Array<string | BytesLike> | null | undefined,
  fieldName: string,
): number[][] | null {
  if (values === undefined || values === null) {
    return null;
  }
  return values.map((value) => normalizeBytes32(value, fieldName));
}

export function normalizeSignatureOrMultiSig(
  signature: FastSignatureOrMultiSigInput,
): FastSignatureOrMultiSig {
  if (isBytesLikeValue(signature)) {
    return { Signature: toNumberArray(signature) };
  }

  if ('Signature' in signature) {
    return { Signature: toNumberArray(signature.Signature) };
  }

  if ('MultiSig' in signature) {
    return {
      MultiSig: {
        config: signature.MultiSig.config,
        signatures: signature.MultiSig.signatures.map(([pubkey, sig]) => [
          normalizeBytes32(pubkey, 'multisig.pubkey'),
          toNumberArray(sig),
        ]),
      },
    };
  }

  throw new FastError('INVALID_PARAMS', 'Invalid signature payload', {
    note: 'Pass a Signature or MultiSig value matching the proxy RPC schema.',
  });
}
