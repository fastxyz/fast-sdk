import { describe, expect, it, vi } from "vitest";

vi.mock("@fastxyz/allset-sdk", () => ({
  executeIntent: vi.fn(),
  buildTransferIntent: vi.fn(),
  fastAddressToBytes: vi.fn(),
}));

import { EVM_NETWORKS } from "../../src/client/evm.js";
import { buildPaymentHeader } from "../../src/client/index.js";

describe("client helpers", () => {
  it("buildPaymentHeader serializes Fast payloads containing bigint values", () => {
    const header = buildPaymentHeader({
      x402Version: 1,
      scheme: "exact",
      network: "fast-testnet",
      payload: {
        type: "signAndSendTransaction",
        transactionCertificate: {
          envelope: {
            transaction: {
              type: "Release20260319",
              value: {
                nonce: 7n,
              },
            },
          },
          signatures: [],
        },
      },
    });

    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      payload: { transactionCertificate: { envelope: { transaction: { value: { nonce: string } } } } };
    };

    expect(decoded.payload.transactionCertificate.envelope.transaction.value.nonce).toBe("7");
  });

  it("advertises ethereum as a supported EVM client network", () => {
    expect(EVM_NETWORKS).toContain("ethereum");
  });
});
