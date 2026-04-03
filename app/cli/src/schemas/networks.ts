import { Schema } from "effect"

export class NetworksFile extends Schema.Class<NetworksFile>("NetworksFile")({
  default: Schema.String,
  networks: Schema.Array(Schema.String),
}) {}

const AllsetChainTokenSchema = Schema.Struct({
  evmAddress: Schema.String,
  fastTokenId: Schema.String,
  decimals: Schema.Number,
})

const AllsetChainSchema = Schema.Struct({
  chainId: Schema.Number,
  bridgeContract: Schema.String,
  fastBridgeAddress: Schema.String,
  relayerUrl: Schema.String,
  evmRpcUrl: Schema.String,
  tokens: Schema.Record({ key: Schema.String, value: AllsetChainTokenSchema }),
})

const AllsetConfigSchema = Schema.Struct({
  crossSignUrl: Schema.String,
  chains: Schema.Record({ key: Schema.String, value: AllsetChainSchema }),
})

export class CustomNetworkConfig extends Schema.Class<CustomNetworkConfig>("CustomNetworkConfig")({
  fast: Schema.Struct({
    rpcUrl: Schema.String,
    explorerUrl: Schema.String,
  }),
  allset: Schema.optionalWith(AllsetConfigSchema, { as: "Option" }),
}) {}
