import { sha256 } from "@noble/hashes/sha2";

import { toHex } from "./address.js";
import {
  IndeterminateProfileUpdateError,
  InvalidProfileError,
  LocalVerificationError,
  ProfileChallengeError,
  ProfileReadError,
  ProfileUnauthorizedError,
  ProfileUpdateError,
  SigningError,
} from "./errors.js";
import type { IdNetworkConfig } from "./networks.js";
import {
  bioOk,
  displayNameOk,
  encodeProfileMessage,
  type AvatarOp,
  type ProfileMessageFields,
} from "./profile-message.js";
import type { IdReads, ResolvedId } from "./reads.js";
import type { Signer } from "./signer.js";
import { hexToBytes, verifyStrict } from "./verify.js";

export interface ProfileAvatarFile {
  bytes: Uint8Array;
  type: string;
  name: string;
}

export interface ProfileUpdateInput {
  displayName?: string;
  bio?: string;
  /** Omit to keep the current avatar, pass null to clear it, or pass original file bytes to set it. */
  avatar?: ProfileAvatarFile | null;
}

export interface ProfileUpdateResult {
  status: "updated";
}

interface ProfileServiceOptions {
  config: IdNetworkConfig;
  signer: Signer;
  reads: IdReads;
  fetchImpl: typeof fetch;
}

interface ProfileSnapshot {
  displayName: string;
  bio: string;
  avatar: AvatarOp;
  avatarFile?: ProfileAvatarFile;
}

interface ProfileInputSnapshot {
  displayName?: string;
  bio?: string;
  avatar?: ProfileAvatarFile | null;
}

interface Challenge {
  server_nonce: string;
  expiry: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
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

function isImportedWork(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.doi === "string" &&
    typeof value.provenance === "string" &&
    typeof value.claim_tx === "string" &&
    isOptionalString(value.title) &&
    isOptionalString(value.source) &&
    isOptionalString(value.venue)
  );
}

function currentFields(document: ResolvedId, signer: Signer, network: string) {
  if (
    !isObject(document) ||
    typeof document.id !== "string" ||
    document.address !== signer.address ||
    document.network !== network
  ) {
    throw new ProfileReadError("profile read returned a different address or network");
  }
  if (
    !Array.isArray(document.verified_properties) ||
    !document.verified_properties.every(isVerifiedProperty) ||
    (document.signed_content_status !== "available" &&
      document.signed_content_status !== "temporarily_unavailable") ||
    !Array.isArray(document.signed_content) ||
    !document.signed_content.every(isSignedContent) ||
    !Array.isArray(document.imported_works) ||
    !document.imported_works.every(isImportedWork) ||
    typeof document.note !== "string" ||
    (document.name !== undefined && typeof document.name !== "string") ||
    (document.name_claim_tx !== undefined &&
      typeof document.name_claim_tx !== "string")
  ) {
    throw new ProfileReadError("profile read was malformed");
  }
  const profile = document.profile;
  if (profile === undefined) return { displayName: "", bio: "" };
  if (!isObject(profile)) throw new ProfileReadError("profile read was malformed");
  const displayName = profile.display_name;
  const bio = profile.bio;
  const avatar = profile.avatar;
  const provenance = profile.provenance;
  if (
    (displayName !== undefined && typeof displayName !== "string") ||
    (bio !== undefined && typeof bio !== "string") ||
    (avatar !== undefined && typeof avatar !== "string") ||
    (provenance !== undefined && typeof provenance !== "string")
  ) {
    throw new ProfileReadError("profile read was malformed");
  }
  return { displayName: displayName ?? "", bio: bio ?? "" };
}

function formString(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

/** Match the Fetch multipart serializer before measuring or signing text fields. */
function normalizeMultipartText(value: string): string {
  return value.replace(/\r?\n|\r/g, "\r\n");
}

function snapshotProfileAvatar(
  value: unknown,
): ProfileAvatarFile | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isObject(value)) throw new InvalidProfileError("profile input is malformed");
  const bytes = value.bytes;
  if (!(bytes instanceof Uint8Array)) {
    throw new InvalidProfileError("profile input is malformed");
  }
  const bytesSnapshot = new Uint8Array(bytes);
  const type = value.type;
  const name = value.name;
  if (typeof type !== "string" || typeof name !== "string") {
    throw new InvalidProfileError("profile input is malformed");
  }
  return { bytes: bytesSnapshot, type, name };
}

