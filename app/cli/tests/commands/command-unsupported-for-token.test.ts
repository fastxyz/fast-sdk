import { describe, expect, it } from "vitest";
import {
  resolveToken,
  tokenIsKnownOnNetwork,
} from "../../src/services/token-resolver.js";
import {
  CommandUnsupportedForTokenError,
  TokenNotFoundError,
} from "../../src/errors/transaction.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";
import { mainnetCfg } from "../fixtures/networks.js";

/**
 * Mirrors the rewrap predicate used in send.ts (and the analogous logic in
 * fund/usdc/crypto.ts). Tests the chain-context branch where a token name
 * fails to resolve: when the name is known on the network but absent from
 * the requested chain, surface CommandUnsupportedForTokenError; on real
 * typos, keep TokenNotFoundError.
 */
function classify(
  argToken: string | undefined,
  network: NetworkConfig,
  chain: string,
  commandLabel: string,
  extraHint = "",
):
  | { kind: "ok"; token: string }
  | { kind: "command-unsupported"; err: CommandUnsupportedForTokenError }
  | { kind: "token-not-found"; err: TokenNotFoundError } {
  const tokenWasDefaulted = argToken === undefined;
  const resolvedName = argToken ?? network.defaultToken?.symbol;
  if (resolvedName === undefined) throw new Error("test setup: no default");
  try {
    resolveToken(resolvedName, network, chain);
    return { kind: "ok", token: resolvedName };
  } catch (e) {
    if (
      e instanceof TokenNotFoundError &&
      (tokenWasDefaulted || tokenIsKnownOnNetwork(network, resolvedName))
    ) {
      const suggestion = tokenWasDefaulted
        ? `${extraHint}Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on ${chain}.`
        : `${extraHint}See 'fast info bridge-tokens' for tokens available on ${chain}.`;
      return {
        kind: "command-unsupported",
        err: new CommandUnsupportedForTokenError({
          command: commandLabel,
          token: resolvedName,
          network: "mainnet",
          suggestion,
        }),
      };
    }
    if (e instanceof TokenNotFoundError) {
      return { kind: "token-not-found", err: e };
    }
    throw e;
  }
}

describe("send --from-chain rewrap", () => {
  it("defaulted fastUSD on arbitrum → CommandUnsupportedForTokenError with 'Pass --token explicitly.'", () => {
    const r = classify(
      undefined,
      mainnetCfg,
      "arbitrum",
      "send --from-chain arbitrum",
    );
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain(
      "send --from-chain arbitrum is not supported for fastUSD on mainnet",
    );
    expect(r.err.message).toContain("Pass --token explicitly.");
  });

  it("explicit --token fastUSD on arbitrum → CommandUnsupportedForTokenError WITHOUT 'Pass --token explicitly.'", () => {
    const r = classify(
      "fastUSD",
      mainnetCfg,
      "arbitrum",
      "send --from-chain arbitrum",
    );
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).not.toContain("Pass --token explicitly.");
  });

  it("typo --token USDD on arbitrum → TokenNotFoundError (no rewrap)", () => {
    const r = classify(
      "USDD",
      mainnetCfg,
      "arbitrum",
      "send --from-chain arbitrum",
    );
    expect(r.kind).toBe("token-not-found");
  });

  it("explicit --token USDC on arbitrum → ok", () => {
    const r = classify(
      "USDC",
      mainnetCfg,
      "arbitrum",
      "send --from-chain arbitrum",
    );
    expect(r.kind).toBe("ok");
  });
});

describe("send --to-chain rewrap", () => {
  it("defaulted fastUSD on arbitrum → CommandUnsupportedForTokenError", () => {
    const r = classify(
      undefined,
      mainnetCfg,
      "arbitrum",
      "send --to-chain arbitrum",
    );
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain(
      "send --to-chain arbitrum is not supported for fastUSD on mainnet",
    );
  });
});

describe("fund usdc crypto rewrap", () => {
  it("defaulted fastUSD on arbitrum → 'Try --token USDC.' AND 'Pass --token explicitly.'", () => {
    const r = classify(
      undefined,
      mainnetCfg,
      "arbitrum",
      "fund usdc crypto",
      "Try --token USDC. ",
    );
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain("Try --token USDC.");
    expect(r.err.message).toContain("Pass --token explicitly.");
  });

  it("explicit --token fastUSD on arbitrum → 'Try --token USDC.' but NOT 'Pass --token explicitly.'", () => {
    const r = classify(
      "fastUSD",
      mainnetCfg,
      "arbitrum",
      "fund usdc crypto",
      "Try --token USDC. ",
    );
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain("Try --token USDC.");
    expect(r.err.message).not.toContain("Pass --token explicitly.");
  });

  it("typo --token USDD → TokenNotFoundError (no rewrap)", () => {
    const r = classify(
      "USDD",
      mainnetCfg,
      "arbitrum",
      "fund usdc crypto",
      "Try --token USDC. ",
    );
    expect(r.kind).toBe("token-not-found");
  });
});
