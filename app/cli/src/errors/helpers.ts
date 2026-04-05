import { Effect } from 'effect';
import { StorageError } from './io.js';

/**
 * Pipe operator that maps any error from a file I/O / persistence operation
 * to a `StorageError` with a caller-supplied operation description.
 *
 * Usage:
 *   yield* fs.readFileString(path).pipe(mapToStorageError('read accounts.json'));
 */
export const mapToStorageError = (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, StorageError, R> =>
    effect.pipe(
      Effect.mapError((cause) => new StorageError({ message: `Failed to ${operation}`, cause })),
    );
