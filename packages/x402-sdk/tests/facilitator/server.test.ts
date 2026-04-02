/**
 * Tests for facilitator server endpoints
 */

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { FastTransactionCertificate } from "./helpers.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFacilitatorRoutes, createFacilitatorServer } from "../../src/facilitator/server.js";
import {
  bytesToHex,
  createFastTransactionSigningMessage,
  serializeFastTransaction,
  unwrapFastTransaction,
} from "../../src/facilitator/fast-bcs.js";
import type { FacilitatorConfig } from "../../src/facilitator/types.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

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
  return JSON.parse(JSON.stringify(certificate)) as FastTransactionCertificate;
}

// Mock Express request/response
function createMockRequest(method: string, path: string, body?: unknown) {
  return {
    method,
    path,
    body: body || {},
  };
}

function createMockResponse() {
  let statusCode = 200;
  let jsonBody: unknown = null;

  return {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
    },
    getStatus: () => statusCode,
    getJson: () => jsonBody,
  };
}

const proxyCertificates = new Map<string, FastTransactionCertificate>();
let lastFetchUrl: string | undefined;

function createFastCertificate(
  recipient: Uint8Array,
  amountHex: string,
  tokenId: Uint8Array,
  network: string = "fast-testnet"
) : FastTransactionCertificate {
  const { publicKey: senderPublicKey, privateKey: senderPrivateKey } = generateKeyPairSync("ed25519");
  const sender = rawPublicKey(senderPublicKey);
  const networkId = network === "fast-mainnet"
    ? "fast:mainnet"
    : network.startsWith("fast-")
      ? `fast:${network.slice("fast-".length)}`
      : "fast:testnet";
  const transaction = {
    network_id: networkId,
    sender: Array.from(sender),
    nonce: 1,
    timestamp_nanos: (BigInt(Date.now()) * 1_000_000n).toString(),
    claim: {
      TokenTransfer: {
        token_id: Array.from(tokenId),
        recipient: Array.from(recipient),
        amount: amountHex,
        user_data: null,
      },
    },
    archival: false,
    fee_token: null,
  };

  const transactionBytes = serializeFastTransaction(transaction);
  const senderSignature = sign(
    null,
    Buffer.from(createFastTransactionSigningMessage(transactionBytes)),
    senderPrivateKey
  );

  // Committee also signs with "VersionedTransaction::" prefix (same as sender)
  const committeePayload = createFastTransactionSigningMessage(transactionBytes);
  const signatures: Array<[number[], number[]]> = [];
  for (let i = 0; i < 3; i++) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    signatures.push([
      Array.from(rawPublicKey(publicKey)),
      Array.from(sign(null, Buffer.from(committeePayload), privateKey)),
    ]);
  }

  const certificate: FastTransactionCertificate = {
    envelope: {
      transaction: {
        Release20260319: transaction,
      },
      signature: {
        Signature: Array.from(senderSignature),
      },
    },
    signatures,
  };
  proxyCertificates.set(certificateLookupKey(certificate), cloneCertificate(certificate));
  return certificate;
}

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

function fastRouteConfig(
  certificate: FastTransactionCertificate,
  network: string,
  extra: FacilitatorConfig = {}
): FacilitatorConfig {
  const trustedCertificate = proxyCertificates.get(certificateLookupKey(certificate)) ?? certificate;
  const committeePublicKeys = trustedCertificate.signatures.map((signatureEntry: unknown) => {
    const [publicKey] = signatureEntry as [number[], number[]];
    return Buffer.from(publicKey).toString("hex");
  });

  return {
    ...extra,
    committeePublicKeys: {
      ...(extra.committeePublicKeys ?? {}),
      [network]: committeePublicKeys,
    },
  };
}

describe("createFacilitatorRoutes", () => {

  it("creates routes for /verify, /settle, /supported", () => {
    const routes = createFacilitatorRoutes();
    
    expect(routes).toHaveLength(3);
    expect(routes.map(r => r.path)).toContain("/verify");
    expect(routes.map(r => r.path)).toContain("/settle");
    expect(routes.map(r => r.path)).toContain("/supported");
  });
});

