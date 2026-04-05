import { Data } from 'effect';

/** File I/O, lock, or persistence failure. */
export class StorageError extends Data.TaggedError('StorageError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
