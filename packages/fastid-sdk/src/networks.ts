export type IdNetwork = "fast:mainnet" | "fast:testnet";

export interface IdNetworkConfig {
  networkId: IdNetwork;
  idOrigin: string;
  proxyUrl: string;
}

const NETWORKS: Record<IdNetwork, IdNetworkConfig> = {
  "fast:mainnet": {
    networkId: "fast:mainnet",
    idOrigin: "https://id.fast.xyz",
    proxyUrl: "https://api.fast.xyz/proxy",
  },
  "fast:testnet": {
    networkId: "fast:testnet",
    idOrigin: "https://testnet.id.fast.xyz",
    proxyUrl: "https://testnet.api.fast.xyz/proxy",
  },
};

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function networkFor(networkId: string): IdNetworkConfig {
  if (networkId !== "fast:mainnet" && networkId !== "fast:testnet") {
    throw new Error(`Unknown network ${networkId}`);
  }

  const configured = NETWORKS[networkId];
  const allowTestOverrides = networkId === "fast:testnet";
  return {
    networkId,
    idOrigin: allowTestOverrides && process.env.ID_SDK_ORIGIN
      ? withoutTrailingSlash(process.env.ID_SDK_ORIGIN)
      : configured.idOrigin,
    proxyUrl: allowTestOverrides && process.env.ID_SDK_PROXY
      ? withoutTrailingSlash(process.env.ID_SDK_PROXY)
      : configured.proxyUrl,
  };
}
