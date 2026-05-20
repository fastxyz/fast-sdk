import { Signer } from "@fastxyz/sdk";

export interface HandleInfo {
  address: string;
  publicKey: Uint8Array;
  createdAt: string;
}

interface HandleRecord {
  seed: Uint8Array;
  info: HandleInfo;
  expiresAtMs: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function randomHandle(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export class HandleVault {
  private readonly handles = new Map<string, HandleRecord>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async store(seed: Uint8Array): Promise<{ handle: string; info: HandleInfo }> {
    // Own our own copy: callers wipe their plaintext seed buffer after store().
    const owned = seed.slice();
    const signer = new Signer(owned);
    const publicKey = await signer.getPublicKey();
    const address = await signer.getFastAddress();
    const info: HandleInfo = {
      address,
      publicKey,
      createdAt: this.now().toISOString(),
    };
    const handle = randomHandle();
    this.handles.set(handle, {
      seed: owned,
      info,
      expiresAtMs: this.now().getTime() + this.ttlMs,
    });
    return { handle, info };
  }

  private live(handle: string): HandleRecord | null {
    const record = this.handles.get(handle);
    if (!record) return null;
    if (this.now().getTime() >= record.expiresAtMs) {
      this.dispose(handle);
      return null;
    }
    return record;
  }

  getSeed(handle: string): Uint8Array | null {
    return this.live(handle)?.seed ?? null;
  }

  getInfo(handle: string): HandleInfo | null {
    return this.live(handle)?.info ?? null;
  }

  dispose(handle: string): void {
    const record = this.handles.get(handle);
    if (record) record.seed.fill(0);
    this.handles.delete(handle);
  }
}
