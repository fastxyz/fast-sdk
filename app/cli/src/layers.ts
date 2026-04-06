import { NodeContext } from "@effect/platform-node";
import { Layer, type Option } from "effect";
import { AccountStoreLive } from "./services/account/account-store.js";
import { makeConfigLayer } from "./services/cli-config.js";
import { FastRpcLive } from "./services/fast-rpc.js";
import { HistoryStoreLive } from "./services/history-store.js";
import { KeystoreV3Live } from "./services/keystore-v3.js";
import { NetworkConfigLive } from "./services/network-config.js";
import { OutputLive } from "./services/output.js";
import { PasswordLive } from "./services/password.js";

interface ParsedOptions {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export const makeAppLayer = (parsed: ParsedOptions) => {
  const cliConfigLayer = makeConfigLayer({
    json: parsed.json,
    debug: parsed.debug,
    nonInteractive: parsed.nonInteractive || parsed.json,
    network: parsed.network,
    account: parsed.account,
    password: parsed.password,
  });

  // Foundation: platform services + config
  const foundation = Layer.mergeAll(
    NodeContext.layer,
    cliConfigLayer,
    KeystoreV3Live,
  );

  // Services that depend only on foundation
  const tier1 = Layer.mergeAll(
    OutputLive,
    PasswordLive,
    NetworkConfigLive,
    HistoryStoreLive,
  ).pipe(Layer.provide(foundation));

  // Services that depend on tier1
  const tier2 = Layer.mergeAll(
    FastRpcLive, // needs NetworkConfigService + CliConfig
    AccountStoreLive, // needs KeystoreV3 + FileSystem
  ).pipe(Layer.provide(Layer.merge(foundation, tier1)));

  return Layer.mergeAll(foundation, tier1, tier2);
};
