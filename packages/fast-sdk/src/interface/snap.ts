import type {
  AccountInfoResponse,
  VersionedTransaction,
} from "@fastxyz/schema";
import type { FastSigner } from "./signer";
import { fromHex, toHex } from "./convert";

export interface Eip1193Provider {
  request(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }): Promise<unknown>;
}

export interface FastSnapClientOptions {
  snapId: string;
  version?: string;
  provider?: Eip1193Provider;
}

export interface FastSnapAccount {
  address: string;
  publicKey: string;
}

export interface FastSnapConnectResult {
  connected: boolean;
  accounts: readonly FastSnapAccount[];
}

export interface FastSnapSignatureResult {
  address: string;
  signature: string;
}

export interface FastSnapSignTransactionResult
  extends FastSnapSignatureResult {
  transaction: VersionedTransaction;
}

type FastSnapMethod =
  | "fast_connect"
  | "fast_getAccounts"
  | "fast_createAccount"
  | "fast_importAccount"
  | "fast_getAccountInfo"
  | "fast_signMessage"
  | "fast_signTransaction"
  | "fast_syncNonce";

const getDefaultProvider = (): Eip1193Provider => {
  const provider = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
  if (!provider) {
    throw new Error(
      "No EIP-1193 provider found. Pass FastSnapClientOptions.provider or use MetaMask.",
    );
  }
  return provider;
};

class SnapSigner implements FastSigner {
  constructor(
    private readonly client: FastSnapClient,
    private readonly address: string,
  ) {}

  async getPublicKey(): Promise<Uint8Array> {
    const account = await this.client.getAccount(this.address);
    return fromHex(account.publicKey);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const result = await this.client.signMessage({
      address: this.address,
      message,
    });
    return fromHex(result.signature);
  }

  async signTransaction(
    transaction: VersionedTransaction,
  ): Promise<Uint8Array> {
    const result = await this.client.signTransaction({
      address: this.address,
      transaction,
    });
    return fromHex(result.signature);
  }
}

export class FastSnapClient {
  private readonly provider: Eip1193Provider;
  private readonly snapId: string;
  private readonly version?: string;

  constructor(options: FastSnapClientOptions) {
    this.provider = options.provider ?? getDefaultProvider();
    this.snapId = options.snapId;
    this.version = options.version;
  }

  async install(): Promise<void> {
    const params = this.version
      ? { [this.snapId]: { version: this.version } }
      : { [this.snapId]: {} };

    await this.provider.request({
      method: "wallet_requestSnaps",
      params,
    });
  }

  async connect(): Promise<FastSnapConnectResult> {
    await this.install();
    return this.invoke<FastSnapConnectResult>("fast_connect");
  }

  async getAccounts(): Promise<readonly FastSnapAccount[]> {
    return this.invoke<readonly FastSnapAccount[]>("fast_getAccounts");
  }

  async getAccount(address: string): Promise<FastSnapAccount> {
    const account = (await this.getAccounts()).find(
      (entry) => entry.address === address,
    );
    if (!account) {
      throw new Error(
        `Snap account not found: ${address}. Call getAccounts() first and use one of the returned addresses.`,
      );
    }
    return account;
  }

  async createAccount(): Promise<FastSnapAccount> {
    return this.invoke<FastSnapAccount>("fast_createAccount");
  }

  async importAccount(privateKey: string): Promise<FastSnapAccount> {
    return this.invoke<FastSnapAccount>("fast_importAccount", { privateKey });
  }

  async getAccountInfo(address: string): Promise<AccountInfoResponse> {
    return this.invoke<AccountInfoResponse>("fast_getAccountInfo", { address });
  }

  async signMessage(params: {
    address: string;
    message: string | Uint8Array;
    encoding?: "utf8" | "hex";
  }): Promise<FastSnapSignatureResult> {
    const message =
      params.message instanceof Uint8Array
        ? toHex(params.message)
        : params.encoding === "hex"
          ? params.message
          : toHex(new TextEncoder().encode(params.message));

    return this.invoke<FastSnapSignatureResult>("fast_signMessage", {
      address: params.address,
      message,
      encoding: "hex",
    });
  }

  async signTransaction(params: {
    address: string;
    transaction: VersionedTransaction;
  }): Promise<FastSnapSignTransactionResult> {
    return this.invoke<FastSnapSignTransactionResult>(
      "fast_signTransaction",
      params,
    );
  }

  async syncNonce(address: string): Promise<number | null> {
    return this.invoke<number | null>("fast_syncNonce", { address });
  }

  getSigner(address: string): FastSigner {
    return new SnapSigner(this, address);
  }

  private invoke<T>(
    method: FastSnapMethod,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.provider.request({
      method: "wallet_invokeSnap",
      params: {
        snapId: this.snapId,
        request: { method, params },
      },
    }) as Promise<T>;
  }
}
