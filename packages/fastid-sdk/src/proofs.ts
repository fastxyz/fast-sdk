/*
 * Ported against the public proof flows in fastset-id-web/src/components/ProofFirstClaim.tsx,
 * fastset-id-web/src/lib/social-intent.ts, and the matching app/api route forwarders.
 */
import { isCanonicalClaimValue } from "./claim-data.js";
import type { ClaimService, RegisteredClaim } from "./claims.js";
import {
  InsufficientFundsError,
  InvalidProofInputError,
  LocalVerificationError,
  NonceConflictError,
  OAuthProofTimeoutError,
  OAuthProofUnavailableError,
  ProofProtocolError,
  ProofWaitCancelledError,
  PreSubmitError,
  RegistrationPendingError,
  WebsiteVerificationPendingError,
  XSettlementNotAuthorizedError,
} from "./errors.js";
import type { IdNetworkConfig } from "./networks.js";
import type { IdReads } from "./reads.js";
import type { Signer } from "./signer.js";
import { hexToBytes, verifyStrict } from "./verify.js";

export type OAuthProvider = "github" | "orcid";

function assertOAuthProvider(provider: unknown): asserts provider is OAuthProvider {
  if (provider !== "github" && provider !== "orcid") {
    throw new InvalidProofInputError(
      "oauth_provider",
      typeof provider === "string" ? provider : "",
    );
  }
}

export interface ProofWaitOptions {
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
}

export interface OAuthClaimInstructions {
  url: string;
  instructions: string;
}

export interface OAuthProofReady {
  available: true;
  provider: OAuthProvider;
  value: string;
  addressHex: string;
  network: string;
}

export interface WebsiteClaimInstructions {
  host: string;
  proofUrl: string;
  proofText: string;
  instructions: string;
  verifyAndSettle(options?: ProofWaitOptions): Promise<RegisteredClaim>;
}

interface WebsiteSettlement {
  txIdHex: string;
  nonce: string;
  pendingRegistration?: RegistrationPendingError;
  terminal?: RegisteredClaim;
}

export type XVerificationResult =
  | { verified: true; settlement?: "committed" | "applied" }
  | {
      verified: false;
      status: "failed" | "gone" | "unknown" | "retry" | "invalid" | "error" | "network_error";
      reason?: string;
      retryAfterSecs?: number;
    };

export interface XProofPost {
  text: string;
  composerUrl: string;
}

export interface XClaimSession {
  readonly status: "issued";
  readonly handle: string;
  readonly proofUrl: string;
  readonly nonce: string;
  readonly expiresAt: string;
  getProofPost(): XProofPost;
  verifyPost(postUrl: string): Promise<XVerificationResult>;
  settle(): Promise<RegisteredClaim | { status: "already-settled" }>;
}

export type XClaimStart = XClaimSession | { status: "already-settled" };

interface ProofServiceOptions {
  config: IdNetworkConfig;
  signer: Signer;
  reads: IdReads;
  claims: ClaimService;
  fetchImpl: typeof fetch;
}

function provesNoPaidAttempt(cause: unknown): boolean {
  return (
    cause instanceof PreSubmitError ||
    cause instanceof NonceConflictError ||
    cause instanceof InsufficientFundsError
  );
}

const SOCIAL_PROOF_DOMAIN = new TextEncoder().encode("fastid-social-proof-v2");
const SOCIAL_INTENT_DOMAIN = new TextEncoder().encode("fastid-social-intent-v1");
const SOCIAL_COMMIT_DOMAIN = new TextEncoder().encode("fastid-social-commit-v1");
const X_POST_LEAD_IN =
  "One identity across the Fast Network. Linking this account to my Fast ID:";
const INTENT_PROTOCOL = "intent-v1";
const MAX_TIMER_MS = 2_147_483_647;

interface SocialCommonFields {
  address: Uint8Array;
  network: string;
  kind: string;
  value: string;
  expiryUnixSecs: bigint;
  serverNonce: Uint8Array;
}

export interface SocialIntentMessageFields extends SocialCommonFields {
  replacesNonce?: Uint8Array;
}

