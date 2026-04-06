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

export class CustomNetworkConfig extends Schema.Class<CustomNetworkConfig>(
  "CustomNetworkConfig",
)({
  fast: Schema.Struct({
    rpcUrl: Schema.String,
    explorerUrl: Schema.String,
  }),
  allSet: Schema.optionalWith(AllSetConfigSchema, { as: "Option" }),
}) {}
