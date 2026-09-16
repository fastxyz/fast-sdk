import { FastProvider } from "@fastxyz/sdk";

import { proxyFeeSource } from "./claim-fee.js";
import {
  ClaimService,
  snapshotPendingRegistration,
  type PendingRegistration,
  type RegisteredClaim,
  type RevocableClaimKind,
} from "./claims.js";
import { HttpClient } from "./http.js";
import { makeProvider } from "./claim-tx.js";
import { RegistrationPendingError } from "./errors.js";
import { networkFor, type IdNetwork } from "./networks.js";
import {
  IdReads,
  type Availability,
  type AvailabilityReadOptions,
  type IdentityDocument,
  type OwnerLinks,
  type PropertyClaimedResult,
  type PropertyClaimKind,
  type ResolvedId,
} from "./reads.js";
import { validatedSigner, type Signer } from "./signer.js";
import {
  ProfileService,
  type ProfileUpdateInput,
  type ProfileUpdateResult,
} from "./profile.js";
import {
  ReportService,
  type SubmitReportInput,
  type SubmitReportResult,
} from "./report.js";
import { ShareLinks } from "./share.js";
import {
  ProofService,
  type OAuthClaimInstructions,
  type OAuthProofReady,
  type OAuthProvider,
  type ProofWaitOptions,
  type WebsiteClaimInstructions,
  type XClaimStart,
} from "./proofs.js";

export interface IdClientOptions {
  network: IdNetwork;
  signer: Signer;
  fetchImpl?: typeof fetch;
  provider?: FastProvider;
}

function pendingWireKey(pending: PendingRegistration): string {
  return [
    pending.op,
    pending.network,
    pending.addressHex,
    pending.nonce,
    pending.txIdHex,
  ].join("|");
}

export class IdClient {
  readonly #reads: IdReads;
  readonly #claims: ClaimService;
  readonly #profile: ProfileService;
  readonly #report: ReportService;
  readonly #proofs: ProofService;
  readonly #pendingOAuthRevocations = new Map<
    string,
    { provider: OAuthProvider; value: string }
  >();
  readonly share: ShareLinks;

  constructor(options: IdClientOptions) {
    const config = networkFor(options.network);
    const signer = validatedSigner(options.signer);
    const fetchImpl = options.fetchImpl ?? fetch;
    const provider = options.provider ?? makeProvider(config.proxyUrl, config.networkId);
    const http = new HttpClient(config.idOrigin, fetchImpl);
    this.#reads = new IdReads(http, config.networkId);
    this.#claims = new ClaimService({
      config,
      signer,
      provider,
      reads: this.#reads,
      feeSource: proxyFeeSource(config.proxyUrl, fetchImpl),
      fetchImpl,
    });
    this.#profile = new ProfileService({
      config,
      signer,
      reads: this.#reads,
      fetchImpl,
    });
    this.#report = new ReportService({
      config,
      signer,
      fetchImpl,
    });
    this.#proofs = new ProofService({
      config,
      signer,
      reads: this.#reads,
      claims: this.#claims,
      fetchImpl,
    });
    this.share = new ShareLinks(config);
  }

  resolve(identity: string): Promise<ResolvedId> {
    return this.#reads.resolve(identity);
  }

  identity(address: string): Promise<IdentityDocument> {
    return this.#reads.identity(address);
  }

  availability(name: string, options?: AvailabilityReadOptions): Promise<Availability> {
    return this.#reads.availability(name, options);
  }

  links(address: string): Promise<OwnerLinks> {
    return this.#reads.links(address);
  }

  propertyClaimed(
    kind: PropertyClaimKind,
    value: string,
  ): Promise<PropertyClaimedResult> {
    return this.#reads.propertyClaimed(kind, value);
  }

  claimName(name: string): Promise<RegisteredClaim> {
    return this.#claims.claimName(name);
  }

  importWork(doi: string): Promise<RegisteredClaim> {
    return this.#claims.importWork(doi);
  }

  updateProfile(input: ProfileUpdateInput): Promise<ProfileUpdateResult> {
    return this.#profile.updateProfile(input);
  }

  submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
    return this.#report.submitReport(input);
  }

  oauthClaimInstructions(provider: OAuthProvider): OAuthClaimInstructions {
    return this.#proofs.oauthClaimInstructions(provider);
  }

  waitForOAuthProof(
    provider: OAuthProvider,
    value: string,
    options: ProofWaitOptions,
  ): Promise<OAuthProofReady> {
    return this.#proofs.waitForOAuthProof(provider, value, options);
  }

  settleOAuthClaim(
    provider: OAuthProvider,
    value: string,
  ): Promise<RegisteredClaim> {
    return this.#proofs.settleOAuthClaim(provider, value);
  }

  claimWebsite(host: string): WebsiteClaimInstructions {
    return this.#proofs.claimWebsite(host);
  }

  startXClaim(handle: string): Promise<XClaimStart> {
    return this.#proofs.startXClaim(handle);
  }

  async revoke(kind: RevocableClaimKind, value: string): Promise<RegisteredClaim> {
    let result: RegisteredClaim;
    try {
      result = await this.#claims.revoke(kind, value);
    } catch (cause) {
      if (
        (kind === "github" || kind === "orcid") &&
        cause instanceof RegistrationPendingError
      ) {
        this.#pendingOAuthRevocations.set(pendingWireKey(cause.pending), {
          provider: kind,
          value,
        });
      }
      throw cause;
    }
    if (kind === "github" || kind === "orcid") {
      this.#proofs.forgetOAuthSettlement(kind, value);
    }
    return result;
  }

  async retryRegistration(pending: PendingRegistration): Promise<RegisteredClaim> {
    const snapshot = snapshotPendingRegistration(pending);
    const result = await this.#claims.retryRegistration(snapshot);
    const key = pendingWireKey(snapshot);
    const oauth = this.#pendingOAuthRevocations.get(key);
    if (oauth) {
      this.#proofs.forgetOAuthSettlement(oauth.provider, oauth.value);
      this.#pendingOAuthRevocations.delete(key);
    }
    return result;
  }
}