function snapshotProfileInput(input: unknown): ProfileInputSnapshot {
  if (!isObject(input)) throw new InvalidProfileError("profile input is malformed");
  const { displayName, bio, avatar } = input;
  if (
    (displayName !== undefined && typeof displayName !== "string") ||
    (bio !== undefined && typeof bio !== "string")
  ) {
    throw new InvalidProfileError("profile input is malformed");
  }
  const avatarSnapshot = snapshotProfileAvatar(avatar);
  const normalizedDisplayName =
    displayName === undefined ? undefined : normalizeMultipartText(displayName);
  const normalizedBio = bio === undefined ? undefined : normalizeMultipartText(bio);
  if (
    (normalizedDisplayName !== undefined &&
      !displayNameOk(normalizedDisplayName)) ||
    (normalizedBio !== undefined && !bioOk(normalizedBio))
  ) {
    throw new InvalidProfileError("profile fields exceed protocol limits");
  }
  return {
    ...(normalizedDisplayName === undefined
      ? {}
      : { displayName: normalizedDisplayName }),
    ...(normalizedBio === undefined ? {} : { bio: normalizedBio }),
    ...(avatarSnapshot === undefined
      ? {}
      : {
          avatar:
            avatarSnapshot === null
              ? null
              : avatarSnapshot,
        }),
  };
}

export class ProfileService {
  readonly #config: IdNetworkConfig;
  readonly #signer: Signer;
  readonly #reads: IdReads;
  readonly #fetch: typeof fetch;

  constructor(options: ProfileServiceOptions) {
    this.#config = options.config;
    this.#signer = options.signer;
    this.#reads = options.reads;
    this.#fetch = options.fetchImpl;
  }

