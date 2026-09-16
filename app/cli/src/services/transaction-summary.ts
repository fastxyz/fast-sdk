import type { TransactionEnvelope, VersionedTransaction } from '@fastxyz/schema';
import { toFastAddress, toHex } from '@fastxyz/sdk';

type Operation = {
  readonly type: string;
  readonly value?: unknown;
};

const normalize = (value: unknown, key = ''): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) {
    const hex = toHex(value);
    if (value.length === 32 && /(?:address|admin|recipient|signer|evaluator|provider|mint)/i.test(key)) {
      return { address: toFastAddress(value), hex };
    }
    return hex;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, key));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([childKey, child]) => [childKey, normalize(child, childKey)]),
    );
  }
  return value;
};

export const transactionOperations = (transaction: VersionedTransaction): readonly Operation[] => {
  const value = transaction.value as {
    readonly claims?: readonly Operation[];
    readonly claim?: Operation;
  };
  if (Array.isArray(value.claims)) return value.claims;
  if (!value.claim) return [];
  return value.claim.type === 'Batch' && Array.isArray(value.claim.value) ? (value.claim.value as readonly Operation[]) : [value.claim];
};

/** Deterministic, lossless summary shown before a multisig signature is made. */
export const summarizeTransaction = (envelope: TransactionEnvelope): readonly string[] => {
  const transaction = envelope.transaction;
  const value = transaction.value as Record<string, unknown> & {
    readonly sender: Uint8Array;
    readonly nonce: bigint;
    readonly networkId?: string;
    readonly timestampNanos?: bigint;
    readonly archival?: boolean;
    readonly feeToken?: Uint8Array | null;
  };
  const operations = transactionOperations(transaction);
  const lines = [
    `  Version:    ${transaction.type}`,
    `  Network:    ${value.networkId ?? '<missing>'}`,
    `  Sender:     ${toFastAddress(value.sender)} (${toHex(value.sender)})`,
    `  Nonce:      ${value.nonce.toString()}`,
    `  Timestamp:  ${value.timestampNanos?.toString() ?? '<missing>'} ns`,
    `  Archival:   ${String(value.archival ?? false)}`,
    `  Fee token:  ${value.feeToken ? toHex(value.feeToken) : 'native/default'}`,
    `  Operations: ${operations.length}`,
  ];

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index]!;
    lines.push(`  [${index + 1}] ${operation.type}`);
    lines.push(`      ${JSON.stringify(normalize(operation.value ?? null), null, 2).replace(/\n/g, '\n      ')}`);
  }
  return lines;
};
