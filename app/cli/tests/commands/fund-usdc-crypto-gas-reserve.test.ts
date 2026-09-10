import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { fundUsdcCrypto } from "../../src/commands/fund/usdc/crypto.js";
import { bundledNetworks } from "../../src/config/networks.js";
import { FundingRequiredError } from "../../src/errors/index.js";
import { AllSet } from "../../src/services/api/allset.js";
import { ClientConfig } from "../../src/services/config/client.js";
import { Output } from "../../src/services/output.js";
import { Prompt } from "../../src/services/prompt.js";
import { AccountStore } from "../../src/services/storage/account.js";
import { HistoryStore } from "../../src/services/storage/history.js";
import { NetworkConfigService } from "../../src/services/storage/network.js";

/**
 * Behavioral witness for the Arc gas-reserve preflight in `fund usdc crypto`.
 *
 * On Arc the deposited USDC is also the gas token, so a balance exactly equal
 * to the deposit must be refused before the account is exported or any
 * deposit is attempted, and the reserve/shortfall must be shown to the user.
 */

// 24 gwei * 300k gas * 2 = 0.0144 USDC = 14_400 units at 6 decimals
const RESERVE_WEI = 24n * 10n ** 9n * 300_000n * 2n;
const RESERVE_UNITS = 14_400n;
const ONE_USDC = 1_000_000n;

class Sentinel extends Error {
  constructor(public readonly where: string) {
    super(`sentinel: ${where}`);
  }
}

function harness(balance: bigint) {
  const lines: string[] = [];
  const calls = { export: 0, deposit: 0, nativeBalance: 0, gasReserve: 0 };

  const layers = Layer.mergeAll(
    Layer.succeed(ClientConfig, {
      json: false,
      debug: false,
      nonInteractive: true,
      network: "mainnet",
      account: Option.none(),
      password: Option.none(),
    }),
    Layer.succeed(NetworkConfigService, {
      resolve: () => Effect.succeed(bundledNetworks.mainnet!),
    } as unknown as NetworkConfigService),
    Layer.succeed(AccountStore, {
      resolveAccount: () =>
        Effect.succeed({
          name: "test",
          evmAddress: "0x1111111111111111111111111111111111111111",
          encrypted: false,
        }),
      export: () => {
        calls.export++;
        return Effect.fail(new Sentinel("accounts.export"));
      },
    } as unknown as AccountStore),
    Layer.succeed(AllSet, {
      erc20Balance: () => Effect.succeed(balance),
      gasReserve: () => {
        calls.gasReserve++;
        return Effect.succeed(RESERVE_WEI);
      },
      nativeBalance: () => {
        calls.nativeBalance++;
        return Effect.succeed(0n);
      },
      deposit: () => {
        calls.deposit++;
        return Effect.fail(new Sentinel("bridge.deposit"));
      },
      createWallet: () => {
        throw new Sentinel("bridge.createWallet");
      },
      createExecutor: () => {
        throw new Sentinel("bridge.createExecutor");
      },
      withdraw: () => Effect.fail(new Sentinel("bridge.withdraw")),
    } as unknown as AllSet),
    Layer.succeed(Output, {
      humanLine: (text: string) => {
        lines.push(text);
        return Effect.void;
      },
      ok: () => Effect.void,
      fail: () => Effect.void,
      humanTable: () => Effect.void,
    } as unknown as Output),
    Layer.succeed(Prompt, {
      password: () => Effect.fail(new Sentinel("prompt.password")),
    } as unknown as Prompt),
    Layer.succeed(HistoryStore, {
      record: () => Effect.fail(new Sentinel("history.record")),
    } as unknown as HistoryStore),
  );

  const run = () =>
    Effect.runPromise(
      Effect.flip(
        fundUsdcCrypto
          .handler({ amount: "1", chain: "arc", token: "USDC", eip7702: false } as never)
          .pipe(Effect.provide(layers)),
      ),
    );

  return { run, lines, calls };
}

describe("fund usdc crypto on Arc (gas token == deposit token)", () => {
  it("refuses balance == amount, shows the reserve and shortfall, and never exports or deposits", async () => {
    const { run, lines, calls } = harness(ONE_USDC);
    const err = await run();

    expect(err).toBeInstanceOf(FundingRequiredError);
    expect((err as FundingRequiredError).message).toContain("need 0.0144 more USDC on arc");

    const text = lines.join("\n");
    expect(text).toContain("Insufficient USDC balance on arc.");
    expect(text).toContain("Gas reserve:  0.0144 USDC (arc pays gas in USDC)");
    expect(text).toContain("Shortfall:    0.0144 USDC");
    expect(text).not.toContain("ETH");

    expect(calls.gasReserve).toBe(1);
    expect(calls.export).toBe(0);
    expect(calls.deposit).toBe(0);
    // the reserve covers gas; no separate native check on Arc
    expect(calls.nativeBalance).toBe(0);
  });

  it("passes the preflight once balance covers amount + reserve (reaches the account export)", async () => {
    const { run, calls } = harness(ONE_USDC + RESERVE_UNITS);
    const err = await run();

    expect(err).toBeInstanceOf(Sentinel);
    expect((err as Sentinel).where).toBe("accounts.export");
    expect(calls.export).toBe(1);
    expect(calls.deposit).toBe(0);
  });
});
