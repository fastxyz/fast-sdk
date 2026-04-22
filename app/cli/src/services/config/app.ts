import { Context, Layer, Schema } from "effect";
import { mainnet, testnet } from "@fastxyz/sdk/networks";
import type { FastNetwork } from "@fastxyz/sdk";
import appManifest from "../../config/app.json" with { type: "json" };
import networksRaw from "../../config/networks.json" with { type: "json" };
import {
  type BundledNetworkEntries,
  BundledNetworkEntriesSchema,
  type BundledNetworks,
  type NetworkConfig,
} from "../../schemas/networks.js";

const SDK_NETWORKS: Record<string, FastNetwork> = { mainnet, testnet };

const bundledEntries: BundledNetworkEntries = Schema.decodeUnknownSync(
  BundledNetworkEntriesSchema,
)(networksRaw);

const bundledNetworks: BundledNetworks = Object.fromEntries(
  Object.entries(bundledEntries).map(([name, entry]) => {
    const sdkNet = SDK_NETWORKS[name];
    if (!sdkNet) throw new Error(`No SDK network constant for bundled network: "${name}"`);
    const config: NetworkConfig = {
      url: sdkNet.url,
      explorerUrl: sdkNet.explorerUrl ?? "",
      networkId: sdkNet.networkId,
      ...entry,
    };
    return [name, config];
  }),
);

export const getAppName = (): string => appManifest.name;
export const getVersion = (): string => appManifest.version;
export const getBundledNetworks = (): BundledNetworks => bundledNetworks;
export const isBundledNetwork = (name: string): boolean =>
  Object.hasOwn(bundledNetworks, name);
export const getBundledNetwork = (name: string): NetworkConfig | undefined =>
  bundledNetworks[name];

export interface AppConfigShape {
  readonly name: string;
  readonly version: string;
  readonly bundledNetworks: BundledNetworks;
  readonly isBundledNetwork: (name: string) => boolean;
  readonly getBundledNetwork: (name: string) => NetworkConfig | undefined;
}

export class AppConfig extends Context.Tag("AppConfig")<
  AppConfig,
  AppConfigShape
>() {}

export const AppConfigLive = Layer.sync(AppConfig, () => ({
  name: getAppName(),
  version: getVersion(),
  bundledNetworks: getBundledNetworks(),
  isBundledNetwork,
  getBundledNetwork,
}));
