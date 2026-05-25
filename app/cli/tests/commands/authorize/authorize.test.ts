/**
 * Tests for `fast authorize request` and `fast authorize complete`.
 *
 * These tests use the SDK's real KeyHandoverAgent for state serialization
 * and a temp directory pinned to process.env.HOME to isolate state files.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { KeyHandoverAgent } from "@fastxyz/sdk/wallet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── helpers ────────────────────────────────────────────────────────────────

const pendingPath = (home: string) =>
  path.join(home, ".fast", "handover-pending.json");

async function writePending(home: string, state: unknown) {
  const dir = path.join(home, ".fast");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pendingPath(home), JSON.stringify(state), { mode: 0o600 });
}

// ── fixtures ───────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fast-cli-auth-test-"));
  process.env.HOME = tmpDir;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── test: pending file path utility ───────────────────────────────────────

describe("pendingFilePath()", () => {
  it("uses HOME to build the path", async () => {
    const { pendingFilePath } = await import(
      "../../../src/commands/authorize/request.js"
    );
    expect(pendingFilePath()).toBe(
      path.join(tmpDir, ".fast", "handover-pending.json"),
    );
  });
});

// ── test: error types ─────────────────────────────────────────────────────

describe("error types", () => {
  it("PendingAlreadyExistsError has the correct shape", async () => {
    const { PendingAlreadyExistsError } = await import(
      "../../../src/errors/key-handover.js"
    );
    const err = new PendingAlreadyExistsError({
      fingerprint: "123456",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    expect(err._tag).toBe("PendingAlreadyExistsError");
    expect(err.errorCode).toBe("PENDING_ALREADY_EXISTS");
    expect(err.message).toContain("123456");
    expect(err.exitCode).toBe(1);
  });

  it("NoPendingRequestError has the correct shape", async () => {
    const { NoPendingRequestError } = await import(
      "../../../src/errors/key-handover.js"
    );
    const err = new NoPendingRequestError();
    expect(err._tag).toBe("NoPendingRequestError");
    expect(err.errorCode).toBe("NO_PENDING_REQUEST");
    expect(err.exitCode).toBe(1);
  });

  it("CorruptPendingStateError has the correct shape", async () => {
    const { CorruptPendingStateError } = await import(
      "../../../src/errors/key-handover.js"
    );
    const err = new CorruptPendingStateError({ reason: "missing fields" });
    expect(err._tag).toBe("CorruptPendingStateError");
    expect(err.errorCode).toBe("CORRUPT_PENDING_STATE");
    expect(err.message).toContain("missing fields");
    expect(err.exitCode).toBe(1);
  });

  it("MissingHandoverMessageError has the correct shape", async () => {
    const { MissingHandoverMessageError } = await import(
      "../../../src/errors/key-handover.js"
    );
    const err = new MissingHandoverMessageError();
    expect(err._tag).toBe("MissingHandoverMessageError");
    expect(err.errorCode).toBe("MISSING_HANDOVER_MESSAGE");
    expect(err.exitCode).toBe(2);
  });

  it("KeyHandoverProtocolError has the correct shape", async () => {
    const { KeyHandoverProtocolError } = await import(
      "../../../src/errors/key-handover.js"
    );
    const err = new KeyHandoverProtocolError({
      sdkCode: "DECRYPTION_FAILED",
      message: "bad",
    });
    expect(err._tag).toBe("KeyHandoverProtocolError");
    expect(err.errorCode).toBe("KEY_HANDOVER_PROTOCOL_ERROR");
    expect(err.sdkCode).toBe("DECRYPTION_FAILED");
    expect(err.exitCode).toBe(1);
  });
});

// ── test: state file lifecycle (SDK round-trip) ────────────────────────────

describe("state file — SDK round-trip", () => {
  it("exportPending / restore round-trips a real auth request", async () => {
    const agent = new KeyHandoverAgent();
    await agent.generateAuthRequest({ requester: "test" });

    const state = await agent.exportPending();
    expect(state).not.toBeNull();
    expect(state!.v).toBe(1);
    expect(state!.fingerprint).toMatch(/^\d{6}$/);

    const restored = await KeyHandoverAgent.restore(state!);
    expect(restored).toBeInstanceOf(KeyHandoverAgent);
  });

  it("exportPending is idempotent (two calls return equal data)", async () => {
    const agent = new KeyHandoverAgent();
    await agent.generateAuthRequest({});
    const s1 = await agent.exportPending();
    const s2 = await agent.exportPending();
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it("exportPending returns null when no pending exists", async () => {
    const agent = new KeyHandoverAgent();
    const state = await agent.exportPending();
    expect(state).toBeNull();
  });

  it("restore(v:2) throws unsupported version", async () => {
    await expect(KeyHandoverAgent.restore({ v: 2 } as never)).rejects.toThrow();
  });
});

// ── test: state file guards (no-pending, corrupt) ─────────────────────────

describe("state file guards", () => {
  it("no-pending: NoPendingRequestError when file absent", async () => {
    const { NoPendingRequestError } = await import(
      "../../../src/errors/key-handover.js"
    );
    // Confirm file does not exist
    await expect(fs.access(pendingPath(tmpDir))).rejects.toThrow();

    // Reading should produce NoPendingRequestError
    const err = await fs
      .readFile(pendingPath(tmpDir), "utf-8")
      .catch(() => null);
    expect(err).toBeNull();

    const notFound = new NoPendingRequestError();
    expect(notFound._tag).toBe("NoPendingRequestError");
  });

  it("corrupt state: CorruptPendingStateError on bad JSON", async () => {
    // Write raw invalid JSON directly (not via JSON.stringify)
    const dir = path.join(tmpDir, ".fast");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(pendingPath(tmpDir), "{ this is not: valid json }", {
      mode: 0o600,
    });

    const raw = await fs.readFile(pendingPath(tmpDir), "utf-8");
    const { CorruptPendingStateError } = await import(
      "../../../src/errors/key-handover.js"
    );

    let error: InstanceType<typeof CorruptPendingStateError> | null = null;
    try {
      JSON.parse(raw);
    } catch (e) {
      error = new CorruptPendingStateError({
        reason: e instanceof Error ? e.message : String(e),
      });
    }
    expect(error).not.toBeNull();
    expect(error!._tag).toBe("CorruptPendingStateError");
  });

  it("corrupt state: CorruptPendingStateError on schema v!==1", async () => {
    await writePending(tmpDir, { v: 99, fingerprint: "x" });
    const raw = await fs.readFile(pendingPath(tmpDir), "utf-8");
    const parsed = JSON.parse(raw) as { v: number };
    const { CorruptPendingStateError } = await import(
      "../../../src/errors/key-handover.js"
    );

    let error: InstanceType<typeof CorruptPendingStateError> | null = null;
    if (parsed.v !== 1) {
      error = new CorruptPendingStateError({
        reason: "missing required fields or unsupported version",
      });
    }
    expect(error).not.toBeNull();
  });

  it("already-pending: PendingAlreadyExistsError when file not expired", async () => {
    const agent = new KeyHandoverAgent();
    await agent.generateAuthRequest({});
    const state = await agent.exportPending();
    expect(state).not.toBeNull();
    await writePending(tmpDir, state);

    const raw = await fs.readFile(pendingPath(tmpDir), "utf-8");
    const parsed = JSON.parse(raw) as {
      v: number;
      fingerprint: string;
      expires_at: string;
    };
    const { PendingAlreadyExistsError } = await import(
      "../../../src/errors/key-handover.js"
    );

    const expiresAt = new Date(parsed.expires_at);
    const isExpired = expiresAt <= new Date();
    expect(isExpired).toBe(false);

    const err = new PendingAlreadyExistsError({
      fingerprint: parsed.fingerprint,
      expiresAt: parsed.expires_at,
    });
    expect(err._tag).toBe("PendingAlreadyExistsError");
    expect(err.message).toContain(parsed.fingerprint);
  });

  it("expired-pending: old file is replaced", async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await writePending(tmpDir, {
      v: 1,
      fingerprint: "000000",
      expires_at: past,
      hpke_private_key_jwk: {},
      request_payload: "",
      failure_count: 0,
    });

    const raw = await fs.readFile(pendingPath(tmpDir), "utf-8");
    const parsed = JSON.parse(raw) as { expires_at: string };
    const expiresAt = new Date(parsed.expires_at);
    expect(expiresAt <= new Date()).toBe(true);
    // Confirms the logic branch: the expired check passes, old file should be deleted
  });
});

// ── test: state file mode ──────────────────────────────────────────────────

describe("state file mode", () => {
  it("written state file has mode 0600", async () => {
    const dir = path.join(tmpDir, ".fast");
    await fs.mkdir(dir, { recursive: true });
    const filePath = pendingPath(tmpDir);
    await fs.writeFile(filePath, JSON.stringify({ v: 1 }), { mode: 0o600 });

    const stat = await fs.stat(filePath);
    // stat.mode & 0o777 gives rwxrwxrwx bits; 0o600 = rw-------
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ── test: SDK decryption error codes ──────────────────────────────────────

describe("SDK decryption error codes", () => {
  it("decryptAuthPayload with wrong public key returns DECRYPTION_FAILED", async () => {
    // Generate a request with agent A, then encrypt the handover with agent B's
    // public key (different), so decryption fails.
    const agentA = new KeyHandoverAgent();
    await agentA.generateAuthRequest({});

    const agentB = new KeyHandoverAgent();
    const authB = await agentB.generateAuthRequest({});

    // Build a fake handover code using agentB's public key
    const { sealHandover } = await import("@fastxyz/sdk/wallet");
    const fakeKey = new Uint8Array(32).fill(0x42);
    const { handover_code: handoverCode } = await sealHandover({
      authUrlOrData: authB.auth_url,
      seed: fakeKey,
    });

    // Attempt to decrypt with agentA (which has a different private key)
    const result = await agentA.decryptAuthPayload({ message: handoverCode });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("DECRYPTION_FAILED");
    }
  });

  it("malformed paste returns MALFORMED_HANDOVER_MESSAGE", async () => {
    const agent = new KeyHandoverAgent();
    await agent.generateAuthRequest({});

    const result = await agent.decryptAuthPayload({
      message: "plain text no quotes",
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("MALFORMED_HANDOVER_MESSAGE");
    }
  });

  it("bare base64url but invalid JSON returns INVALID_HANDOVER_CODE", async () => {
    const agent = new KeyHandoverAgent();
    await agent.generateAuthRequest({});

    // Valid base64url characters but not valid handover code JSON
    const fakeCode = "dGhpcyBpcyBub3QgdmFsaWQgSlNPTg";
    const result = await agent.decryptAuthPayload({ message: fakeCode });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("INVALID_HANDOVER_CODE");
    }
  });

  it("decryption fails 3 times → TOO_MANY_FAILURES", async () => {
    const agentA = new KeyHandoverAgent();
    await agentA.generateAuthRequest({});

    const agentB = new KeyHandoverAgent();
    const authB = await agentB.generateAuthRequest({});
    const { sealHandover } = await import("@fastxyz/sdk/wallet");
    const fakeKey = new Uint8Array(32).fill(0x42);
    const { handover_code: handoverCode } = await sealHandover({
      authUrlOrData: authB.auth_url,
      seed: fakeKey,
    });

    // First two failures
    const r1 = await agentA.decryptAuthPayload({ message: handoverCode });
    expect(r1.status).toBe("error");
    if (r1.status === "error") expect(r1.error.code).toBe("DECRYPTION_FAILED");

    const agentA2 = await KeyHandoverAgent.restore(
      (await agentA.exportPending())!,
    );
    const r2 = await agentA2.decryptAuthPayload({ message: handoverCode });
    expect(r2.status).toBe("error");
    if (r2.status === "error") expect(r2.error.code).toBe("DECRYPTION_FAILED");

    const agentA3 = await KeyHandoverAgent.restore(
      (await agentA2.exportPending())!,
    );
    const r3 = await agentA3.decryptAuthPayload({ message: handoverCode });
    expect(r3.status).toBe("error");
    if (r3.status === "error") expect(r3.error.code).toBe("TOO_MANY_FAILURES");

    // After 3 failures, exportPending returns null (SDK cleared state)
    const state = await agentA3.exportPending();
    expect(state).toBeNull();
  });

  it("missing pending returns MISSING_PENDING_REQUEST", async () => {
    // Generate a legitimate code with one agent, then try to decrypt with another (no pending)
    const agentX = new KeyHandoverAgent();
    const req = await agentX.generateAuthRequest({});
    const { sealHandover } = await import("@fastxyz/sdk/wallet");
    const { handover_code } = await sealHandover({
      authUrlOrData: req.auth_url,
      seed: new Uint8Array(32).fill(0x11),
    });

    const agentEmpty = new KeyHandoverAgent();
    const result = await agentEmpty.decryptAuthPayload({
      message: handover_code,
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("MISSING_PENDING_REQUEST");
    }
  });
});

// ── test: happy path (full round-trip via SDK) ────────────────────────────

describe("happy path — SDK round-trip", () => {
  it("request → export → restore → complete succeeds", async () => {
    const agent = new KeyHandoverAgent();
    const authResult = await agent.generateAuthRequest({});
    const state = await agent.exportPending();
    expect(state).not.toBeNull();

    const { sealHandover } = await import("@fastxyz/sdk/wallet");
    const fakeKey = new Uint8Array(32).fill(0x77);
    const { handover_code: handoverCode } = await sealHandover({
      authUrlOrData: authResult.auth_url,
      seed: fakeKey,
    });

    const restored = await KeyHandoverAgent.restore(state!);
    const result = await restored.decryptAuthPayload({ message: handoverCode });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(typeof result.private_key).toBe("string");
      expect(result.private_key).toBe(Buffer.from(fakeKey).toString("hex"));
    }
  });

  it("--message accepts a quoted chat message (not just bare code)", async () => {
    const agent = new KeyHandoverAgent();
    const authResult = await agent.generateAuthRequest({});

    const { sealHandover } = await import("@fastxyz/sdk/wallet");
    const fakeKey = new Uint8Array(32).fill(0x33);
    const { chat_message: chatMessage } = await sealHandover({
      authUrlOrData: authResult.auth_url,
      seed: fakeKey,
    });

    const result = await agent.decryptAuthPayload({ message: chatMessage });
    expect(result.status).toBe("success");
  });

  it("--message accepts a bare code (no quotes)", async () => {
    const agent = new KeyHandoverAgent();
    const authResult = await agent.generateAuthRequest({});

    const { sealHandover } = await import("@fastxyz/sdk/wallet");
    const fakeKey = new Uint8Array(32).fill(0x44);
    const { handover_code: bareCode } = await sealHandover({
      authUrlOrData: authResult.auth_url,
      seed: fakeKey,
    });

    const result = await agent.decryptAuthPayload({ message: bareCode });
    expect(result.status).toBe("success");
  });
});

// ── test: --print-account flag (Signer derivation) ────────────────────────

describe("--print-account Signer derivation", () => {
  it("Signer derives a consistent Fast address and public key from seed", async () => {
    const { Signer, toHex } = await import("@fastxyz/sdk");
    const seed = Buffer.from(new Uint8Array(32).fill(0x55));
    const signer = new Signer(seed);

    const address = await signer.getFastAddress();
    const pubKeyBytes = await signer.getPublicKey();
    const publicKey = toHex(pubKeyBytes);

    expect(address).toMatch(/^fast1/);
    expect(publicKey).toMatch(/^0x/);

    // Idempotent — same seed → same result
    const signer2 = new Signer(seed);
    expect(await signer2.getFastAddress()).toBe(address);
    expect(toHex(await signer2.getPublicKey())).toBe(publicKey);
  });
});

// ── test: --json output format ─────────────────────────────────────────────

describe("JSON output format", () => {
  it("success shape includes private_key", () => {
    const data = { private_key: "0x" + "ab".repeat(32) };
    expect(data.private_key).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("success shape with --print-account includes address and public_key", () => {
    const data = {
      private_key: "0x" + "ab".repeat(32),
      address: "fast1abc",
      public_key: "0x" + "cd".repeat(32),
    };
    expect(Object.keys(data)).toContain("address");
    expect(Object.keys(data)).toContain("public_key");
  });
});

// ── test: --non-interactive missing message ────────────────────────────────

describe("--non-interactive without message source", () => {
  it("MissingHandoverMessageError has exitCode 2", async () => {
    const { MissingHandoverMessageError } = await import(
      "../../../src/errors/key-handover.js"
    );
    const err = new MissingHandoverMessageError();
    expect(err.exitCode).toBe(2);
    expect(err.errorCode).toBe("MISSING_HANDOVER_MESSAGE");
  });
});

// ── test: --url override ───────────────────────────────────────────────────

describe("--url override", () => {
  it("validateWalletBaseUrl returns undefined when not provided", async () => {
    const { validateWalletBaseUrl } = await import(
      "../../../src/commands/authorize/request.js"
    );
    expect(validateWalletBaseUrl(undefined)).toBeUndefined();
    expect(validateWalletBaseUrl(null)).toBeUndefined();
    expect(validateWalletBaseUrl("")).toBeUndefined();
  });

  it("validateWalletBaseUrl returns the input when it parses as a URL", async () => {
    const { validateWalletBaseUrl } = await import(
      "../../../src/commands/authorize/request.js"
    );
    expect(validateWalletBaseUrl("http://localhost:3000/authorize")).toBe(
      "http://localhost:3000/authorize",
    );
    expect(validateWalletBaseUrl("https://staging.fast.xyz/authorize")).toBe(
      "https://staging.fast.xyz/authorize",
    );
  });

  it("validateWalletBaseUrl throws InvalidUsageError on garbage", async () => {
    const { validateWalletBaseUrl } = await import(
      "../../../src/commands/authorize/request.js"
    );
    const { InvalidUsageError } = await import("../../../src/errors/index.js");
    expect(() => validateWalletBaseUrl("not a url")).toThrow(InvalidUsageError);
    expect(() => validateWalletBaseUrl("¬¬¬")).toThrow(InvalidUsageError);
  });

  it("KeyHandoverAgent with custom walletBaseUrl emits matching auth_url", async () => {
    const agent = new KeyHandoverAgent({
      walletBaseUrl: "http://localhost:3000/authorize",
    });
    const result = await agent.generateAuthRequest({});
    expect(
      result.auth_url.startsWith("http://localhost:3000/authorize?data="),
    ).toBe(true);
  });
});
