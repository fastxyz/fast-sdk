import { Schema } from 'effect';

export class HistoryEntry extends Schema.Class<HistoryEntry>('HistoryEntry')({
  hash: Schema.String,
  type: Schema.Literal('transfer'),
  from: Schema.String,
  to: Schema.String,
  amount: Schema.String,
  formatted: Schema.String,
  tokenName: Schema.String,
  tokenId: Schema.String,
  network: Schema.String,
  status: Schema.String,
  timestamp: Schema.String,
  explorerUrl: Schema.NullOr(Schema.String),
  route: Schema.optionalWith(Schema.Literal('fast', 'evm-to-fast', 'fast-to-evm'), {
    default: () => 'fast' as const,
  }),
  chainId: Schema.optionalWith(Schema.NullOr(Schema.Number), { default: () => null }),
}) {}

export const HistoryFile = Schema.Array(HistoryEntry);
