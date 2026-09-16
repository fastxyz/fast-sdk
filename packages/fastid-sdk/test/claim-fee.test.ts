import { describe, expect, it, vi } from "vitest";

import {
  feeTokenForState,
  formatFee,
  proxyFeeSource,
  resolveClaimFee,
  type FeeSource,
} from "../src/claim-fee.js";

const TOKEN_ID = "11".repeat(32);
const MAX_U256 = ((1n << 256n) - 1n).toString();

function source(info: unknown, meta: unknown = undefined): FeeSource {
  return {
    networkInfo: vi.fn(async () => info),
    tokenMeta: vi.fn(async () => meta),
  };
}

function info(entries: unknown[], defaultToken = TOKEN_ID): unknown {
  return {
    data: {
      network_id: "fast:testnet",
      fees: { default: defaultToken, entries },
    },
  };
}

function meta(overrides: Record<string, unknown> = {}): unknown {
  return {
    data: {
      requested_token_metadata: [
        [TOKEN_ID, { token_name: "testUSDC", decimals: 6, update_id: 3, ...overrides }],
      ],
    },
  };
}

describe("authoritative claim fee", () => {
  it("distinguishes configured no-fee from an unavailable fee", async () => {
    const bootstrap = source(info([]));
    await expect(resolveClaimFee("fast:testnet", bootstrap)).resolves.toEqual({
      kind: "none",
    });
    expect(bootstrap.tokenMeta).not.toHaveBeenCalled();
    await expect(
      resolveClaimFee(
        "fast:testnet",
        source(info([{ token_id: TOKEN_ID, fixed_amount: "0" }])),
      ),
    ).resolves.toEqual({ kind: "none" });

    for (const malformed of [
      null,
      { data: { network_id: "fast:mainnet", fees: { default: TOKEN_ID, entries: [] } } },
      info([{ token_id: TOKEN_ID, fixed_amount: "01" }]),
      info([{ token_id: TOKEN_ID, fixed_amount: (BigInt(MAX_U256) + 1n).toString() }]),
      info([{ token_id: TOKEN_ID, fixed_amount: "7" }], "AA".repeat(32)),
    ]) {
      await expect(resolveClaimFee("fast:testnet", source(malformed))).resolves.toEqual({
        kind: "unavailable",
      });
    }
  });

  it("returns a fully bound quote only with verified token metadata", async () => {
    const quote = await resolveClaimFee(
      "fast:testnet",
      source(info([{ token_id: TOKEN_ID, fixed_amount: "7" }]), meta()),
    );
    expect(quote).toEqual({
      kind: "quoted",
      tokenId: TOKEN_ID,
      symbol: "testUSDC",
      decimals: 6,
      atomicAmount: "7",
      updateId: 3,
    });
    expect(feeTokenForState(quote)).toBe(TOKEN_ID);
    expect(formatFee(quote)).toBe("0.000007 testUSDC");
    const indivisible = await resolveClaimFee(
      "fast:testnet",
      source(
        info([{ token_id: TOKEN_ID, fixed_amount: "7" }]),
        meta({ token_name: "WHOLE", decimals: 0 }),
      ),
    );
    expect(formatFee(indivisible)).toBe("7 WHOLE");
    expect(feeTokenForState({ kind: "none" })).toBeNull();
    expect(() => feeTokenForState({ kind: "unavailable" })).toThrow(/fail closed/i);
  });

  it("fails closed when the authoritative response contains duplicate default entries", async () => {
    const feeSource = source(
      info([
        { token_id: TOKEN_ID, fixed_amount: "0" },
        { token_id: TOKEN_ID, fixed_amount: "7" },
      ]),
      meta(),
    );

    await expect(resolveClaimFee("fast:testnet", feeSource)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(feeSource.tokenMeta).not.toHaveBeenCalled();
  });

  it.each([
    ["missing token", { data: { requested_token_metadata: [] } }],
    ["empty symbol", meta({ token_name: "" })],
    ["invalid decimals", meta({ decimals: 256 })],
    ["invalid update id", meta({ update_id: -1 })],
  ])("fails closed for %s metadata", async (_label, tokenMeta) => {
    await expect(
      resolveClaimFee(
        "fast:testnet",
        source(info([{ token_id: TOKEN_ID, fixed_amount: MAX_U256 }]), tokenMeta),
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("builds both fee reads from the configured REST gateway", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    });
    const feeSource = proxyFeeSource(
      "https://testnet.api.fast.xyz/proxy",
      fetchImpl as typeof fetch,
    );
    await feeSource.networkInfo();
    await feeSource.tokenMeta(TOKEN_ID);
    expect(calls).toEqual([
      "https://testnet.api.fast.xyz/proxy-rest/v1/network-info",
      `https://testnet.api.fast.xyz/proxy-rest/v1/tokens?token_ids=${TOKEN_ID}`,
    ]);
  });
});
