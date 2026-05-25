import { bytesToHex } from "@noble/hashes/utils.js";
import { decodeBase64Url, encodeBase64Url } from "./crypto/base64url";
import { fingerprint } from "./crypto/fingerprint";
import {
  exportRecipientPublicKey,
  generateKeyPair,
  type HpkeKeyPair,
  hpkeOpen,
} from "./crypto/hpke";
import { ERROR } from "./errors";
import {
  decodeHandoverCode,
  extractSingleQuotedCandidate,
} from "./protocol/handover";
import { decodePlaintextSeed } from "./protocol/plaintext";
import { encodeRequest } from "./protocol/request";
import { type PendingRecord, PendingStore } from "./state/pending";

export interface SerializedPending {
  v: 1;
  hpke_private_key_jwk: JsonWebKey;
  request_payload: string;
  fingerprint: string;
  expires_at: string;
  failure_count: number;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DEFAULT_WALLET_BASE_URL = "https://app.fast.xyz/authorize";

export interface KeyHandoverAgentOptions {
  walletBaseUrl?: string;
  now?: () => Date;
}

export type DecryptResult =
  | { status: "success"; private_key: string }
  | { status: "error"; error: { code: string; message: string } };

export class KeyHandoverAgent {
  private readonly walletBaseUrl: string;
  private readonly now: () => Date;
  private readonly pending = new PendingStore(() => this.now());
  private currentKeyPair: HpkeKeyPair | null = null;

  constructor(opts: KeyHandoverAgentOptions = {}) {
    this.walletBaseUrl = opts.walletBaseUrl ?? DEFAULT_WALLET_BASE_URL;
    this.now = opts.now ?? (() => new Date());
  }

  async generateAuthRequest(input: { requester?: string } = {}): Promise<{
    auth_url: string;
    request_fingerprint: string;
    request_expires_at: string;
  }> {
    this.pending.clear();
    this.currentKeyPair = null;

    const keyPair = await generateKeyPair();
    const publicKey = await exportRecipientPublicKey(keyPair.publicKey);
    const expiresAt = toIsoSeconds(
      new Date(this.now().getTime() + FIVE_MINUTES_MS),
    );
    const { data, payloadBytes } = encodeRequest({
      publicKey,
      expiresAt,
      requester: input.requester,
    });
    const fp = fingerprint(payloadBytes);

    this.currentKeyPair = keyPair;
    this.pending.set({
      hpkePrivateKey: keyPair.privateKey,
      requestPayloadBytes: payloadBytes,
      fingerprint: fp,
      expiresAt,
    });

    return {
      auth_url: `${this.walletBaseUrl}?data=${data}`,
      request_fingerprint: fp,
      request_expires_at: expiresAt,
    };
  }

  async exportPending(): Promise<SerializedPending | null> {
    const record = this.pending.peek();
    if (!record || !this.currentKeyPair) return null;
    const jwk = await crypto.subtle.exportKey(
      "jwk",
      this.currentKeyPair.privateKey,
    );
    return {
      v: 1,
      hpke_private_key_jwk: jwk,
      request_payload: encodeBase64Url(record.requestPayloadBytes),
      fingerprint: record.fingerprint,
      expires_at: record.expiresAt,
      failure_count: record.failureCount,
    };
  }

  static async restore(
    state: SerializedPending,
    opts?: KeyHandoverAgentOptions,
  ): Promise<KeyHandoverAgent> {
    if (state.v !== 1) {
      throw new Error("unsupported serialized pending version");
    }
    if (
      !Number.isInteger(state.failure_count) ||
      state.failure_count < 0 ||
      state.failure_count >= 3
    ) {
      throw new Error(
        `invalid failure_count: ${state.failure_count} (must be integer in [0,2])`,
      );
    }
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      state.hpke_private_key_jwk,
      { name: "X25519" },
      true,
      ["deriveBits"],
    );
    const publicKeyJwk: JsonWebKey = {
      kty: state.hpke_private_key_jwk.kty,
      crv: state.hpke_private_key_jwk.crv,
      x: state.hpke_private_key_jwk.x,
    };
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "X25519" },
      true,
      [],
    );
    const requestPayloadBytes = decodeBase64Url(state.request_payload);
    const agent = new KeyHandoverAgent(opts);
    agent.currentKeyPair = { publicKey, privateKey };
    const record: PendingRecord = {
      hpkePrivateKey: privateKey,
      requestPayloadBytes,
      fingerprint: state.fingerprint,
      expiresAt: state.expires_at,
      state: "pending",
      failureCount: state.failure_count,
    };
    agent.pending.setRecord(record);
    return agent;
  }

  async decryptAuthPayload(input: { message: string }): Promise<DecryptResult> {
    let payload: { enc: Uint8Array; ciphertext: Uint8Array };
    try {
      const code = extractSingleQuotedCandidate(input.message);
      payload = decodeHandoverCode(code);
    } catch (err) {
      return errorFromMessage(err, ERROR.MALFORMED_HANDOVER_MESSAGE);
    }

    let record: { hpkePrivateKey: CryptoKey; requestPayloadBytes: Uint8Array };
    try {
      record = this.pending.beginConsuming();
    } catch (err) {
      return errorFromMessage(err);
    }

    let seed: Uint8Array;
    try {
      const plaintext = await hpkeOpen({
        recipientPrivateKey: record.hpkePrivateKey,
        enc: payload.enc,
        ciphertext: payload.ciphertext,
        aad: record.requestPayloadBytes,
      });
      seed = decodePlaintextSeed(plaintext);
    } catch (err) {
      const deleted = this.pending.recordFailure();
      if (deleted) this.currentKeyPair = null;
      return error(
        deleted ? ERROR.TOO_MANY_FAILURES : ERROR.DECRYPTION_FAILED,
        err,
      );
    }

    const privateKey = bytesToHex(seed);
    seed.fill(0);
    this.pending.clear();
    this.currentKeyPair = null;
    return { status: "success", private_key: privateKey };
  }
}

function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function error(code: string, cause: unknown): DecryptResult {
  return {
    status: "error",
    error: { code, message: messageOf(cause) },
  };
}

function errorFromMessage(
  cause: unknown,
  fallback: string = ERROR.MISSING_PENDING_REQUEST,
): DecryptResult {
  const message = messageOf(cause);
  const code = message.split(":")[0]?.trim() || fallback;
  return { status: "error", error: { code, message } };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
