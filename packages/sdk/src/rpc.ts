/**
 * rpc.ts — JSON-RPC helper for the Fast network proxy API
 */

/**
 * Parse JSON text with BigInt support for large integers.
 * Standard JSON.parse loses precision for integers > MAX_SAFE_INTEGER.
 * This parser detects large integer literals and converts them to BigInt.
 */
function parseJsonWithBigInt(text: string): unknown {
  // Replace large integer literals (not in strings) with quoted versions
  // Pattern: match numbers that are too large for safe integer representation
  // We look for: standalone integers (not decimals) that exceed 15 digits
  const processed = text.replace(
    /([:\[,\s])(-?\d{16,})([,\]\}\s]|$)/g,
    (_, prefix, num, suffix) => `${prefix}"${num}"${suffix}`
  );
  
  return JSON.parse(processed, (key, value) => {
    // Convert quoted large integers back to BigInt
    if (typeof value === 'string' && /^-?\d{16,}$/.test(value)) {
      return BigInt(value);
    }
    return value;
  });
}

function serializeJsonValue(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return serializeJsonValue(Array.from(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJsonValue(item) ?? 'null').join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .flatMap(([key, entryValue]) => {
        const serialized = serializeJsonValue(entryValue);
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(',')}}`;
  }
  return undefined;
}

/** JSON serializer that preserves Uint8Array and bigint values exactly */
function toJSON(data: unknown): string {
  const serialized = serializeJsonValue(data);
  if (serialized === undefined) {
    throw new TypeError('RPC params must be JSON-serializable');
  }
  return serialized;
}

/** Call a JSON-RPC method on the Fast network proxy */
export async function rpcCall(
  url: string,
  method: string,
  params: unknown,
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
    // Use custom JSON parser to preserve BigInt precision for large integers
    const text = await res.text();
    const json = parseJsonWithBigInt(text) as {
      result?: unknown;
      error?: { message: string; code?: number };
    };
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}
