import { run } from "../run";
import { rpcCallEffect } from "./rpc";

export interface FastTransport {
  request(
    url: string,
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<unknown>;
}

export class JsonRpcFastTransport implements FastTransport {
  request(
    url: string,
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    return run(rpcCallEffect(url, method, params, timeoutMs));
  }
}
