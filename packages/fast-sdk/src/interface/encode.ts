import type { BcsType } from '@mysten/bcs';
import * as core from '../core/crypto/bcs';
import { run } from '../core/run';

/** BCS serialize a typed value to bytes. */
export const encode = <T>(schema: BcsType<T>, message: T): Promise<Uint8Array> => run(core.encode(schema, message));

/** BCS serialize with a `SchemaName::` domain prefix. Used for signing. */
export const domainEncode = <T>(schema: BcsType<T>, message: T): Promise<Uint8Array> => run(core.domainEncode(schema, message));

/** BCS serialize + keccak-256 hash. Returns raw bytes. */
export const hash = <T>(schema: BcsType<T>, message: T): Promise<Uint8Array> => run(core.hash(schema, message));

/** BCS serialize + keccak-256 hash. Returns `0x`-prefixed hex string. */
export const hashHex = <T>(schema: BcsType<T>, message: T): Promise<string> => run(core.hashHex(schema, message));

export { getTokenId } from '../core/crypto/bcs';
