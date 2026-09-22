import { describe, expect, it, vi } from "vitest";

vi.mock("../src/fasttx.js", () => ({
  txIdFromDomainTransaction: vi.fn(
    async (transaction: { __id?: string } | undefined) => {
      if (!transaction) {
        throw new Error("cannot hash certificate transaction");
      }
      return transaction.__id ?? "cc".repeat(32);
    },
  ),
}));

import {
  InsufficientFundsError,
  NonceConflictError,
  NotSettledError,
  SettlementMismatchError,
  WrongNetworkError,
} from "../src/errors.js";
import {
  buildExternalClaimBytes,
  feeTokenFor,
  getNextNonce,
  IndeterminateProviderSubmissionError,
  submitSignedClaim,
  toRestGateway,
} from "../src/claim-tx.js";

const address =
  "fast13289h54tze49fhr4g7x4zee5t95ah7xpq9e727yy3lpme4dll6zshexh9v";
const signature = "ab".repeat(64);

function providerOf(submitTransaction: (envelope: unknown) => unknown): never {
  return { submitTransaction: vi.fn(submitTransaction) } as never;
}

function certificate(overrides: {
  id?: string;
  nonce?: bigint;
  networkId?: string;
} = {}) {
  return {
    envelope: {
      transaction: {
        __id: overrides.id ?? "aa".repeat(32),
        value: {
          nonce: overrides.nonce ?? 9n,
          networkId: overrides.networkId ?? "fast:mainnet",
        },
      },
    },
  };
}

describe("claim transaction construction", () => {
  it("derives the REST gateway and fails closed for unknown fee networks", () => {
    expect(toRestGateway("https://api.fast.xyz/proxy")).toBe(
      "https://api.fast.xyz/proxy-rest",
    );
    expect(toRestGateway("https://x/proxy-rest")).toBe("https://x/proxy-rest");
    expect(feeTokenFor("fast:mainnet").tokenId).not.toBe(
      feeTokenFor("fast:testnet").tokenId,
    );
    expect(() => feeTokenFor("fast:devnet")).toThrow(/unknown network/i);
  });

  it("gets the next nonce without narrowing it to a number", async () => {
    const getAccountInfo = vi.fn(async () => ({ nextNonce: 9_007_199_254_740_993n }));
    const nonce = await getNextNonce({ getAccountInfo } as never, address);
    expect(nonce).toBe(9_007_199_254_740_993n);
    expect(getAccountInfo).toHaveBeenCalledWith({
      address,
      tokenBalancesFilter: null,
      stateKeyFilter: null,
    });
  });

  it("builds quorum-zero ExternalClaim bytes with a decimal-string nonce", async () => {
    const built = await buildExternalClaimBytes({
      address,
      networkId: "fast:testnet",
      nonce: 9_007_199_254_740_993n,
      claimDataHex: "aa".repeat(64),
      feeToken: feeTokenFor("fast:testnet").tokenId,
      timestampNanos: 1n,
    });
    expect(built.bytes.length).toBeGreaterThan(0);
    expect(built.bytes.length).toBeLessThanOrEqual(4096);
    expect(built.nonce).toBe("9007199254740993");
  });

  it("rejects signing payloads over the 4096-byte limit", async () => {
    await expect(
      buildExternalClaimBytes({
        address,
        networkId: "fast:testnet",
        nonce: 1n,
        claimDataHex: "aa".repeat(5000),
        feeToken: feeTokenFor("fast:testnet").tokenId,
        timestampNanos: 1n,
      }),
    ).rejects.toThrow(/4096/);
  });
});

