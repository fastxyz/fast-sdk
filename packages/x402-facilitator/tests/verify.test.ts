/**
 * Tests for payment verification
 */

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { FastTransactionCertificate } from "./helpers.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verify } from "../src/verify.js";
import {
  bytesToHex,
  createFastTransactionSigningMessage,
  serializeFastTransaction,
  unwrapFastTransaction,
} from "../src/fast-bcs.js";
import type { FacilitatorConfig } from "../src/types.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown;
}

interface PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
}

function rawPublicKey(key: KeyObject): Uint8Array {
  const spki = key.export({ format: "der", type: "spki" });
  if (!Buffer.from(spki).subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error("unexpected_ed25519_spki_prefix");
  }

  return new Uint8Array(Buffer.from(spki).subarray(ED25519_SPKI_PREFIX.length));
}

function certificateLookupKey(certificate: FastTransactionCertificate): string {
  const transaction = unwrapFastTransaction(certificate.envelope.transaction);
  const sender = Buffer.from(Array.from(transaction.sender)).toString("hex");
  return `${sender}:${transaction.nonce.toString()}`;
}

function cloneCertificate(certificate: FastTransactionCertificate): FastTransactionCertificate {
  return JSON.parse(JSON.stringify(certificate, (_key, value) =>
    typeof value === 'bigint' ? `__bigint__${value.toString()}` : value
  ), (_key, value) =>
    typeof value === 'string' && value.startsWith('__bigint__')
      ? BigInt(value.slice('__bigint__'.length))
      : value
  ) as FastTransactionCertificate;
}

