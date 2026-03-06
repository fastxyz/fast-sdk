/**
 * rpc.ts — JSON-RPC helper for the Fast chain proxy API
 */

/** JSON serializer that handles Uint8Array and BigInt */
function toJSON(data: unknown): string {
  return JSON.stringify(data, (_k, v) => {
    if (v instanceof Uint8Array) return Array.from(v);
    if (typeof v === 'bigint') return Number(v);
    return v;
  });
}

/** Call a JSON-RPC method on the Fast chain proxy */
export async function rpcCall(
  url: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: toJSON({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const json = (await res.json()) as {
      result?: unknown;
      error?: { message: string; code?: number };
    };
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}
