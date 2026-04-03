export interface NetworkConfig {
  readonly rpcUrl: string
  readonly explorerUrl: string
  readonly networkId: string
}

export const bundledNetworks: Record<string, NetworkConfig> = {
  testnet: {
    rpcUrl: "https://testnet.rpc.fast.xyz",
    explorerUrl: "https://testnet.explorer.fast.xyz",
    networkId: "fast:testnet",
  },
  mainnet: {
    rpcUrl: "https://rpc.fast.xyz",
    explorerUrl: "https://explorer.fast.xyz",
    networkId: "fast:mainnet",
  },
}

export const BUNDLED_NETWORK_NAMES = Object.keys(bundledNetworks)

export const isBundledNetwork = (name: string): boolean =>
  name in bundledNetworks
