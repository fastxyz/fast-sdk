import { Effect, Schema } from 'effect';
import { JSONParse, JSONStringify } from 'json-with-bigint';
import { RpcTimeoutError } from '../error/network';
import { parseRpcError } from './error';

let nextId = 1;

const RpcResponse = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: Schema.Number,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
      data: Schema.optional(Schema.Unknown),
    }),
  ),
});

/** JSON-RPC 2.0 call as an Effect. */
export const rpcCallEffect = (url: string, method: string, params: unknown, timeoutMs = 15_000) =>
  Effect.gen(function* () {
    const id = nextId++;
    const body = JSONStringify({ jsonrpc: '2.0', id, method, params });
    const res = yield* Effect.tryPromise(() =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    );
    const text = yield* Effect.tryPromise(() => res.text());
    const json = yield* Schema.decodeUnknown(RpcResponse)(JSONParse(text));
    if (json.error) {
      return yield* parseRpcError(json.error);
    }
    return json.result;
  }).pipe(
    Effect.timeout(`${timeoutMs} millis`),
    Effect.catchTag('TimeoutException', () => new RpcTimeoutError({ method, timeoutMs })),
  );
