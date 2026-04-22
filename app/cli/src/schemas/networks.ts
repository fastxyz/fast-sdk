import { Schema } from "effect";
import { NetworkId } from "@fastxyz/schema";

export const AllSetChainTokenSchema = Schema.Struct({
  evmAddress: Schema.String,
  fastTokenId: Schema.String,
  decimals: Schema.Number,
});
export type AllSetChainTokenConfig = typeof AllSetChainTokenSchema.Type;

export const AllSetChainSchema = Schema.Struct({
  chainId: Schema.Number,
  bridgeContract: Schema.String,
  fastBridgeAddress: Schema.String,
  relayerUrl: Schema.String,
  evmRpcUrl: Schema.String,
  evmExplorerUrl: Schema.String,
  tokens: Schema.Record({ key: Schema.String, value: AllSetChainTokenSchema }),
});
export type AllSetChainConfig = typeof AllSetChainSchema.Type;

export const AllSetConfigSchema = Schema.Struct({
  crossSignUrl: Schema.String,
  portalApiUrl: Schema.String,
  chains: Schema.Record({ key: Schema.String, value: AllSetChainSchema }),
});
export type AllSetConfig = typeof AllSetConfigSchema.Type;

export const NetworkConfigSchema = Schema.Struct({
  url: Schema.String,
  explorerUrl: Schema.String,
  networkId: NetworkId,
  allSet: Schema.optional(AllSetConfigSchema),
});
export type NetworkConfig = typeof NetworkConfigSchema.Type;

export const BundledNetworksSchema = Schema.Record({
  key: Schema.String,
  value: NetworkConfigSchema,
});
export type BundledNetworks = typeof BundledNetworksSchema.Type;

/** Schema for entries in the bundled networks.json file.
 * Only contains allSet config — url/explorerUrl/networkId come from @fastxyz/sdk constants. */
export const BundledNetworkEntrySchema = Schema.Struct({
  allSet: Schema.optional(AllSetConfigSchema),
});
export type BundledNetworkEntry = typeof BundledNetworkEntrySchema.Type;

export const BundledNetworkEntriesSchema = Schema.Record({
  key: Schema.String,
  value: BundledNetworkEntrySchema,
});
export type BundledNetworkEntries = typeof BundledNetworkEntriesSchema.Type;
