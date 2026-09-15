import type { ClaimDataKind } from "./claim-data.js";
import { isCanonicalFastAddress } from "./address.js";
import {
  InvalidReadResponseError,
  ReadCancelledError,
  ReadTimeoutError,
} from "./errors.js";
import { HttpClient } from "./http.js";
import { isCanonicalName } from "./name.js";

const DEFAULT_AVAILABILITY_TIMEOUT_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;

export interface AvailabilityReadOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ResolvedId {
  id: string;
  network: string;
  address: string;
  name?: string;
  name_claim_tx?: string;
  profile?: {
    display_name?: string;
    bio?: string;
    avatar?: string;
    provenance?: string;
  };
  verified_properties: unknown[];
  signed_content_status: "available" | "temporarily_unavailable";
  signed_content: unknown[];
  imported_works: ImportedWork[];
  note: string;
  [key: string]: unknown;
}

export interface ImportedWork {
  doi: string;
  title?: string;
  source?: string;
  venue?: string;
  provenance: "self-asserted";
  claim_tx: string;
}

export type PropertyClaimKind = Exclude<ClaimDataKind, "name" | "revoke" | "x">;

export interface IdentityDocument {
  network: string;
  address: string;
  name?: string;
  name_claim_tx?: string;
}

export interface Availability {
  network: string;
  available: boolean;
  taken?: boolean;
  skeleton_conflict: boolean;
  reserved: boolean;
}

export interface OwnerLink {
  kind: string;
  value: string;
  status: "pending" | "verified" | "stale";
  claim_tx: string;
  last_checked?: string;
  publicly_visible: boolean;
}

export interface OwnerLinks {
  address: string;
  network: string;
  links: OwnerLink[];
}

export interface PropertyClaimedResult {
  claimed: boolean;
  /** Only a positive result proves anything; the endpoint deliberately fails open. */
  loadBearing: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

const LOWER_HEX_32 = /^[0-9a-f]{64}$/;
const LOWER_HEX_64 = /^[0-9a-f]{128}$/;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_CONTENT_PROOF =
  "This address signed an on-chain attestation for this SHA-256 fingerprint.";
const SIGNED_CONTENT_RELATIONSHIPS = new Set([
  "authored",
  "co_authored",
  "approved",
  "published",
  "reviewed",
  "witnessed",
  "received",
  "official_release",
]);

function isProfile(value: unknown): boolean {
  return (
    isObject(value) &&
    isOptionalString(value.display_name) &&
    isOptionalString(value.bio) &&
    isOptionalString(value.avatar) &&
    isOptionalString(value.provenance)
  );
}

function isVerifiedProperty(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.kind === "string" &&
    typeof value.value === "string" &&
    typeof value.verification === "string" &&
    typeof value.claim_tx === "string" &&
    (value.last_checked === null || typeof value.last_checked === "string") &&
    typeof value.proves === "string"
  );
}

function hasCoherentAttribution(value: Record<string, unknown>): boolean {
  const fields = [
    value.fast_id,
    value.address_binding_ref,
    value.address_binding_receipt,
  ];
  if (fields.every((field) => field === undefined)) return true;
  return (
    typeof fields[0] === "string" &&
    fields[0].length > 0 &&
    typeof fields[1] === "string" &&
    LOWER_HEX_32.test(fields[1]) &&
    typeof fields[2] === "string" &&
    LOWER_HEX_32.test(fields[2])
  );
}

function isSignedContent(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.title === "string" &&
    typeof value.sha256 === "string" &&
    LOWER_HEX_32.test(value.sha256) &&
    typeof value.relationship === "string" &&
    SIGNED_CONTENT_RELATIONSHIPS.has(value.relationship) &&
    typeof value.signer_name === "string" &&
    typeof value.file_label === "string" &&
    typeof value.list_by_signer === "boolean" &&
    typeof value.tx_id === "string" &&
    LOWER_HEX_32.test(value.tx_id) &&
    typeof value.nonce === "string" &&
    CANONICAL_UINT.test(value.nonce) &&
    typeof value.transaction_timestamp === "string" &&
    typeof value.metadata_revision === "string" &&
    CANONICAL_UINT.test(value.metadata_revision) &&
    typeof value.metadata_sig === "string" &&
    LOWER_HEX_64.test(value.metadata_sig) &&
    value.signature_scope === "versioned_transaction" &&
    hasCoherentAttribution(value) &&
    (value.binding === undefined || value.binding === "verified") &&
    value.proves === SIGNED_CONTENT_PROOF
  );
}

function isImportedWork(value: unknown): value is ImportedWork {
  return (
    isObject(value) &&
    typeof value.doi === "string" &&
    value.provenance === "self-asserted" &&
    typeof value.claim_tx === "string" &&
    isOptionalString(value.title) &&
    isOptionalString(value.source) &&
    isOptionalString(value.venue)
  );
}

function hasCanonicalNameBinding(value: Record<string, unknown>): boolean {
  return (
    (value.name === undefined && value.name_claim_tx === undefined) ||
    (typeof value.name === "string" &&
      isCanonicalName(value.name) &&
      typeof value.name_claim_tx === "string" &&
      LOWER_HEX_32.test(value.name_claim_tx))
  );
}

