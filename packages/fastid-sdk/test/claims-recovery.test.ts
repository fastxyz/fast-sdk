import { describe, expect, it, vi } from "vitest";

const claimTx = vi.hoisted(() => ({
  submitSignedClaim: vi.fn(),
}));

vi.mock("../src/claim-tx.js", async () => ({
  ...(await vi.importActual("../src/claim-tx.js")),
  submitSignedClaim: claimTx.submitSignedClaim,
}));

import {
  IdClient,
  IndeterminateSubmissionError,
  KeySigner,
  SettlementMismatchError,
  WrongNetworkError,
} from "../src/index.js";

const TOKEN_ID = "11".repeat(32);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("public claim recovery", () => {
  it.each(["wrong-network", "settlement-mismatch"])(
    "preserves %s recovery through the public claim API",
    async (outcome) => {
      const signer = await KeySigner.fromPrivateKey("01".repeat(32));
      const recovery = {
        nonce: 5n,
        txIdHex: "aa".repeat(32),
        recoveryEnvelope: {
          transaction: { sentinel: "submitted" },
          signature: { sentinel: "signature" },
        },
      };
      const submissionError =
        outcome === "wrong-network"
          ? new WrongNetworkError("fast:testnet", "fast:mainnet", recovery)
          : new SettlementMismatchError(
              "aa".repeat(32),
              "bb".repeat(32),
              recovery,
            );
      claimTx.submitSignedClaim.mockReset();
      claimTx.submitSignedClaim.mockRejectedValueOnce(submissionError);

      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/property/claimed?")) {
          return json({ claimed: false });
        }
        if (url.endsWith("/proxy-rest/v1/network-info")) {
          return json({
            data: {
              network_id: "fast:testnet",
              fees: {
                default: TOKEN_ID,
                entries: [{ token_id: TOKEN_ID, fixed_amount: "7" }],
              },
            },
          });
        }
        if (url.includes("/proxy-rest/v1/tokens?")) {
          return json({
            data: {
              requested_token_metadata: [
                [TOKEN_ID, { token_name: "testUSDC", decimals: 6, update_id: 3 }],
              ],
            },
          });
        }
        throw new Error(`unexpected URL ${url}`);
      });
      const provider = {
        getAccountInfo: vi.fn(async () => ({ nextNonce: 5n })),
        submitTransaction: vi.fn(),
      };
      const client = new IdClient({
        network: "fast:testnet",
        signer,
        fetchImpl: fetchImpl as typeof fetch,
        provider: provider as never,
      });

      const error = await client
        .importWork("10.1000/example")
        .catch((cause) => cause);

      expect(error).toBeInstanceOf(IndeterminateSubmissionError);
      if (!(error instanceof IndeterminateSubmissionError)) {
        throw new Error("expected indeterminate submission error");
      }
      expect(error.recovery).toEqual(recovery);
      expect(error.nonce).toBe(5n);
      expect(error.txIdHex).toBe("aa".repeat(32));
      expect(error.recoveryEnvelope).toEqual(recovery.recoveryEnvelope);
      expect(provider.submitTransaction).not.toHaveBeenCalled();
      expect(fetchImpl.mock.calls.some(([input]) => String(input).endsWith("/api/claim"))).toBe(
        false,
      );
    },
  );
});
