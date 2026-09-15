import type { FastProvider } from "@fastxyz/sdk";

import {
  claimDataHex,
  encodeClaimDataV2,
  isClaimDataKind,
  type ClaimDataKind,
} from "./claim-data.js";
import { classifyPreflight, mayReachSettlement } from "./claim-preflight.js";
import {
  feeTokenForState,
  resolveClaimFee,
  type FeeSource,
} from "./claim-fee.js";
import {
  ClaimNotHeldError,
  FeeUnavailableError,
  IndeterminateSubmissionError,
  InsufficientFundsError,
  InvalidClaimError,
  InvalidPendingRegistrationError,
  LocalVerificationError,
  NameUnavailableError,
  NonceConflictError,
  NonceFetchError,
  PendingNetworkMismatchError,
  PreSubmitError,
  PropertyAlreadyClaimedError,
  RegistrationPendingError,
  RegistrationTerminalError,
  SigningError,
  type PendingRegistrationShape,
} from "./errors.js";
import type { IdNetworkConfig } from "./networks.js";
import type { IdReads } from "./reads.js";
import type { Signer } from "./signer.js";
import {
  buildExternalClaimBytes,
  getNextNonce,
  submitSignedClaim,
} from "./claim-tx.js";
import { verifyStrict } from "./verify.js";

export type ClaimablePropertyKind = "work";
export type RevocableClaimKind = Exclude<ClaimDataKind, "revoke">;

function isRevocableClaimKind(value: unknown): value is RevocableClaimKind {
  return isClaimDataKind(value) && value !== "revoke";
}

export type ProvenPropertyKind = "website" | "github" | "orcid" | "x";

export interface PendingRegistration extends PendingRegistrationShape {}

export interface RegisteredClaim {
  txIdHex: string;
  nonce: string;
  profileUrl?: string;
  registration: "registered";
  outcome: "applied" | "verified";
}

interface ClaimServiceOptions {
  config: IdNetworkConfig;
  signer: Signer;
  provider: FastProvider;
  reads: IdReads;
  feeSource: FeeSource;
  fetchImpl: typeof fetch;
}

function reasonOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const reason = (body as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

const LOWER_HEX_32 = /^[0-9a-f]{64}$/;
const I64_MAX_DECIMAL = "9223372036854775807";

function isProtocolNonce(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return false;
  const normalized = value.replace(/^0+(?=\d)/, "");
  return (
    normalized.length < I64_MAX_DECIMAL.length ||
    (normalized.length === I64_MAX_DECIMAL.length && normalized <= I64_MAX_DECIMAL)
  );
}

export function snapshotPendingRegistration(value: unknown): PendingRegistration {
  if (typeof value !== "object" || value === null) {
    throw new InvalidPendingRegistrationError(undefined, "record must be an object");
  }
  const callerOwned = value as Record<string, unknown>;
  let fields: Record<string, unknown>;
  try {
    fields = {
      op: callerOwned.op,
      network: callerOwned.network,
      addressHex: callerOwned.addressHex,
      name: callerOwned.name,
      kind: callerOwned.kind,
      value: callerOwned.value,
      nonce: callerOwned.nonce,
      txIdHex: callerOwned.txIdHex,
    };
  } catch {
    throw new InvalidPendingRegistrationError(
      undefined,
      "record properties could not be read",
    );
  }
  const {
    op,
    network,
    addressHex,
    name,
    kind,
    value: claimValue,
    nonce,
    txIdHex,
  } = fields;
  if (op !== "claim" && op !== "revoke") {
    throw new InvalidPendingRegistrationError(op, "unsupported operation");
  }
  if (typeof network !== "string" || network.length === 0) {
    throw new InvalidPendingRegistrationError(
      op,
      "network must be a non-empty string",
    );
  }
  if (typeof addressHex !== "string" || !LOWER_HEX_32.test(addressHex)) {
    throw new InvalidPendingRegistrationError(
      op,
      "addressHex must be 64-character lowercase hex",
    );
  }
  if (typeof txIdHex !== "string" || !LOWER_HEX_32.test(txIdHex)) {
    throw new InvalidPendingRegistrationError(
      op,
      "txIdHex must be 64-character lowercase hex",
    );
  }
  if (!isProtocolNonce(nonce)) {
    throw new InvalidPendingRegistrationError(
      op,
      "nonce must be a decimal string at most i64::MAX",
    );
  }
  if (name !== undefined && typeof name !== "string") {
    throw new InvalidPendingRegistrationError(
      op,
      "name must be a string when present",
    );
  }
  if (kind !== undefined && !isClaimDataKind(kind)) {
    throw new InvalidPendingRegistrationError(
      op,
      "kind is unsupported when present",
    );
  }
  if (claimValue !== undefined && typeof claimValue !== "string") {
    throw new InvalidPendingRegistrationError(
      op,
      "value must be a string when present",
    );
  }
  return {
    op,
    network,
    addressHex,
    ...(name !== undefined ? { name } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(claimValue !== undefined ? { value: claimValue } : {}),
    nonce,
    txIdHex,
  };
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class ClaimService {
  readonly #config: IdNetworkConfig;
  readonly #signer: Signer;
  readonly #provider: FastProvider;
  readonly #reads: IdReads;
  readonly #feeSource: FeeSource;
  readonly #fetch: typeof fetch;

  constructor(options: ClaimServiceOptions) {
    this.#config = options.config;
    this.#signer = options.signer;
    this.#provider = options.provider;
    this.#reads = options.reads;
    this.#feeSource = options.feeSource;
    this.#fetch = options.fetchImpl;
  }

  async claimName(name: string): Promise<RegisteredClaim> {
    let identity: Awaited<ReturnType<IdReads["identity"]>> | undefined;
    try {
      identity = await this.#reads.identity(this.#signer.address);
    } catch {
      identity = undefined;
    }
    if (
      identity?.address === this.#signer.address &&
      identity.network === this.#config.networkId &&
      identity.name !== undefined
    ) {
      throw new NameUnavailableError("address_already_named");
    }
    let availability: Awaited<ReturnType<IdReads["availability"]>> | "failed";
    try {
      availability = await this.#reads.availability(name);
    } catch {
      availability = "failed";
    }
    const verdict = classifyPreflight(availability, this.#config.networkId);
    if (!mayReachSettlement(verdict)) throw new NameUnavailableError(verdict);
    return this.#settle("claim", "name", name, { name });
  }

  async claimProperty(
    kind: ClaimablePropertyKind,
    value: string,
  ): Promise<RegisteredClaim> {
    if (kind !== "work") throw new InvalidClaimError();
    const status = await this.#reads.propertyClaimed(kind, value);
    if (status.claimed) throw new PropertyAlreadyClaimedError(kind, value);
    return this.#settle("claim", kind, value, { kind, value });
  }

  /**
   * Settlement entry used only after ProofService has established the external
   * proof gate. Proven claims are unavailable through public claim methods.
   */
  async settleProvenProperty(
    kind: ProvenPropertyKind,
    value: string,
  ): Promise<RegisteredClaim> {
    if (kind !== "x") {
      const status = await this.#reads.propertyClaimed(kind, value);
      if (status.claimed) throw new PropertyAlreadyClaimedError(kind, value);
    }
    return this.#settle("claim", kind, value, { kind, value });
  }

  importWork(doi: string): Promise<RegisteredClaim> {
    const canonical = doi
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
      .replace(/^doi:/, "");
    return this.claimProperty("work", canonical);
  }

  async revoke(kind: RevocableClaimKind, value: string): Promise<RegisteredClaim> {
    if (!isRevocableClaimKind(kind)) {
      throw new ClaimNotHeldError(kind, value);
    }
    const claimTx = await this.#claimTransactionForRevoke(kind, value);
    return this.#settle("revoke", "revoke", claimTx, {
      kind,
      value,
    });
  }

  async #claimTransactionForRevoke(
    kind: RevocableClaimKind,
    value: string,
  ): Promise<string> {
    const validTx = (candidate: unknown): candidate is string =>
      typeof candidate === "string" && /^[0-9a-f]{64}$/.test(candidate);
    try {
      if (kind === "name") {
        const identity = await this.#reads.identity(this.#signer.address);
        if (
          identity.address === this.#signer.address &&
          identity.network === this.#config.networkId &&
          identity.name === value &&
          validTx(identity.name_claim_tx)
        ) {
          return identity.name_claim_tx;
        }
      } else if (kind === "work") {
        const document = await this.#reads.resolve(this.#signer.address);
        if (
          document.address === this.#signer.address &&
          document.network === this.#config.networkId &&
          Array.isArray(document.imported_works)
        ) {
          const held = document.imported_works.find(
            (work) =>
              typeof work === "object" &&
              work !== null &&
              work.doi === value &&
              validTx(work.claim_tx),
          );
          if (held) return held.claim_tx;
        }
      } else {
        const links = await this.#reads.links(this.#signer.address);
        if (
          links.address === this.#signer.address &&
          links.network === this.#config.networkId &&
          Array.isArray(links.links)
        ) {
          const held = links.links.find(
            (link) =>
              link.kind === kind &&
              link.value === value &&
              (link.status === "pending" ||
                link.status === "verified" ||
                link.status === "stale") &&
              validTx(link.claim_tx),
          );
          if (held) return held.claim_tx;
        }
      }
    } catch {
      // An unavailable or malformed owner read is not evidence that a claim is held.
    }
    throw new ClaimNotHeldError(kind, value);
  }

  retryRegistration(pending: PendingRegistration): Promise<RegisteredClaim> {
    return this.#register(snapshotPendingRegistration(pending));
  }

  async #settle(
    op: "claim" | "revoke",
    claimKind: ClaimDataKind,
    claimValue: string,
    metadata: Pick<PendingRegistration, "name" | "kind" | "value">,
  ): Promise<RegisteredClaim> {
    const fee = await resolveClaimFee(this.#config.networkId, this.#feeSource);
    if (fee.kind === "unavailable") throw new FeeUnavailableError();

    let encoded: Uint8Array;
    try {
      encoded = encodeClaimDataV2(claimKind, claimValue);
    } catch (cause) {
      throw new InvalidClaimError({ cause });
    }

    let nonce: bigint;
    try {
      nonce = await getNextNonce(this.#provider, this.#signer.address);
    } catch (cause) {
      throw new NonceFetchError({ cause });
    }

    let built: Awaited<ReturnType<typeof buildExternalClaimBytes>>;
    try {
      built = await buildExternalClaimBytes({
        address: this.#signer.address,
        networkId: this.#config.networkId,
        nonce,
        claimDataHex: claimDataHex(encoded),
        feeToken: feeTokenForState(fee),
      });
    } catch (cause) {
      throw new PreSubmitError("could not build the claim transaction", { cause });
    }

    const signingBytes = new Uint8Array(built.bytes);
    let signatureHex: string;
    try {
      signatureHex = await this.#signer.sign(signingBytes);
    } catch (cause) {
      throw new SigningError({ cause });
    }
    if (!verifyStrict(signingBytes, signatureHex, this.#signer.publicKey)) {
      throw new LocalVerificationError();
    }

    let settled: Awaited<ReturnType<typeof submitSignedClaim>>;
    try {
      settled = await submitSignedClaim(
        this.#provider,
        built.versioned,
        signatureHex,
        this.#config.networkId,
        fee.kind === "quoted" ? fee.symbol : null,
      );
    } catch (cause) {
      if (
        cause instanceof NonceConflictError ||
        cause instanceof InsufficientFundsError
      ) {
        throw cause;
      }
      throw new IndeterminateSubmissionError(
        this.#config.networkId,
        this.#signer.address,
        { cause },
      );
    }

    const pending: PendingRegistration = {
      op,
      network: this.#config.networkId,
      addressHex: this.#signer.signerHex,
      ...metadata,
      nonce: settled.nonce,
      txIdHex: settled.txIdHex,
    };
    return this.#register(pending);
  }

  async #register(pending: PendingRegistration): Promise<RegisteredClaim> {
    if (pending.network !== this.#config.networkId) {
      throw new PendingNetworkMismatchError(
        pending.network,
        this.#config.networkId,
      );
    }
    const path = pending.op === "revoke" ? "/api/revoke" : "/api/claim";
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.idOrigin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: pending.addressHex,
          nonce: pending.nonce,
          tx_id: pending.txIdHex,
          network: pending.network,
        }),
      });
    } catch (cause) {
      throw new RegistrationPendingError(pending, { cause });
    }

    let body: unknown;
    try {
      body = await responseBody(response);
    } catch (cause) {
      throw new RegistrationPendingError(pending, { cause });
    }
    if (response.status === 409) {
      throw new RegistrationTerminalError("conflict", reasonOf(body));
    }
    if (response.status === 422) {
      throw new RegistrationTerminalError("invalid", reasonOf(body));
    }
    if (!response.ok) throw new RegistrationPendingError(pending);

    const status =
      body && typeof body === "object"
        ? (body as { status?: unknown }).status
        : undefined;
    if (status === "rejected") {
      throw new RegistrationTerminalError("rejected", reasonOf(body));
    }
    const registered =
      status === "applied" ||
      (pending.op === "claim" && status === "verified_external_link");
    if (!registered) {
      throw new RegistrationPendingError(pending);
    }
    return {
      txIdHex: pending.txIdHex,
      nonce: pending.nonce,
      ...(pending.name
        ? { profileUrl: `${this.#config.idOrigin}/${encodeURIComponent(pending.name)}` }
        : {}),
      registration: "registered",
      outcome: status === "applied" ? "applied" : "verified",
    };
  }
}
