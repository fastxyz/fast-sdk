import { HttpClient } from "./http.js";
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

export interface IdReaderOptions {
  network: IdNetwork;
  fetchImpl?: typeof fetch;
}

/**
 * Signer-free access to the public Fast ID reads.
 *
 * Use this when you only need to look identities up (for example, resolving
 * `alice.smith` to its `fast1…` address before a transfer). It performs the
 * same response validation as {@link IdClient}, including the network and
 * name-binding checks, but needs no key material.
 */
export class IdReader {
  readonly #reads: IdReads;

  constructor(options: IdReaderOptions) {
    const config = networkFor(options.network);
    const http = new HttpClient(config.idOrigin, options.fetchImpl ?? fetch);
    this.#reads = new IdReads(http, config.networkId);
  }

  resolve(identity: string): Promise<ResolvedId> {
    return this.#reads.resolve(identity);
  }

  identity(address: string): Promise<IdentityDocument> {
    return this.#reads.identity(address);
  }

  availability(
    name: string,
    options?: AvailabilityReadOptions,
  ): Promise<Availability> {
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
}