describe("GET /supported", () => {
  it("returns supported payment kinds", async () => {
    const routes = createFacilitatorRoutes();
    const supportedRoute = routes.find(r => r.path === "/supported");
    
    const req = createMockRequest("get", "/supported");
    const res = createMockResponse();
    
    await supportedRoute!.handler(req as any, res as any);
    
    const body = res.getJson() as { paymentKinds: unknown[] };
    expect(body.paymentKinds).toBeDefined();
    expect(Array.isArray(body.paymentKinds)).toBe(true);
    expect(body.paymentKinds.length).toBeGreaterThan(0);
    
    const first = body.paymentKinds[0] as { x402Version: number; scheme: string; network: string };
    expect(first.x402Version).toBe(1);
    expect(first.scheme).toBe("exact");
    expect(first.network).toBeDefined();
  });

  it("includes both EVM and Fast networks", async () => {
    const routes = createFacilitatorRoutes();
    const supportedRoute = routes.find(r => r.path === "/supported");
    
    const req = createMockRequest("get", "/supported");
    const res = createMockResponse();
    
    await supportedRoute!.handler(req as any, res as any);
    
    const body = res.getJson() as { paymentKinds: { network: string }[] };
    const networks = body.paymentKinds.map(k => k.network);
    
    expect(networks).toContain("arbitrum-sepolia");
    expect(networks).toContain("base-sepolia");
    expect(networks).toContain("fast-testnet");
    expect(networks).toContain("fast-mainnet");
  });
});

describe("POST /verify", () => {
  it("returns 400 for missing parameters", async () => {
    const routes = createFacilitatorRoutes();
    const verifyRoute = routes.find(r => r.path === "/verify");
    
    const req = createMockRequest("post", "/verify", {});
    const res = createMockResponse();
    
    await verifyRoute!.handler(req as any, res as any);
    
    expect(res.getStatus()).toBe(400);
    const body = res.getJson() as { isValid: boolean; invalidReason: string };
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("missing_parameters");
  });

  it("handles base64 encoded payload", async () => {
    const recipient = new Uint8Array(32).fill(0xbb);
    const tokenId = new Uint8Array(32);
    tokenId.set([0x1b, 0x48, 0x76, 0x61], 0);
    const certificate = createFastCertificate(recipient, "1000000000000000000", tokenId);
    const routes = createFacilitatorRoutes(fastRouteConfig(certificate, "fast-testnet"));
    const verifyRoute = routes.find(r => r.path === "/verify");
    
    const payloadObj = {
      x402Version: 1,
      scheme: "exact",
      network: "fast-testnet",
      payload: {
        transactionCertificate: certificate,
      },
    };
    
    const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64");
    
    const req = createMockRequest("post", "/verify", {
      paymentPayload: payloadBase64,
      paymentRequirements: {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: "1000000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: bytesToHex(recipient),
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      },
    });
    const res = createMockResponse();
    
    await verifyRoute!.handler(req as any, res as any);
    
    const body = res.getJson() as { isValid: boolean };
    expect(body.isValid).toBe(true);
  });

  it("handles decoded payload object", async () => {
    const recipient = new Uint8Array(32).fill(0xcc);
    const tokenId = new Uint8Array(32);
    tokenId.set([0x1b, 0x48, 0x76, 0x61], 0);
    const certificate = createFastCertificate(recipient, "2000000000000000000", tokenId);
    const routes = createFacilitatorRoutes(fastRouteConfig(certificate, "fast-testnet"));
    const verifyRoute = routes.find(r => r.path === "/verify");
    
    const req = createMockRequest("post", "/verify", {
      paymentPayload: {
        x402Version: 1,
        scheme: "exact",
        network: "fast-testnet",
        payload: {
          transactionCertificate: certificate,
        },
      },
      paymentRequirements: {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: "1000000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: bytesToHex(recipient),
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      },
    });
    const res = createMockResponse();
    
    await verifyRoute!.handler(req as any, res as any);
    
    const body = res.getJson() as { isValid: boolean };
    expect(body.isValid).toBe(true);
  });

  it("uses fastRpcUrl override when verifying through the server", async () => {
    const recipient = new Uint8Array(32).fill(0xcc);
    const tokenId = new Uint8Array(32);
    tokenId.set([0x1b, 0x48, 0x76, 0x61], 0);
    const certificate = createFastCertificate(recipient, "2000000000000000000", tokenId, "fast-mainnet");
    const routes = createFacilitatorRoutes(fastRouteConfig(certificate, "fast-mainnet", {
      fastRpcUrl: "https://custom.fast.example/proxy",
    }));
    const verifyRoute = routes.find(r => r.path === "/verify");

    const req = createMockRequest("post", "/verify", {
      paymentPayload: {
        x402Version: 1,
        scheme: "exact",
        network: "fast-mainnet",
        payload: {
          transactionCertificate: certificate,
        },
      },
      paymentRequirements: {
        scheme: "exact",
        network: "fast-mainnet",
        maxAmountRequired: "1000000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: bytesToHex(recipient),
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      },
    });
    const res = createMockResponse();

    await verifyRoute!.handler(req as any, res as any);

    const body = res.getJson() as { isValid: boolean };
    expect(body.isValid).toBe(true);
    expect(lastFetchUrl).toBe("https://custom.fast.example/proxy");
  });

  it("returns 400 for invalid base64", async () => {
    const routes = createFacilitatorRoutes();
    const verifyRoute = routes.find(r => r.path === "/verify");
    
    const req = createMockRequest("post", "/verify", {
      paymentPayload: "not-valid-base64!!!",
      paymentRequirements: {},
    });
    const res = createMockResponse();
    
    await verifyRoute!.handler(req as any, res as any);
    
    expect(res.getStatus()).toBe(400);
    const body = res.getJson() as { isValid: boolean; invalidReason: string };
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("invalid_payload_encoding");
  });
});

