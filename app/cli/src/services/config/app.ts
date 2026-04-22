import { Context, Layer } from "effect";
import appManifest from "../../config/app.json" with { type: "json" };
import { bundledNetworks } from "../../config/networks.js";
import type { BundledNetworks, NetworkConfig } from "../../schemas/networks.js";

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
