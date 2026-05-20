import { Signer } from "../../interface/signer";
import {
  type HpkeKeyPair,
  exportRecipientPublicKey,
  generateKeyPair,
  hpkeOpen,
} from "./crypto/hpke";
import { fingerprint } from "./crypto/fingerprint";
import { ERROR } from "./errors";
import { decodeHandoverCode, extractSingleQuotedCandidate } from "./protocol/handover";
import { decodePlaintextSeed } from "./protocol/plaintext";
import { encodeRequest } from "./protocol/request";
import { type HandleInfo, HandleVault } from "./state/handles";
import { PendingStore } from "./state/pending";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DEFAULT_WALLET_BASE_URL = "https://app.fast.xyz/authorize";
const DEFAULT_HANDLE_TTL_MS = 30 * 60 * 1000;

export interface KeyHandoverAgentOptions {
  walletBaseUrl?: string;
  now?: () => Date;
  handleTtlMs?: number;
}

export type DecryptResult =
  | { status: "success"; authorization_handle: string }
  | { status: "error"; error: { code: string; message: string } };

export class KeyHandoverAgent {
  private readonly walletBaseUrl: string;
  private readonly now: () => Date;
  private readonly pending = new PendingStore(() => this.now());
  private readonly vault: HandleVault;
  private currentKeyPair: HpkeKeyPair | null = null;

  constructor(opts: KeyHandoverAgentOptions = {}) {
    this.walletBaseUrl = opts.walletBaseUrl ?? DEFAULT_WALLET_BASE_URL;
    this.now = opts.now ?? (() => new Date());
    this.vault = new HandleVault(
      opts.handleTtlMs ?? DEFAULT_HANDLE_TTL_MS,
      () => this.now(),
    );
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

  async decryptAuthPayload(input: { message: string }): Promise<DecryptResult> {
    let payload: { enc: Uint8Array; ciphertext: Uint8Array };
    try {
      const code = extractSingleQuotedCandidate(input.message);
      payload = decodeHandoverCode(code);
    } catch (err) {
      return error(ERROR.MALFORMED_HANDOVER_MESSAGE, err);
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

    let handle: string;
    try {
      const stored = await this.vault.store(seed);
      handle = stored.handle;
    } catch (err) {
      seed.fill(0);
      this.pending.clear();
      this.currentKeyPair = null;
      return error(ERROR.STORAGE_FAILED, err);
    }

    seed.fill(0);
    this.pending.clear();
    this.currentKeyPair = null;
    return { status: "success", authorization_handle: handle };
  }

  async signWithHandle(input: {
    authorization_handle: string;
    message: Uint8Array;
  }): Promise<{ signature: Uint8Array; address: string; publicKey: Uint8Array }> {
    const seed = this.vault.getSeed(input.authorization_handle);
    if (!seed) {
      throw new Error(
        `${ERROR.UNKNOWN_OR_DISPOSED_HANDLE}: unknown or disposed handle`,
      );
    }
    const signer = new Signer(seed);
    const signature = await signer.signMessage(input.message);
    const publicKey = await signer.getPublicKey();
    const address = await signer.getFastAddress();
    return { signature, address, publicKey };
  }

  disposeAuthorizationHandle(input: {
    authorization_handle: string;
  }): { status: "disposed" } {
    this.vault.dispose(input.authorization_handle);
    return { status: "disposed" };
  }

  getHandleInfo(handle: string): HandleInfo | null {
    return this.vault.getInfo(handle);
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

function errorFromMessage(cause: unknown): DecryptResult {
  const message = messageOf(cause);
  const code = message.split(":")[0]?.trim() || ERROR.MISSING_PENDING_REQUEST;
  return { status: "error", error: { code, message } };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
