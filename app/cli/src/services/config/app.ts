import { Context, Layer, Schema } from "effect";
import appManifest from "../../config/app.json" with { type: "json" };
import networksRaw from "../../config/networks.json" with { type: "json" };
import {
  type BundledNetworks,
  BundledNetworksSchema,
  type NetworkConfig,
} from "../../schemas/networks.js";

const bundledNetworks: BundledNetworks = Schema.decodeUnknownSync(
  BundledNetworksSchema,
)(networksRaw);

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