export interface SocialCommitMessageFields extends SocialCommonFields {
  proofNonce: Uint8Array;
}

function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function u64be(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("expiry must fit u64");
  }
  const out = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeSocialCommon(domain: Uint8Array, fields: SocialCommonFields): Uint8Array[] {
  const encoder = new TextEncoder();
  const network = encoder.encode(fields.network);
  const kind = encoder.encode(fields.kind);
  const value = encoder.encode(fields.value);
  if (fields.address.length !== 32) throw new Error("address must be 32 bytes");
  if (fields.serverNonce.length !== 32) throw new Error("server_nonce must be 32 bytes");
  if (network.length > 0xff) throw new Error("network too long");
  if (kind.length > 0xff) throw new Error("kind too long");
  if (value.length > 0xffff) throw new Error("value too long");
  return [
    domain,
    fields.address,
    new Uint8Array([network.length]),
    network,
    new Uint8Array([kind.length]),
    kind,
    u16be(value.length),
    value,
    u64be(fields.expiryUnixSecs),
    fields.serverNonce,
  ];
}

export function encodeSocialIntentMessage(fields: SocialIntentMessageFields): Uint8Array {
  if (fields.replacesNonce !== undefined && fields.replacesNonce.length !== 16) {
    throw new Error("replaces_nonce must be 16 bytes");
  }
  return concat(
    ...encodeSocialCommon(SOCIAL_INTENT_DOMAIN, fields),
    fields.replacesNonce === undefined
      ? new Uint8Array([0])
      : concat(new Uint8Array([1]), fields.replacesNonce),
  );
}

export function encodeSocialProofMessage(fields: SocialIntentMessageFields): Uint8Array {
  if (fields.replacesNonce !== undefined && fields.replacesNonce.length !== 16) {
    throw new Error("replaces_nonce must be 16 bytes");
  }
  return concat(
    ...encodeSocialCommon(SOCIAL_PROOF_DOMAIN, fields),
    fields.replacesNonce === undefined
      ? new Uint8Array([0])
      : concat(new Uint8Array([1]), fields.replacesNonce),
  );
}

export function encodeSocialCommitMessage(fields: SocialCommitMessageFields): Uint8Array {
  if (fields.proofNonce.length !== 16) throw new Error("proof_nonce must be 16 bytes");
  return concat(
    ...encodeSocialCommon(SOCIAL_COMMIT_DOMAIN, fields),
    fields.proofNonce,
  );
}

