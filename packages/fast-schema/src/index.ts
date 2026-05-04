export * from './base/index.ts';
export * as bcsSchema from './base/bcs-layout.ts';
export * from './errors/index.ts';
export * from './composite/index.ts';
export * from './interface/index.ts';
export * from './palette/index.ts';
export * from './util/index.ts';

// New exports for the canonical-LatestTransaction refactor:
export {
  OperationRelease20260319,
  OperationRelease20260407,
  Release20260319SupportedOperations,
  Release20260407SupportedOperations,
} from './composite/operations-per-version.ts';

export type {
  Release20260319Operation,
  Release20260407Operation,
} from './composite/operations-per-version.ts';

export { LatestTransaction } from './composite/latest.ts';
export type { Operation } from './composite/latest.ts';

export {
  LatestFromRelease20260319,
  LatestFromRelease20260407,
  LatestFromVersionedTransaction,
  VersionBridges,
} from './composite/latest-bridges.ts';

export type {
  OperationFor,
  SupportedOpTagFor,
} from './composite/latest-bridges.ts';
