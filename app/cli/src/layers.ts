import { Layer, type Option } from "effect";
import { FastRpcLive } from "./services/api/fast.js";
import { makeConfigLayer } from "./services/config.js";
import { OutputLive } from "./services/output.js";
import { PromptLive } from "./services/prompt.js";
import { AccountStoreLive } from "./services/storage/account.js";
import { DatabaseLive } from "./services/storage/database.js";
import { HistoryStoreLive } from "./services/storage/history.js";
import { NetworkConfigLive } from "./services/storage/network.js";

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

  // Foundation: database + config
  const foundation = Layer.mergeAll(DatabaseLive, cliConfigLayer);

  // Services that depend only on foundation
  const tier1 = Layer.mergeAll(
    OutputLive,
    PromptLive,
    NetworkConfigLive,
    HistoryStoreLive,
    AccountStoreLive,
  ).pipe(Layer.provide(foundation));

  // Services that depend on tier1
  const tier2 = Layer.mergeAll(FastRpcLive).pipe(
    Layer.provide(Layer.merge(foundation, tier1)),
  );

  return Layer.mergeAll(foundation, tier1, tier2);
};