  async updateProfile(input: ProfileUpdateInput): Promise<ProfileUpdateResult> {
    const requested = snapshotProfileInput(input);
    let document: ResolvedId;
    try {
      document = await this.#reads.resolve(this.#signer.address);
    } catch (cause) {
      throw new ProfileReadError("could not load the current profile", { cause });
    }
    const current = currentFields(
      document,
      this.#signer,
      this.#config.networkId,
    );
    const avatarFile = requested.avatar || undefined;
    const snapshot: ProfileSnapshot = {
      displayName: normalizeMultipartText(
        requested.displayName ?? current.displayName,
      ),
      bio: normalizeMultipartText(requested.bio ?? current.bio),
      avatar:
        requested.avatar === undefined
          ? { kind: "nochange" }
          : requested.avatar === null
            ? { kind: "clear" }
            : { kind: "set", digest: sha256(avatarFile!.bytes) },
      ...(avatarFile ? { avatarFile } : {}),
    };
    if (!displayNameOk(snapshot.displayName) || !bioOk(snapshot.bio)) {
      throw new InvalidProfileError("profile fields exceed protocol limits");
    }
    if (toHex(this.#signer.publicKey) !== this.#signer.signerHex) {
      throw new InvalidProfileError("signer public key does not match signerHex");
    }

    const challenge = await this.#challenge();
    const messageFields: ProfileMessageFields = {
      address: this.#signer.publicKey,
      network: this.#config.networkId,
      displayName: snapshot.displayName,
      bio: snapshot.bio,
      avatar: snapshot.avatar,
      expiry: BigInt(challenge.expiry),
      serverNonce: hexToBytes(challenge.server_nonce),
    };
    const message = encodeProfileMessage(messageFields);
    let signatureHex: string;
    try {
      signatureHex = await this.#signer.sign(message);
    } catch (cause) {
      throw new SigningError({ cause });
    }
    if (!verifyStrict(message, signatureHex, this.#signer.publicKey)) {
      throw new LocalVerificationError();
    }

    const form = this.#buildForm(snapshot, challenge, signatureHex);
    if (!(await this.#formSignatureMatches(form, signatureHex))) {
      throw new LocalVerificationError();
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.idOrigin}/api/profile`, {
        method: "PUT",
        body: form,
      });
    } catch (cause) {
      throw new IndeterminateProfileUpdateError({ cause });
    }
    if (response.status === 200) return { status: "updated" };
    if (response.status === 401) throw new ProfileUnauthorizedError();
    if (response.status === 422) {
      const reason = (await response.text().catch(() => "")) || undefined;
      throw new InvalidProfileError(reason);
    }
    throw new ProfileUpdateError(response.status);
  }

  async #challenge(): Promise<Challenge> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#config.idOrigin}/api/profile/challenge`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: this.#signer.signerHex,
            network: this.#config.networkId,
          }),
        },
      );
    } catch (cause) {
      throw new ProfileChallengeError(null, { cause });
    }
    if (!response.ok) throw new ProfileChallengeError(response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new ProfileChallengeError(null, { cause });
    }
    const serverNonce = isObject(body) ? body.server_nonce : undefined;
    const expiry = isObject(body) ? body.expiry : undefined;
    if (
      typeof serverNonce !== "string" ||
      !/^[0-9a-f]{64}$/.test(serverNonce) ||
      typeof expiry !== "number" ||
      !Number.isSafeInteger(expiry) ||
      expiry < 0
    ) {
      throw new ProfileChallengeError(null);
    }
    return { server_nonce: serverNonce, expiry };
  }

  #buildForm(
    snapshot: ProfileSnapshot,
    challenge: Challenge,
    signatureHex: string,
  ): FormData {
    const form = new FormData();
    form.set("address", this.#signer.signerHex);
    form.set("network", this.#config.networkId);
    form.set("display_name", snapshot.displayName);
    form.set("bio", snapshot.bio);
    form.set(
      "avatar_flag",
      snapshot.avatar.kind === "nochange"
        ? "0"
        : snapshot.avatar.kind === "set"
          ? "1"
          : "2",
    );
    form.set("expiry", String(challenge.expiry));
    form.set("server_nonce", challenge.server_nonce);
    form.set("signature", signatureHex);
    if (snapshot.avatar.kind === "set" && snapshot.avatarFile) {
      form.set(
        "avatar",
        new Blob([snapshot.avatarFile.bytes as BlobPart], {
          type: snapshot.avatarFile.type,
        }),
        snapshot.avatarFile.name,
      );
    }
    return form;
  }

  async #formSignatureMatches(
    form: FormData,
    signatureHex: string,
  ): Promise<boolean> {
    const address = formString(form, "address");
    const network = formString(form, "network");
    const displayName = formString(form, "display_name");
    const bio = formString(form, "bio");
    const avatarFlag = formString(form, "avatar_flag");
    const expiry = formString(form, "expiry");
    const serverNonce = formString(form, "server_nonce");
    if (
      address !== this.#signer.signerHex ||
      network !== this.#config.networkId ||
      displayName === null ||
      bio === null ||
      !/^(0|1|2)$/.test(avatarFlag ?? "") ||
      !/^(0|[1-9][0-9]*)$/.test(expiry ?? "") ||
      !/^[0-9a-f]{64}$/.test(serverNonce ?? "")
    ) {
      return false;
    }
    let avatar: AvatarOp;
    if (avatarFlag === "0") avatar = { kind: "nochange" };
    else if (avatarFlag === "2") avatar = { kind: "clear" };
    else {
      const file = form.get("avatar");
      if (!(file instanceof Blob)) return false;
      avatar = {
        kind: "set",
        digest: sha256(new Uint8Array(await file.arrayBuffer())),
      };
    }
    try {
      const message = encodeProfileMessage({
        address: this.#signer.publicKey,
        network,
        displayName,
        bio,
        avatar,
        expiry: BigInt(expiry!),
        serverNonce: hexToBytes(serverNonce!),
      });
      return verifyStrict(message, signatureHex, this.#signer.publicKey);
    } catch {
      return false;
    }
  }
}
