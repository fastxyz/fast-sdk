import { Data } from 'effect';

/** The explorer indexer API could not be read (timeout, transport error, HTTP error or malformed body). */
export class ExplorerUnavailableError extends Data.TaggedError('ExplorerUnavailableError')<{
  readonly reason: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = 'EXPLORER_UNAVAILABLE' as const;
  get message() {
    return `Could not read network history from the explorer API: ${this.reason}`;
  }
}

/** The active network has no `explorerApiUrl`, so there is no network-backed history for it. */
export class ExplorerNotConfiguredError extends Data.TaggedError('ExplorerNotConfiguredError')<{
  readonly network: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = 'EXPLORER_NOT_CONFIGURED' as const;
  get message() {
    return `Network "${this.network}" has no explorer API configured (explorerApiUrl), so network history is not available on it.`;
  }
}
