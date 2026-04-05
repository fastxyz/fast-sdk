import { Data } from 'effect';

export class InvalidUsageError extends Data.TaggedError('InvalidUsageError')<{
  readonly message: string;
}> {}

export class NotImplementedError extends Data.TaggedError('NotImplementedError')<{
  readonly message: string;
}> {}

export class UserCancelledError extends Data.TaggedError('UserCancelledError')<{}> {
  get message() {
    return 'Operation cancelled by user';
  }
}
