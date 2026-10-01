import { HttpError, IdReader, InvalidReadResponseError, isCanonicalName } from '@fastxyz/fastid-sdk';
import { bech32m } from 'bech32';
import { Context, Effect, Layer } from 'effect';
import { FastIdResolutionError, InvalidAddressError } from '../../errors/index.js';

/** Fast networks that have a Fast ID registry. */
export type FastIdNetwork = 'fast:mainnet' | 'fast:testnet';

export interface ResolvedFastId {
  /** Canonical (lowercase) Fast ID name, e.g. `alice.smith`. */
  readonly name: string;
  /** The `fast1…` address the name is bound to on that network. */
  readonly address: string;
}

export interface FastIdResolverShape {
  readonly resolve: (name: string, network: FastIdNetwork) => Effect.Effect<ResolvedFastId, InvalidAddressError | FastIdResolutionError>;
}

export class FastIdResolver extends Context.Tag('FastIdResolver')<FastIdResolver, FastIdResolverShape>() {}

const RESOLVE_TIMEOUT_MS = 10_000;

/**
 * Normalize user input to a canonical Fast ID name, or return `undefined` when
 * the input is not shaped like one (two lowercase labels, e.g. `alice.smith`).
 */
export const asFastIdName = (input: string): string | undefined => {
  const value = input.trim().toLowerCase();
  return isCanonicalName(value) ? value : undefined;
};

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const isFastAddressSyntax = (input: string): boolean => {
  try {
    const decoded = bech32m.decode(input);
    return decoded.prefix === 'fast' && bech32m.fromWords(decoded.words).length === 32;
  } catch {
    return false;
  }
};

/**
 * Decide whether a `send` recipient is a Fast ID name to resolve.
 *
 * Returns the canonical name, or `undefined` when the input is a well-formed
 * `fast1…` / `0x…` address or is neither form. The decision uses the full
 * syntax of each form rather than its prefix, so valid names that happen to
 * start like an address (`fast1alice.smith`, `0xabc.def`) are still names.
 * The two forms cannot overlap: names always contain a dot and addresses never do.
 */
export const fastIdRecipient = (input: string): string | undefined => {
  if (EVM_ADDRESS.test(input) || isFastAddressSyntax(input)) return undefined;
  return asFastIdName(input);
};

const withTimeout: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });

export const FastIdResolverLive = Layer.succeed(FastIdResolver, {
  resolve: (name, network) =>
    Effect.tryPromise({
      try: () => new IdReader({ network, fetchImpl: withTimeout }).resolve(name),
      catch: (cause) => {
        if (cause instanceof HttpError && cause.status === 404) {
          return new InvalidAddressError({
            message: `Fast ID "${name}" is not registered on ${network}. Check the spelling or ask for a fast1… address.`,
          });
        }
        if (cause instanceof InvalidReadResponseError) {
          return new FastIdResolutionError({
            fastId: name,
            reason: 'the registry returned a response that does not match this name and network',
            cause,
          });
        }
        return new FastIdResolutionError({
          fastId: name,
          reason: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      },
    }).pipe(Effect.map((id) => ({ name, address: id.address }))),
});