describe("submitSignedClaim settlement guards", () => {
  it("returns a settled success with full-precision decimal nonce", async () => {
    const submitted = { __id: "aa".repeat(32) };
    const result = await submitSignedClaim(
      providerOf(() => ({
        type: "Success",
        value: certificate({ nonce: 9_007_199_254_740_993n }),
      })),
      submitted,
      signature,
      "fast:mainnet",
      "fastUSD",
    );
    expect(result).toEqual({
      txIdHex: "aa".repeat(32),
      nonce: "9007199254740993",
    });
  });

  it("rejects a certificate for a different transaction", async () => {
    let submittedEnvelope: unknown;
    const error = await submitSignedClaim(
      providerOf((envelope) => {
        submittedEnvelope = envelope;
        return {
          type: "Success",
          value: certificate({ id: "bb".repeat(32) }),
        };
      }),
      { __id: "aa".repeat(32) },
      signature,
      "fast:mainnet",
      "fastUSD",
    ).catch((cause) => cause);
    expect(error).toBeInstanceOf(SettlementMismatchError);
    if (!(error instanceof SettlementMismatchError)) throw new Error("expected settlement mismatch");
    expect(error.recovery).toMatchObject({ txIdHex: "aa".repeat(32) });
    if (!error.recovery) throw new Error("expected settlement recovery");
    expect(error.recovery.recoveryEnvelope).toEqual(submittedEnvelope);
  });

  it("rejects a certificate for the wrong network", async () => {
    let submittedEnvelope: unknown;
    const error = await submitSignedClaim(
      providerOf((envelope) => {
        submittedEnvelope = envelope;
        return {
          type: "Success",
          value: certificate({ networkId: "fast:testnet" }),
        };
      }),
      { __id: "aa".repeat(32) },
      signature,
      "fast:mainnet",
      "fastUSD",
    ).catch((cause) => cause);
    expect(error).toBeInstanceOf(WrongNetworkError);
    if (!(error instanceof WrongNetworkError)) throw new Error("expected wrong network");
    expect(error.recovery).toMatchObject({ txIdHex: "aa".repeat(32) });
    if (!error.recovery) throw new Error("expected network recovery");
    expect(error.recovery.recoveryEnvelope).toEqual(submittedEnvelope);
  });

  it.each([
    ["missing envelope transaction", () => ({ type: "Success", value: { envelope: {} } })],
    [
      "unhashable certificate transaction",
      () => ({
        type: "Success",
        value: {
          envelope: {
            transaction: {
              get __id(): never {
                throw new Error("cannot hash certificate");
              },
            },
          },
        },
      }),
    ],
    [
      "certificate without nonce",
      () => ({
        type: "Success",
        value: { envelope: { transaction: { __id: "aa".repeat(32) } } },
      }),
    ],
  ] as const)("preserves recovery for %s", async (_label, result) => {
    let submittedEnvelope: unknown;
    const error = await submitSignedClaim(
      providerOf((envelope) => {
        submittedEnvelope = envelope;
        return result();
      }),
      { __id: "aa".repeat(32) },
      signature,
      "fast:mainnet",
      "fastUSD",
    ).catch((cause) => cause);
    expect(error).toBeInstanceOf(IndeterminateProviderSubmissionError);
    if (!(error instanceof IndeterminateProviderSubmissionError)) throw new Error("expected indeterminate provider submission");
    expect(error.recovery).toMatchObject({ txIdHex: "aa".repeat(32) });
    expect(error.recovery.recoveryEnvelope).toEqual(submittedEnvelope);
  });

  it("maps incomplete and tagged provider failures without fabricating settlement", async () => {
    await expect(
      submitSignedClaim(
        providerOf(() => ({ type: "IncompleteVerifierSigs" })),
        {},
        signature,
        "fast:mainnet",
        "fastUSD",
      ),
    ).rejects.toBeInstanceOf(NotSettledError);

    await expect(
      submitSignedClaim(
        providerOf(() => {
          throw { _tag: "UnexpectedNonceError", expectedNonce: 7n };
        }),
        {},
        signature,
        "fast:mainnet",
        "fastUSD",
      ),
    ).rejects.toBeInstanceOf(NonceConflictError);

    await expect(
      submitSignedClaim(
        providerOf(() => {
          throw { details: { InsufficientFundingForFee: {} } };
        }),
        {},
        signature,
        "fast:mainnet",
        "rotatedUSD",
      ),
    ).rejects.toMatchObject({
      name: "InsufficientFundsError",
      symbol: "rotatedUSD",
    } satisfies Partial<InsufficientFundsError>);
  });
});