function isResolvedId(value: unknown): value is ResolvedId {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.network === "string" &&
    typeof value.address === "string" &&
    isCanonicalFastAddress(value.address) &&
    hasCanonicalNameBinding(value) &&
    (value.profile === undefined || isProfile(value.profile)) &&
    Array.isArray(value.verified_properties) &&
    value.verified_properties.every(isVerifiedProperty) &&
    (value.signed_content_status === "available" ||
      value.signed_content_status === "temporarily_unavailable") &&
    Array.isArray(value.signed_content) &&
    value.signed_content.every(isSignedContent) &&
    Array.isArray(value.imported_works) &&
    value.imported_works.every(isImportedWork) &&
    typeof value.note === "string"
  );
}

function isIdentityDocument(value: unknown): value is IdentityDocument {
  return (
    isObject(value) &&
    typeof value.network === "string" &&
    typeof value.address === "string" &&
    isCanonicalFastAddress(value.address) &&
    hasCanonicalNameBinding(value)
  );
}

function isAvailability(value: unknown): value is Availability {
  return (
    isObject(value) &&
    typeof value.network === "string" &&
    typeof value.available === "boolean" &&
    (value.taken === undefined || typeof value.taken === "boolean") &&
    typeof value.skeleton_conflict === "boolean" &&
    typeof value.reserved === "boolean"
  );
}

function isOwnerLink(value: unknown): value is OwnerLink {
  return (
    isObject(value) &&
    typeof value.kind === "string" &&
    typeof value.value === "string" &&
    (value.status === "pending" ||
      value.status === "verified" ||
      value.status === "stale") &&
    typeof value.claim_tx === "string" &&
    isOptionalString(value.last_checked) &&
    typeof value.publicly_visible === "boolean"
  );
}

function isOwnerLinks(value: unknown): value is OwnerLinks {
  return (
    isObject(value) &&
    typeof value.address === "string" &&
    typeof value.network === "string" &&
    Array.isArray(value.links) &&
    value.links.every(isOwnerLink)
  );
}

function validateRead<T>(
  endpoint: string,
  value: unknown,
  validator: (candidate: unknown) => candidate is T,
): T {
  if (!validator(value)) throw new InvalidReadResponseError(endpoint);
  return value;
}

export class IdReads {
  constructor(
    private readonly http: HttpClient,
    private readonly network: string,
  ) {}

  async resolve(identity: string): Promise<ResolvedId> {
    const body = validateRead(
      "resolve",
      await this.http.getJson(`/${encodeURIComponent(identity)}/id.json`),
      isResolvedId,
    );
    if (
      body.network !== this.network ||
      (body.name !== identity && body.address !== identity) ||
      body.id !== `${this.http.origin}/${body.name ?? body.address}`
    ) {
      throw new InvalidReadResponseError("resolve");
    }
    return body;
  }

  async identity(address: string): Promise<IdentityDocument> {
    const body = validateRead(
      "identity",
      await this.http.getJson(`/${encodeURIComponent(address)}/identity.json`),
      isIdentityDocument,
    );
    if (body.address !== address || body.network !== this.network) {
      throw new InvalidReadResponseError("identity");
    }
    return body;
  }

  async availability(
    name: string,
    options: AvailabilityReadOptions = {},
  ): Promise<Availability> {
    const query = new URLSearchParams({ name });
    const timeoutMs = options.timeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_MS) {
      throw new RangeError(
        `availability timeoutMs must be between 1 and ${MAX_TIMER_MS}`,
      );
    }
    const signal = options.signal;
    if (signal?.aborted) throw new ReadCancelledError();

    const controller = new AbortController();
    let rejectBound: ((error: Error) => void) | undefined;
    const bound = new Promise<never>((_resolve, reject) => {
      rejectBound = reject;
    });
    const onAbort = () => {
      controller.abort();
      rejectBound?.(new ReadCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => {
      controller.abort();
      rejectBound?.(new ReadTimeoutError(timeoutMs));
    }, timeoutMs);
    try {
      const read = this.http
        .requestJson(`/api/availability?${query}`, {
          method: "GET",
          signal: controller.signal,
        })
        .then((body) => validateRead("availability", body, isAvailability));
      const body = await Promise.race([
        read,
        bound,
      ]);
      if (body.network !== this.network) {
        throw new InvalidReadResponseError("availability");
      }
      return body;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async links(address: string, signal?: AbortSignal): Promise<OwnerLinks> {
    const body = validateRead(
      "links",
      await this.http.requestJson(`/api/links/${encodeURIComponent(address)}`, {
        method: "GET",
        signal,
      }),
      isOwnerLinks,
    );
    if (body.address !== address || body.network !== this.network) {
      throw new InvalidReadResponseError("links");
    }
    return body;
  }

  async propertyClaimed(
    kind: PropertyClaimKind,
    value: string,
  ): Promise<PropertyClaimedResult> {
    const query = new URLSearchParams({ kind, value });
    try {
      const body = await this.http.getJson(
        `/api/property/claimed?${query}`,
      );
      const claimed = isObject(body) && body.claimed === true;
      return { claimed, loadBearing: claimed };
    } catch {
      return { claimed: false, loadBearing: false };
    }
  }
}