describe("POST /settle", () => {
  it("returns 400 for missing parameters", async () => {
    const routes = createFacilitatorRoutes();
    const settleRoute = routes.find(r => r.path === "/settle");
    
    const req = createMockRequest("post", "/settle", {});
    const res = createMockResponse();
    
    await settleRoute!.handler(req as any, res as any);
    
    expect(res.getStatus()).toBe(400);
    const body = res.getJson() as { success: boolean; errorReason: string };
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe("missing_parameters");
  });

  it("succeeds for Fast (no-op settlement)", async () => {
    const recipient = new Uint8Array(32).fill(0xee);
    const tokenId = new Uint8Array(32);
    tokenId.set([0x1b, 0x48, 0x76, 0x61], 0);
    const certificate = createFastCertificate(recipient, "3000000000000000000", tokenId);
    const routes = createFacilitatorRoutes(fastRouteConfig(certificate, "fast-testnet"));
    const settleRoute = routes.find(r => r.path === "/settle");
    
    const req = createMockRequest("post", "/settle", {
      paymentPayload: {
        x402Version: 1,
        scheme: "exact",
        network: "fast-testnet",
        payload: {
          transactionCertificate: certificate,
        },
      },
      paymentRequirements: {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: "1000000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: bytesToHex(recipient),
        maxTimeoutSeconds: 60,
        asset: bytesToHex(tokenId),
      },
    });
    const res = createMockResponse();
    
    await settleRoute!.handler(req as any, res as any);
    
    const body = res.getJson() as { success: boolean; transaction?: string };
    expect(body.success).toBe(true);
    expect(body.transaction).toBeDefined();
  });

  it("rejects invalid Fast certificates during settlement", async () => {
    const routes = createFacilitatorRoutes();
    const settleRoute = routes.find(r => r.path === "/settle");

    const req = createMockRequest("post", "/settle", {
      paymentPayload: {
        x402Version: 1,
        scheme: "exact",
        network: "fast-testnet",
        payload: {
          transactionCertificate: {
            envelope: "0x1234",
            signatures: [
              [new Array(32).fill(0xaa), new Array(64).fill(0xbb)],
            ],
          },
        },
      },
      paymentRequirements: {
        scheme: "exact",
        network: "fast-testnet",
        maxAmountRequired: "1000000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: "0x" + "ee".repeat(32),
        maxTimeoutSeconds: 60,
        asset: "0x" + "11".repeat(32),
      },
    });
    const res = createMockResponse();

    await settleRoute!.handler(req as any, res as any);

    const body = res.getJson() as { success: boolean; errorReason?: string };
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe("unsupported_fast_certificate_format");
  });

  it("fails for EVM without private key configured", async () => {
    const routes = createFacilitatorRoutes();
    const settleRoute = routes.find(r => r.path === "/settle");
    
    const req = createMockRequest("post", "/settle", {
      paymentPayload: {
        x402Version: 1,
        scheme: "exact",
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
      },
      paymentRequirements: {
        scheme: "exact",
        network: "arbitrum-sepolia",
        maxAmountRequired: "100000",
        resource: "/api/data",
        description: "Test",
        mimeType: "application/json",
        payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 60,
        asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      },
    });
    const res = createMockResponse();
    
    await settleRoute!.handler(req as any, res as any);
    
    const body = res.getJson() as { success: boolean; errorReason?: string };
    expect(body.success).toBe(false);
    expect(body.errorReason).toBeDefined();
  });
});

describe("createFacilitatorServer", () => {
  it("creates middleware that handles routes", async () => {
    const middleware = createFacilitatorServer();
    
    const req = createMockRequest("get", "/supported");
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    
    await middleware(req as any, res as any, next);
    
    expect(nextCalled).toBe(false);
    const body = res.getJson() as { paymentKinds: unknown[] };
    expect(body.paymentKinds).toBeDefined();
  });

  it("calls next() for non-matching routes", async () => {
    const middleware = createFacilitatorServer();
    
    const req = createMockRequest("get", "/unknown-route");
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    
    await middleware(req as any, res as any, next);
    
    expect(nextCalled).toBe(true);
  });
});
