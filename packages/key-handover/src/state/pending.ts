import { ERROR } from "../errors.ts";

export interface PendingSeed {
  hpkePrivateKey: CryptoKey;
  requestPayloadBytes: Uint8Array;
  fingerprint: string;
  expiresAt: string;
}

interface PendingRecord extends PendingSeed {
  state: "pending" | "consuming";
  failureCount: number;
}

export class PendingStore {
  private record: PendingRecord | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  set(seed: PendingSeed): void {
    this.record = { ...seed, state: "pending", failureCount: 0 };
  }

  peek(): PendingRecord | null {
    return this.record;
  }

  beginConsuming(): PendingRecord {
    const record = this.record;
    if (!record) {
      throw new Error(`${ERROR.MISSING_PENDING_REQUEST}: no pending request`);
    }
    if (this.now().getTime() >= Date.parse(record.expiresAt)) {
      this.record = null;
      throw new Error(`${ERROR.REQUEST_EXPIRED}: request expired`);
    }
    if (record.state !== "pending") {
      throw new Error(`${ERROR.REQUEST_NOT_PENDING}: request already consuming`);
    }
    record.state = "consuming";
    return record;
  }

  recordFailure(): boolean {
    const record = this.record;
    if (!record) return true;
    record.failureCount += 1;
    if (record.failureCount >= 3) {
      this.record = null;
      return true;
    }
    record.state = "pending";
    return false;
  }

  clear(): void {
    this.record = null;
  }
}
