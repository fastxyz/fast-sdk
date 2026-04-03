import { Schema } from "effect"

export class NetworksFile extends Schema.Class<NetworksFile>("NetworksFile")({
  default: Schema.String,
  networks: Schema.Array(Schema.String),
}) {}

export class CustomNetworkConfig extends Schema.Class<CustomNetworkConfig>("CustomNetworkConfig")({
  fast: Schema.Struct({
    rpcUrl: Schema.String,
    explorerUrl: Schema.String,
  }),
}) {}
