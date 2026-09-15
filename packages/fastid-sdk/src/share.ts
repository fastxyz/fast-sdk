import type { IdNetworkConfig } from "./networks.js";

export class ShareLinks {
  constructor(private readonly config: IdNetworkConfig) {}

  profileUrl(identity: string): string {
    return `${this.config.idOrigin}/${encodeURIComponent(identity)}`;
  }

  idJsonUrl(identity: string): string {
    return `${this.profileUrl(identity)}/id.json`;
  }

  ogImageUrl(identity: string): string {
    return `${this.profileUrl(identity)}/opengraph-image`;
  }
}
