import { Context, Layer, Schema } from "effect";
import appManifest from "../../config/app.json" with { type: "json" };
import networksRaw from "../../config/networks.json" with { type: "json" };
import {
  BundledNetworksSchema,
  type BundledNetworks,
  type NetworkConfig,
} from "../../schemas/networks.js";

// ---------------------------------------------------------------------------
// Module-level load and validation — runs once at import time.
// ---------------------------------------------------------------------------

const _bundledNetworks: BundledNetworks = Schema.decodeUnknownSync(
  BundledNetworksSchema,
)(networksRaw);

// ---------------------------------------------------------------------------
// Pure functions — no Effect, no service. Callable before any layer exists.
// ---------------------------------------------------------------------------

export const getAppName = (): string => appManifest.name;

export const getVersion = (): string => appManifest.version;

export const getBundledNetworks = (): BundledNetworks => _bundledNetworks;

export const isBundledNetwork = (name: string): boolean =>
  Object.hasOwn(_bundledNetworks, name);

export const getBundledNetwork = (name: string): NetworkConfig | undefined =>
  _bundledNetworks[name];

// ---------------------------------------------------------------------------
// Effect service — delegates to the pure functions above.
// ---------------------------------------------------------------------------

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
