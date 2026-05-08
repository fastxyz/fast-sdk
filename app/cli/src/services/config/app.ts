import { Context, Layer } from "effect";
import pkg from "../../../package.json" with { type: "json" };
import { bundledNetworks } from "../../config/networks.js";
import type { BundledNetworks, NetworkConfig } from "../../schemas/networks.js";

// Binary name ("fast") is the first key of the `bin` field in package.json
const appName = (Object.keys(pkg.bin) as string[])[0] ?? "fast";

export const getAppName = (): string => appName;
export const getVersion = (): string => pkg.version;
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
