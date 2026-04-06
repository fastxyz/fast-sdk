import { Schema } from "effect";

const AllSetChainTokenSchema = Schema.Struct({
  evmAddress: Schema.String,
  fastTokenId: Schema.String,
  decimals: Schema.Number,
});

const AllSetChainSchema = Schema.Struct({
  chainId: Schema.Number,
  bridgeContract: Schema.String,
  fastBridgeAddress: Schema.String,
  relayerUrl: Schema.String,
  evmRpcUrl: Schema.String,
  evmExplorerUrl: Schema.String,
  tokens: Schema.Record({ key: Schema.String, value: AllSetChainTokenSchema }),
});

const AllSetConfigSchema = Schema.Struct({
  crossSignUrl: Schema.String,
  portalApiUrl: Schema.String,
  chains: Schema.Record({ key: Schema.String, value: AllSetChainSchema }),
});

/**
 * Schema for validating network config — matches the NetworkConfig interface
 * in config/bundled.ts. Used for both user-provided configs (network add)
 * and stored configs in the database.
 */
export class NetworkConfigSchema extends Schema.Class<NetworkConfigSchema>(
  "NetworkConfigSchema",
)({
  rpcUrl: Schema.String,
  explorerUrl: Schema.String,
  networkId: Schema.String,
  allSet: Schema.optionalWith(AllSetConfigSchema, { as: "Option" }),
}) {}