describe("verify", () => {
  describe("Fast payments", () => {
    const proxyCertificates = new Map<string, FastTransactionCertificate>();
    let lastFetchUrl: string | undefined;

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
        lastFetchUrl = String(_input);
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          id?: number;
          method?: string;
          params?: {
            address?: number[];
            certificate_by_nonce?: { start?: number; limit?: number };
          };
        };

        if (body.method !== "proxy_getAccountInfo") {
          throw new Error(`unexpected_method:${body.method}`);
        }

        const sender = Buffer.from(body.params?.address ?? []).toString("hex");
        const nonce = body.params?.certificate_by_nonce?.start?.toString() ?? "";
        const certificate = proxyCertificates.get(`${sender}:${nonce}`);

        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id ?? 1,
          result: {
            requested_certificates: certificate ? [certificate] : [],
          },
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }));
    });

    afterEach(() => {
      lastFetchUrl = undefined;
      proxyCertificates.clear();
      vi.unstubAllGlobals();
    });

    function committeePublicKeysForCertificate(certificate: FastTransactionCertificate): string[] {
      const trustedCertificate = proxyCertificates.get(certificateLookupKey(certificate)) ?? certificate;
      return trustedCertificate.signatures.map((signatureEntry: unknown) => {
        const [publicKey] = signatureEntry as [number[], number[]];
        return Buffer.from(publicKey).toString("hex");
      });
    }

    function fastVerificationConfig(
      certificate: FastTransactionCertificate,
      network: string,
      extra: Partial<FacilitatorConfig> & { fastRpcUrl?: string } = {}
    ): FacilitatorConfig {
      const { fastRpcUrl, ...rest } = extra;
      const keys = committeePublicKeysForCertificate(certificate);
      const rpcUrl = fastRpcUrl ?? (network === "fast-mainnet"
        ? "https://api.fast.xyz/proxy"
        : "https://testnet.api.fast.xyz/proxy");
      return {
        ...rest,
        fastNetworks: {
          ...(rest.fastNetworks ?? {}),
          [network]: {
            rpcUrl,
            committeePublicKeys: keys,
          },
        },
      };
    }

    async function verifyFastFixture(
      payload: PaymentPayload,
      requirement: PaymentRequirement,
      extra: Partial<FacilitatorConfig> & { fastRpcUrl?: string } = {}
    ) {
      const certificate = (
        payload.payload as { transactionCertificate: FastTransactionCertificate }
      ).transactionCertificate;
      return verify(payload, requirement, fastVerificationConfig(certificate, payload.network, extra));
    }

    function createFastCertificate(
      recipient: Uint8Array,
      amount: bigint,
      tokenId: Uint8Array,
      options: {
        tamperSenderSignature?: boolean;
        tamperCommitteeSignature?: boolean;
        duplicateCommitteeSigner?: boolean;
        forgeCommitteeSigners?: boolean;
        signSenderWithRawTransaction?: boolean;
        network?: string;
      } = {}
    ) {
      const { publicKey: senderPublicKey, privateKey: senderPrivateKey } = generateKeyPairSync("ed25519");
      const sender = rawPublicKey(senderPublicKey);
      const networkId = options.network === "fast-mainnet"
        ? "fast:mainnet"
        : options.network?.startsWith("fast-")
          ? `fast:${options.network.slice("fast-".length)}`
          : "fast:testnet";
      const transaction = {
        network_id: networkId,
        sender: Array.from(sender),
        nonce: 1,
        timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
        claim: {
          TokenTransfer: {
            token_id: Array.from(tokenId),
            recipient: Array.from(recipient),
            amount,
            user_data: null,
          },
        },
        archival: false,
        fee_token: null,
      };

      const transactionBytes = serializeFastTransaction(transaction);
      const senderPayload = options.signSenderWithRawTransaction
        ? transactionBytes
        : createFastTransactionSigningMessage(transactionBytes);
      const senderSignature = new Uint8Array(
        sign(null, Buffer.from(senderPayload), senderPrivateKey)
      );

      const canonicalCommitteeSignatures: Array<[number[], number[]]> = [];
      const committeeKeys: Uint8Array[] = [];
      const committeePayload = createFastTransactionSigningMessage(transactionBytes);
      for (let i = 0; i < 3; i++) {
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const committeePublicKey = rawPublicKey(publicKey);
        committeeKeys.push(committeePublicKey);

        const signature = new Uint8Array(sign(null, Buffer.from(committeePayload), privateKey));
        canonicalCommitteeSignatures.push([
          Array.from(committeePublicKey),
          Array.from(signature),
        ]);
      }

      const canonicalCertificate: FastTransactionCertificate = {
        envelope: {
          transaction: {
            Release20260319: transaction,
          },
          signature: {
            Signature: Array.from(senderSignature),
          },
        },
        signatures: canonicalCommitteeSignatures,
      };
      proxyCertificates.set(certificateLookupKey(canonicalCertificate), cloneCertificate(canonicalCertificate));

      const certificate = cloneCertificate(canonicalCertificate);
      if (options.tamperSenderSignature) {
        const envelopeSignature = certificate.envelope.signature as { Signature?: number[] };
        (envelopeSignature.Signature ?? [])[0] ^= 0xff;
      }

      if (options.duplicateCommitteeSigner) {
        (certificate.signatures as Array<[number[], number[]]>)[1] = [
          Array.from(committeeKeys[0]),
          [...(certificate.signatures as Array<[number[], number[]]>)[1][1]],
        ];
      }

      if (options.tamperCommitteeSignature) {
        (certificate.signatures as Array<[number[], number[]]>)[0][1][0] ^= 0xff;
      }

      if (options.forgeCommitteeSigners) {
        const forgedSignatures: Array<[number[], number[]]> = [];
        for (let i = 0; i < certificate.signatures.length; i++) {
          const { publicKey, privateKey } = generateKeyPairSync("ed25519");
          forgedSignatures.push([
            Array.from(rawPublicKey(publicKey)),
            Array.from(new Uint8Array(sign(null, Buffer.from(transactionBytes), privateKey))),
          ]);
        }
        certificate.signatures = forgedSignatures;
      }

      return certificate;
    }

    function createFastPayload(
      certificate: FastTransactionCertificate,
      network: string = "fast-testnet"
    ): PaymentPayload {
      return {
        x402Version: 1,
        scheme: "exact",
        network,
        payload: { transactionCertificate: certificate },
      };
    }

    const tokenId = new Uint8Array(32);
    tokenId.set([0x1b, 0x48, 0x76, 0x61], 0);

    const recipient = new Uint8Array(32).fill(0xbb);
    const recipientHex = bytesToHex(recipient);
    const oneUsdcUnits = 1_000_000n;

    it("validates a correct Fast payment", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId);

      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "fast-testnet",
        payload: { transactionCertificate: certificate },
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBeDefined();
    });

    it("rejects payment with an invalid sender signature", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        tamperSenderSignature: true,
      });

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_fast_transaction_signature");
    });

    it("rejects payment when the sender signs raw transaction bytes", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        signSenderWithRawTransaction: true,
      });

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_fast_transaction_signature");
    });

    it("uses the configured Fast mainnet RPC URL", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        network: "fast-mainnet",
      });
      const payload = createFastPayload(certificate, "fast-mainnet");

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-mainnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(true);
      expect(lastFetchUrl).toBe("https://api.fast.xyz/proxy");
    });

    it("uses custom RPC URL override for network certificate lookup", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        network: "fast-mainnet",
      });
      const payload = createFastPayload(certificate, "fast-mainnet");

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-mainnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement, {
        fastRpcUrl: "https://custom.fast.example/proxy",
      });
      expect(result.isValid).toBe(true);
      expect(lastFetchUrl).toBe("https://custom.fast.example/proxy");
    });

    it("rejects certificate network_id mismatches", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        network: "fast-testnet",
      });
      const payload = createFastPayload(certificate, "fast-mainnet");

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-mainnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("network_id_mismatch: expected fast:mainnet, got fast:testnet");
    });

    it("rejects the legacy fast alias", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        network: "fast-mainnet",
      });
      const payload = createFastPayload(certificate, "fast");

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_network");
    });

    it("rejects payment with an invalid committee signature", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        tamperCommitteeSignature: true,
      });

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_fast_committee_signature");
    });

    it("rejects committee signers that are not in the trusted config", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        forgeCommitteeSigners: true,
      });

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unknown_fast_committee_signer");
    });

    it("rejects payment with wrong recipient", async () => {
      const wrongRecipient = new Uint8Array(32).fill(0xff);
      const certificate = createFastCertificate(wrongRecipient, oneUsdcUnits, tokenId);

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("recipient_mismatch");
    });

    it("rejects payment with insufficient amount", async () => {
      const certificate = createFastCertificate(recipient, 100n, tokenId);

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("insufficient_amount");
    });

    it("rejects payment with wrong token", async () => {
      const wrongToken = new Uint8Array(32).fill(0x99);
      const certificate = createFastCertificate(recipient, oneUsdcUnits, wrongToken);

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("token_mismatch");
    });

    it("rejects missing envelope", async () => {
      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "fast-testnet",
        payload: {
          transactionCertificate: {
            envelope: null,
            signatures: [],
          } as any,
        },
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verify(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("missing_envelope");
    });

    it("rejects missing signatures", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId);
      certificate.signatures = [];

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("missing_signatures");
    });

    it("rejects wrong scheme", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId);

      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "wrong-scheme",
        network: "fast-testnet",
        payload: { transactionCertificate: certificate },
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unsupported_scheme");
    });

    it("rejects network mismatch", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId);

      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "fast-mainnet",
        payload: { transactionCertificate: certificate },
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_network");
    });

    it("rejects underpayments after decoding the transaction certificate", async () => {
      const certificate = createFastCertificate(recipient, 50_000n, tokenId);

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: "60000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("insufficient_amount");
    });

    it("accepts object-format envelopes with short hex amounts", async () => {
      const certificate = createFastCertificate(recipient, 1000n, tokenId);

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: "1000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBeDefined();
    });

    it("rejects duplicate committee signers", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId, {
        duplicateCommitteeSigner: true,
      });

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("duplicate_committee_signature");
    });

    it("accepts plain hex signatures without 0x prefixes", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId);
      const envelopeSignature = certificate.envelope.signature as { Signature: number[] };
      envelopeSignature.Signature = Buffer.from(envelopeSignature.Signature).toString("hex") as unknown as number[];
      certificate.signatures = (certificate.signatures as Array<[number[], number[]]>).map(
        ([committeeMember, signature]) => ({
          committee_member: committeeMember,
          signature: Buffer.from(signature).toString("hex"),
        }),
      ) as unknown as FastTransactionCertificate["signatures"];

      const payload = createFastPayload(certificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verifyFastFixture(payload, requirement);
      expect(result.isValid).toBe(true);
    });

    it("rejects forged committee signers even when the RPC echoes the forged certificate", async () => {
      const certificate = createFastCertificate(recipient, oneUsdcUnits, tokenId);
      const trustedCommitteePublicKeys = committeePublicKeysForCertificate(certificate);
      const forgedCertificate = cloneCertificate(certificate);
      const transactionBytes = serializeFastTransaction(
        unwrapFastTransaction(forgedCertificate.envelope.transaction)
      );

      forgedCertificate.signatures = forgedCertificate.signatures.map(() => {
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        return [
          Array.from(rawPublicKey(publicKey)),
          Array.from(new Uint8Array(sign(null, Buffer.from(transactionBytes), privateKey))),
        ];
      }) as Array<[number[], number[]]>;
      proxyCertificates.set(
        certificateLookupKey(forgedCertificate),
        cloneCertificate(forgedCertificate)
      );

      const payload = createFastPayload(forgedCertificate);

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verify(payload, requirement, {
        fastNetworks: {
          "fast-testnet": {
            rpcUrl: "https://testnet.api.fast.xyz/proxy",
            committeePublicKeys: trustedCommitteePublicKeys,
          },
        },
      });
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unknown_fast_committee_signer");
    });

    it("rejects legacy string-envelope certificates", async () => {
      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "fast-testnet",
        payload: {
          transactionCertificate: {
            envelope: "0x1234",
            signatures: [
              [new Array(32).fill(0xaa), new Array(64).fill(0xbb)],
            ],
          } as any,
        },
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: oneUsdcUnits.toString(),
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: recipientHex,
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      };

      const result = await verify(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unsupported_fast_certificate_format");
    });
  });

  describe("EVM payments", () => {
    const evmConfig: FacilitatorConfig = {
      evmChains: {
        "arbitrum-sepolia": {
          chain: {} as any,
          rpcUrl: "https://arb-sepolia.example.com",
          usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
        },
      },
    };

    it("rejects invalid payload structure", async () => {
      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "arbitrum-sepolia",
        payload: {},
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "arbitrum-sepolia",
        maxAmountRequired: "100000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: "0x1234567890123456789012345678901234567890",
        maxTimeoutSeconds: 60,
        asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      };

      const result = await verify(payload, requirement, evmConfig);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_payload");
    });

    it("rejects wrong scheme", async () => {
      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "wrong",
        network: "arbitrum-sepolia",
        payload: {
          signature: "0x" + "ab".repeat(65),
          authorization: {
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            value: "100000",
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: "0x" + "00".repeat(32),
          },
        },
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "arbitrum-sepolia",
        maxAmountRequired: "100000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 60,
        asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      };

      const result = await verify(payload, requirement, evmConfig);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unsupported_scheme");
    });

    it("rejects recipient mismatch", async () => {
      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "arbitrum-sepolia",
        payload: {
          signature: "0x" + "ab".repeat(65),
          authorization: {
            from: "0x1111111111111111111111111111111111111111",
            to: "0x3333333333333333333333333333333333333333",
            value: "100000",
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: "0x" + "00".repeat(32),
          },
        },
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "arbitrum-sepolia",
        maxAmountRequired: "100000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 60,
        asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      };

      const result = await verify(payload, requirement, evmConfig);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_evm_payload_recipient_mismatch");
    });
  });

  describe("unsupported networks", () => {
    it("rejects unsupported network type", async () => {
      const payload: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "solana-mainnet",
        payload: {},
      };

      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "solana-mainnet",
        maxAmountRequired: "100000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: "SomeAddress",
        maxTimeoutSeconds: 60,
        asset: "USDC",
      };

      const result = await verify(payload, requirement);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unsupported_network_type");
    });
  });
});
