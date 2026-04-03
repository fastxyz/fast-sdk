import { Data } from "effect";

/** RPC call exceeded the timeout. */
export class RpcTimeoutError extends Data.TaggedError("RpcTimeoutError")<{
  readonly method: string;
  readonly timeoutMs: number;
}> {}

/** JSON-RPC protocol errors (-32700 to -32603). */
export class JsonRpcProtocolError extends Data.TaggedError("JsonRpcProtocolError")<{
  readonly code: number;
  readonly message: string;
}> {}

/** Fallback for unknown or unparseable RPC errors. */
export class RpcError extends Data.TaggedError("RpcError")<{
  readonly code: number;
  readonly message: string;
  readonly data: unknown;
}> {}