function canonicalOAuth(provider: OAuthProvider, raw: string): string {
  assertOAuthProvider(provider);
  const value =
    provider === "github"
      ? raw
          .trim()
          .replace(/^https?:\/\/github\.com\//i, "")
          .replace(/\/.*$/, "")
          .toLowerCase()
      : raw
          .trim()
          .replace(/^https?:\/\/orcid\.org\//i, "")
          .replace(/x$/, "X");
  if (!isCanonicalClaimValue(provider, value)) {
    throw new InvalidProofInputError(provider, raw);
  }
  return value;
}

function canonicalWebsite(raw: string): string {
  let value = raw.trim().toLowerCase();
  try {
    if (value.includes("://")) value = new URL(value).hostname;
  } catch {
    // The canonical claim codec below remains the authority.
  }
  value = value.replace(/\/.*$/, "").replace(/\.$/, "");
  if (!isCanonicalClaimValue("website", value)) {
    throw new InvalidProofInputError("website", raw);
  }
  return value;
}

function canonicalX(raw: string): string {
  const value = raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  if (!isCanonicalClaimValue("x", value)) {
    throw new InvalidProofInputError("x", raw);
  }
  return value;
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProofWaitCancelledError();
}

function validateWaitOptions(options: ProofWaitOptions): void {
  if (
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > MAX_TIMER_MS
  ) {
    throw new RangeError(`proof timeoutMs must be between 1 and ${MAX_TIMER_MS}`);
  }
  if (
    !Number.isFinite(options.intervalMs) ||
    options.intervalMs < 0 ||
    options.intervalMs > MAX_TIMER_MS
  ) {
    throw new RangeError(
      `proof intervalMs must be between 0 and ${MAX_TIMER_MS}`,
    );
  }
}

function snapshotWaitOptions(options: ProofWaitOptions): ProofWaitOptions {
  const timeoutMs = options.timeoutMs;
  const intervalMs = options.intervalMs;
  const signal = options.signal;
  return Object.freeze({
    timeoutMs,
    intervalMs,
    ...(signal === undefined ? {} : { signal }),
  });
}

async function boundedWait<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: ProofWaitOptions,
  started: number,
  timeoutError: () => Error,
): Promise<T> {
  cancelled(options.signal);
  const remaining = options.timeoutMs - (Date.now() - started);
  if (remaining <= 0) throw timeoutError();

  const controller = new AbortController();
  let timedOut = false;
  let externallyCancelled = false;
  const onExternalAbort = () => {
    externallyCancelled = true;
    controller.abort();
  };
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(timedOut ? timeoutError() : new ProofWaitCancelledError()),
      { once: true },
    );
  });
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (options.signal?.aborted) onExternalAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, remaining);
  try {
    return await Promise.race([work(controller.signal), aborted]);
  } catch (cause) {
    if (timedOut) throw timeoutError();
    if (externallyCancelled || options.signal?.aborted) {
      throw new ProofWaitCancelledError();
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new ProofWaitCancelledError());
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function exactAvailable(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    Object.prototype.hasOwnProperty.call(body, "available") &&
    (body as { available?: unknown }).available === true
  );
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

interface Challenge {
  expiry: number;
  serverNonce: string;
}

async function challengeFor(
  config: IdNetworkConfig,
  signer: Signer,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Challenge> {
  cancelled(signal);
  let response: Response;
  try {
    response = await fetchImpl(`${config.idOrigin}/api/profile/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: signer.signerHex, network: config.networkId }),
      signal,
    });
  } catch (cause) {
    cancelled(signal);
    throw new ProofProtocolError("could not obtain a proof challenge", { cause });
  }
  const body = (await readJson(response)) as {
    expiry?: unknown;
    server_nonce?: unknown;
  } | null;
  if (
    response.status !== 200 ||
    body === null ||
    !Number.isSafeInteger(body.expiry) ||
    (body.expiry as number) < 0 ||
    typeof body.server_nonce !== "string" ||
    !/^[0-9a-f]{64}$/.test(body.server_nonce)
  ) {
    throw new ProofProtocolError("the proof challenge response was unusable");
  }
  return { expiry: body.expiry as number, serverNonce: body.server_nonce };
}

async function signLocallyVerified(signer: Signer, message: Uint8Array): Promise<string> {
  let signature: string;
  try {
    signature = await signer.sign(new Uint8Array(message));
  } catch (cause) {
    throw new ProofProtocolError("the proof message was not signed", { cause });
  }
  if (!verifyStrict(message, signature, signer.publicKey)) {
    throw new LocalVerificationError();
  }
  return signature;
}

class XSession implements XClaimSession {
  readonly status = "issued" as const;
  readonly #config: IdNetworkConfig;
  readonly #signer: Signer;
  readonly #claims: ClaimService;
  readonly #fetch: typeof fetch;
  readonly #protocol: typeof INTENT_PROTOCOL | null;
  #verification?: XVerificationResult;
  #settlement?: Promise<RegisteredClaim | { status: "already-settled" }>;

  constructor(
    dependencies: Pick<ProofServiceOptions, "config" | "signer" | "claims" | "fetchImpl">,
    readonly handle: string,
    readonly proofUrl: string,
    readonly nonce: string,
    readonly expiresAt: string,
    protocol: typeof INTENT_PROTOCOL | null,
  ) {
    this.#config = dependencies.config;
    this.#signer = dependencies.signer;
    this.#claims = dependencies.claims;
    this.#fetch = dependencies.fetchImpl;
    this.#protocol = protocol;
    Object.freeze(this);
  }

  getProofPost(): XProofPost {
    const text = `${X_POST_LEAD_IN}\n\n${this.proofUrl}`;
    return {
      text,
      composerUrl: `https://x.com/intent/post?${new URLSearchParams({ text }).toString()}`,
    };
  }

  #recordVerification(result: XVerificationResult): XVerificationResult {
    if (
      !this.#verification?.verified ||
      this.#verification.settlement !== "applied"
    ) {
      this.#verification = result;
    }
    return { ...result };
  }

  async verifyPost(postUrl: string): Promise<XVerificationResult> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.idOrigin}/api/social/x/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof_nonce: this.nonce, post_url: postUrl }),
      });
    } catch {
      return this.#recordVerification({
        verified: false,
        status: "network_error",
      });
    }
    if (response.status === 404) {
      return this.#recordVerification({ verified: false, status: "unknown" });
    }
    if (response.status === 410) {
      return this.#recordVerification({ verified: false, status: "gone" });
    }
    if (response.status === 400) {
      return this.#recordVerification({ verified: false, status: "invalid" });
    }
    const body = (await readJson(response)) as Record<string, unknown> | null;
    if (response.status === 503) {
      const header = Number(response.headers.get("retry-after"));
      const retryAfterSecs =
        Number.isFinite(header) && header > 0
          ? header
          : typeof body?.retry_after === "number"
            ? body.retry_after
            : undefined;
      return this.#recordVerification(
        retryAfterSecs === undefined
          ? { verified: false, status: "retry" }
          : { verified: false, status: "retry", retryAfterSecs },
      );
    }
    if (response.status === 422) {
      return this.#recordVerification(
        body?.verified === false && typeof body.reason === "string"
          ? { verified: false, status: "failed", reason: body.reason }
          : { verified: false, status: "error" },
      );
    }
    if (response.status !== 200 || body?.verified !== true) {
      return this.#recordVerification({ verified: false, status: "error" });
    }
    const settlement =
      this.#protocol === INTENT_PROTOCOL &&
      (body.settlement === "committed" || body.settlement === "applied")
        ? body.settlement
        : undefined;
    return this.#recordVerification(
      settlement === undefined
        ? { verified: true }
        : { verified: true, settlement },
    );
  }

  async settle(): Promise<RegisteredClaim | { status: "already-settled" }> {
    if (this.#verification?.verified && this.#verification.settlement === "applied") {
      return { status: "already-settled" };
    }
    if (this.#settlement) return this.#settlement;
    if (!this.#verification?.verified) {
      throw new XSettlementNotAuthorizedError("the proof post has not been verified");
    }
    if (
      this.#verification.settlement === undefined &&
      this.#protocol === INTENT_PROTOCOL
    ) {
      throw new XSettlementNotAuthorizedError(
        "the verification omitted the committed/applied tag; only the legacy protocol may use /commit",
      );
    }
    const settlement = this.#settleOnce();
    this.#settlement = settlement;
    try {
      return await settlement;
    } catch (cause) {
      if (provesNoPaidAttempt(cause) && this.#settlement === settlement) {
        this.#settlement = undefined;
      }
      throw cause;
    }
  }

  async #settleOnce(): Promise<RegisteredClaim | { status: "already-settled" }> {
    if (this.#verification?.verified && this.#verification.settlement === "applied") {
      return { status: "already-settled" };
    }
    if (this.#verification?.verified && this.#verification.settlement === "committed") {
      return this.#claims.settleProvenProperty("x", this.handle);
    }
    await this.#commitLegacy();
    return this.#claims.settleProvenProperty("x", this.handle);
  }

  async #commitLegacy(): Promise<void> {
    const challenge = await challengeFor(this.#config, this.#signer, this.#fetch);
    if (!/^[0-9a-f]{32}$/.test(this.nonce)) {
      throw new XSettlementNotAuthorizedError("the proof nonce cannot be committed");
    }
    const message = encodeSocialCommitMessage({
      address: this.#signer.publicKey,
      network: this.#config.networkId,
      kind: "x",
      value: this.handle,
      expiryUnixSecs: BigInt(challenge.expiry),
      serverNonce: hexToBytes(challenge.serverNonce),
      proofNonce: hexToBytes(this.nonce),
    });
    const signature = await signLocallyVerified(this.#signer, message);
    const body = JSON.stringify({
      address: this.#signer.signerHex,
      network: this.#config.networkId,
      value: this.handle,
      expiry_unix_secs: challenge.expiry,
      server_nonce: challenge.serverNonce,
      signature,
      proof_nonce: this.nonce,
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#config.idOrigin}/api/social/x/commit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
      } catch (cause) {
        throw new XSettlementNotAuthorizedError(
          `the legacy /commit result is unknown: ${cause instanceof Error ? cause.message : "network error"}`,
        );
      }
      const answer = await readJson(response);
      if (
        response.status === 200 &&
        typeof answer === "object" &&
        answer !== null &&
        (answer as { committed?: unknown }).committed === true &&
        Object.keys(answer).length === 1
      ) {
        return;
      }
      if (response.status !== 429 || attempt === 3) {
        throw new XSettlementNotAuthorizedError(
          `legacy /commit did not confirm commitment (status ${response.status})`,
        );
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      const jsonRetry =
        typeof answer === "object" &&
        answer !== null &&
        typeof (answer as { retry_after?: unknown }).retry_after === "number"
          ? (answer as { retry_after: number }).retry_after
          : undefined;
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : jsonRetry;
      const waitMs = seconds === undefined ? 1_000 : seconds * 1_000;
      if (!Number.isFinite(waitMs) || waitMs > 15_000) {
        throw new XSettlementNotAuthorizedError(
          "legacy /commit remained indeterminate after rate limiting",
        );
      }
      await delay(waitMs);
    }
  }
}

export class ProofService {
  readonly #config: IdNetworkConfig;
  readonly #signer: Signer;
  readonly #reads: IdReads;
  readonly #claims: ClaimService;
  readonly #fetch: typeof fetch;
  readonly #oauthSettlements = new Map<string, Promise<RegisteredClaim>>();

  constructor(options: ProofServiceOptions) {
    this.#config = options.config;
    this.#signer = options.signer;
    this.#reads = options.reads;
    this.#claims = options.claims;
    this.#fetch = options.fetchImpl;
  }

  oauthClaimInstructions(provider: OAuthProvider): OAuthClaimInstructions {
    assertOAuthProvider(provider);
    return {
      url: `${this.#config.idOrigin}/claim/${provider}`,
      instructions:
        `Open this Fast ID claim page in the browser that will complete ${provider} authentication. ` +
        `Connect the same wallet identity as the SDK signer on ${this.#config.networkId}. ` +
        "The SDK does not receive the OAuth callback, code, token, or browser cookie; supply the known canonical identity when polling.",
    };
  }

  async waitForOAuthProof(
    provider: OAuthProvider,
    rawValue: string,
    options: ProofWaitOptions,
  ): Promise<OAuthProofReady> {
    const value = canonicalOAuth(provider, rawValue);
    const waitOptions = snapshotWaitOptions(options);
    validateWaitOptions(waitOptions);
    const started = Date.now();
    for (;;) {
      cancelled(waitOptions.signal);
      if (Date.now() - started >= waitOptions.timeoutMs) {
        throw new OAuthProofTimeoutError(provider, value);
      }
      if (
        await boundedWait(
          (signal) => this.#oauthProofAvailable(provider, value, signal),
          waitOptions,
          started,
          () => new OAuthProofTimeoutError(provider, value),
        )
      ) {
        return {
          available: true,
          provider,
          value,
          addressHex: this.#signer.signerHex,
          network: this.#config.networkId,
        };
      }
      const remaining = waitOptions.timeoutMs - (Date.now() - started);
      await delay(
        Math.min(Math.max(waitOptions.intervalMs, 0), Math.max(remaining, 0)),
        waitOptions.signal,
      );
    }
  }

  async settleOAuthClaim(
    provider: OAuthProvider,
    rawValue: string,
  ): Promise<RegisteredClaim> {
    const value = canonicalOAuth(provider, rawValue);
    const key = `${provider}:${value}`;
    const existing = this.#oauthSettlements.get(key);
    if (existing) return existing;
    const settlement = this.#settleOAuthOnce(provider, value);
    this.#oauthSettlements.set(key, settlement);
    try {
      return await settlement;
    } catch (cause) {
      if (
        provesNoPaidAttempt(cause) &&
        this.#oauthSettlements.get(key) === settlement
      ) {
        this.#oauthSettlements.delete(key);
      }
      throw cause;
    }
  }

  forgetOAuthSettlement(provider: OAuthProvider, rawValue: string): void {
    const value = canonicalOAuth(provider, rawValue);
    this.#oauthSettlements.delete(`${provider}:${value}`);
  }

  async #settleOAuthOnce(
    provider: OAuthProvider,
    value: string,
  ): Promise<RegisteredClaim> {
    let available = false;
    try {
      available = await this.#oauthProofAvailable(provider, value);
    } catch (cause) {
      throw new OAuthProofUnavailableError(provider, value, { cause });
    }
    if (!available) throw new OAuthProofUnavailableError(provider, value);
    return this.#claims.settleProvenProperty(provider, value);
  }

  claimWebsite(rawHost: string): WebsiteClaimInstructions {
    const host = canonicalWebsite(rawHost);
    let settlement: Promise<WebsiteSettlement> | undefined;
    let verified: RegisteredClaim | undefined;
    return {
      host,
      proofUrl: `https://${host}/.well-known/fastid`,
      proofText: `${this.#signer.address}\n`,
      instructions:
        `Publish a plain-text file at https://${host}/.well-known/fastid containing ` +
        `${this.#signer.address} on one line, and keep it published to remain verified.`,
      verifyAndSettle: (options = { timeoutMs: 60_000, intervalMs: 1_000 }) => {
        if (verified) return Promise.resolve(verified);
        let waitOptions: ProofWaitOptions;
        try {
          waitOptions = snapshotWaitOptions(options);
        } catch (cause) {
          return Promise.reject(cause);
        }
        if (!settlement) {
          try {
            validateWaitOptions(waitOptions);
            cancelled(waitOptions.signal);
          } catch (cause) {
            return Promise.reject(cause);
          }
          const attempt = this.#settleWebsite(host);
          settlement = attempt;
          void attempt.catch((cause) => {
            if (provesNoPaidAttempt(cause) && settlement === attempt) {
              settlement = undefined;
            }
          });
        }
        return this.#waitForWebsite(host, waitOptions, settlement).then((result) => {
          verified = result;
          return result;
        });
      },
    };
  }

  async startXClaim(rawHandle: string): Promise<XClaimStart> {
    const handle = canonicalX(rawHandle);
    let capability: unknown;
    try {
      const response = await this.#fetch(`${this.#config.idOrigin}/api/social/kinds`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      capability = response.status === 200 ? await readJson(response) : null;
    } catch {
      capability = null;
    }
    const kinds =
      typeof capability === "object" && capability !== null
        ? (capability as { kinds?: unknown }).kinds
        : undefined;
    const intentKinds =
      typeof capability === "object" && capability !== null
        ? (capability as { intent_kinds?: unknown }).intent_kinds
        : undefined;
    if (
      !Array.isArray(kinds) ||
      !kinds.every((kind) => typeof kind === "string") ||
      !kinds.includes("x")
    ) {
      throw new ProofProtocolError("X claims are not available on this network");
    }
    const intentEnabled =
      Array.isArray(intentKinds) &&
      intentKinds.every((kind) => typeof kind === "string") &&
      intentKinds.includes("x");
    const challenge = await challengeFor(this.#config, this.#signer, this.#fetch);
    const fields = {
      address: this.#signer.publicKey,
      network: this.#config.networkId,
      kind: "x",
      value: handle,
      expiryUnixSecs: BigInt(challenge.expiry),
      serverNonce: hexToBytes(challenge.serverNonce),
    };
    const message = intentEnabled
      ? encodeSocialIntentMessage(fields)
      : encodeSocialProofMessage(fields);
    const signature = await signLocallyVerified(this.#signer, message);
    const route = intentEnabled ? "intent" : "proof";
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.idOrigin}/api/social/x/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: this.#signer.signerHex,
          network: this.#config.networkId,
          value: handle,
          expiry_unix_secs: challenge.expiry,
          server_nonce: challenge.serverNonce,
          signature,
        }),
      });
    } catch (cause) {
      throw new ProofProtocolError(`X ${route} submission failed`, { cause });
    }
    const answer = (await readJson(response)) as Record<string, unknown> | null;
    if (response.status !== 200 || answer === null) {
      throw new ProofProtocolError(
        `X ${route} was refused with status ${response.status}`,
      );
    }
    if (
      intentEnabled &&
      answer.settlement === "applied" &&
      Object.keys(answer).length === 1
    ) {
      return { status: "already-settled" };
    }
    if (
      typeof answer.proof_url !== "string" ||
      typeof answer.nonce !== "string" ||
      !/^[0-9a-f]{32}$/.test(answer.nonce) ||
      typeof answer.expires_at !== "string"
    ) {
      throw new ProofProtocolError(`X ${route} returned an unusable proof receipt`);
    }
    const protocol =
      intentEnabled && answer.protocol === INTENT_PROTOCOL ? INTENT_PROTOCOL : null;
    return new XSession(
      {
        config: this.#config,
        signer: this.#signer,
        claims: this.#claims,
        fetchImpl: this.#fetch,
      },
      handle,
      answer.proof_url,
      answer.nonce,
      answer.expires_at,
      protocol,
    );
  }

  async #oauthProofAvailable(
    provider: OAuthProvider,
    value: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    cancelled(signal);
    const query = new URLSearchParams({
      address: this.#signer.signerHex,
      kind: provider,
      value,
    });
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#config.idOrigin}/api/oauth/proof-available?${query}`,
        { signal },
      );
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return false;
    }
    const body = await readJson(response);
    cancelled(signal);
    return response.status === 200 && exactAvailable(body);
  }

  async #settleWebsite(host: string): Promise<WebsiteSettlement> {
    try {
      const settled = await this.#claims.settleProvenProperty("website", host);
      return {
        txIdHex: settled.txIdHex,
        nonce: settled.nonce,
        ...(settled.outcome === "verified" ? { terminal: settled } : {}),
      };
    } catch (cause) {
      if (!(cause instanceof RegistrationPendingError)) throw cause;
      return {
        txIdHex: cause.pending.txIdHex,
        nonce: cause.pending.nonce,
        pendingRegistration: cause,
      };
    }
  }

  async #waitForWebsite(
    host: string,
    options: ProofWaitOptions,
    settlement: Promise<WebsiteSettlement>,
  ): Promise<RegisteredClaim> {
    const state = await settlement;
    if (state.terminal) return state.terminal;
    validateWaitOptions(options);
    const { txIdHex, nonce, pendingRegistration } = state;

    const started = Date.now();
    try {
      for (;;) {
        cancelled(options.signal);
        try {
          const links = await boundedWait(
            (signal) => this.#reads.links(this.#signer.address, signal),
            options,
            started,
            () =>
              pendingRegistration ??
              new WebsiteVerificationPendingError(host, txIdHex, nonce),
          );
          if (
            links.address === this.#signer.address &&
            links.network === this.#config.networkId &&
            links.links.some(
              (link) =>
                link.kind === "website" &&
                link.value === host &&
                link.status === "verified" &&
                link.claim_tx === txIdHex,
            )
          ) {
            return {
              txIdHex,
              nonce,
              registration: "registered",
              outcome: "verified",
            };
          }
        } catch (cause) {
          if (
            cause instanceof ProofWaitCancelledError ||
            cause instanceof RegistrationPendingError ||
            cause instanceof WebsiteVerificationPendingError
          ) {
            throw cause;
          }
          // An unavailable read is absence of evidence and never a verified result.
        }
        if (Date.now() - started >= options.timeoutMs) {
          if (pendingRegistration) throw pendingRegistration;
          throw new WebsiteVerificationPendingError(host, txIdHex, nonce);
        }
        const remaining = options.timeoutMs - (Date.now() - started);
        await delay(Math.min(Math.max(options.intervalMs, 0), Math.max(remaining, 0)), options.signal);
      }
    } catch (cause) {
      if (cause instanceof ProofWaitCancelledError) {
        if (pendingRegistration) throw pendingRegistration;
        throw new WebsiteVerificationPendingError(host, txIdHex, nonce);
      }
      throw cause;
    }
  }
}
