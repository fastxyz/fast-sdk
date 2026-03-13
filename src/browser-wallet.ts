import { FAST_DECIMALS } from './bcs.js';
import { getCertificateHash } from './certificate.js';
import { FastError } from './errors.js';
import { toHex } from './amounts.js';
import { bytesToHex, stripHexPrefix, utf8ToBytes } from './bytes.js';
import { FastProvider } from './provider.browser.js';
import type {
  FastBrowserWalletAccount,
  FastBrowserWalletAdapter,
  FastBrowserWalletConnectOptions,
  SendResult,
  SignResult,
  SubmitResult,
  TokenBalance,
} from './types.js';

const DEFAULT_PERMISSIONS = ['viewAccount', 'suggestTransactions'];
const DEFAULT_TOKEN = 'FAST';
const HEX_TOKEN_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

function getInjectedWallet(): FastBrowserWalletAdapter | undefined {
  const globalWindow = (globalThis as { window?: { fastset?: FastBrowserWalletAdapter } }).window;
  if (!globalWindow) {
    return undefined;
  }
  return globalWindow.fastset;
}

function normalizeAccount(account: FastBrowserWalletAccount): FastBrowserWalletAccount {
  return {
    address: account.address,
    publicKey: stripHexPrefix(account.publicKey).toLowerCase(),
  };
}

export class FastBrowserWallet {
  private _adapter: FastBrowserWalletAdapter;
  private _provider: FastProvider;
  private _ownsProvider: boolean;
  private _accounts: FastBrowserWalletAccount[] = [];

  private constructor(
    adapter: FastBrowserWalletAdapter,
    provider: FastProvider,
    ownsProvider: boolean,
  ) {
    this._adapter = adapter;
    this._provider = provider;
    this._ownsProvider = ownsProvider;
  }

  static fromInjected(
    injected: FastBrowserWalletAdapter | undefined = getInjectedWallet(),
    provider?: FastProvider,
  ): FastBrowserWallet {
    if (!injected) {
      throw new FastError('UNSUPPORTED_OPERATION', 'Injected Fast wallet not found', {
        note: 'Install the FastSet wallet extension or pass the injected wallet explicitly.',
      });
    }

    const browserProvider = provider ?? new FastProvider();
    return new FastBrowserWallet(injected, browserProvider, provider === undefined);
  }

  get provider(): FastProvider {
    return this._provider;
  }

  get address(): string | null {
    return this._accounts[0]?.address ?? null;
  }

  async connect(options?: FastBrowserWalletConnectOptions): Promise<boolean> {
    const connected = await this._adapter.connect({
      permissions: options?.permissions ?? DEFAULT_PERMISSIONS,
    });
    if (!connected) {
      return false;
    }
    await this.refreshState();
    return true;
  }

  async disconnect(): Promise<boolean> {
    const disconnected = await this._adapter.disconnect();
    this._accounts = [];
    return disconnected;
  }

  isConnected(): boolean {
    return this._adapter.isConnected();
  }

  async getAccounts(): Promise<FastBrowserWalletAccount[]> {
    this._accounts = (await this._adapter.getAccounts()).map(normalizeAccount);
    return [...this._accounts];
  }

  async getActiveNetwork(): Promise<string> {
    const network = await this._adapter.getActiveNetwork();
    if (this._ownsProvider) {
      this._provider = new FastProvider({ network });
    }
    return network;
  }

  onAccountChanged(callback: (account: FastBrowserWalletAccount) => void): () => void {
    return this._adapter.onAccountChanged((account) => {
      const normalized = normalizeAccount(account);
      this._accounts = [normalized];
      void this.refreshState().catch(() => {});
      callback(normalized);
    });
  }

  async balance(token: string = DEFAULT_TOKEN): Promise<{ amount: string; token: string }> {
    const account = await this.requireAccount();
    return this._provider.getBalance(account.address, token);
  }

  async tokens(): Promise<TokenBalance[]> {
    const account = await this.requireAccount();
    return this._provider.getTokens(account.address);
  }

  async sign(params: { message: string | Uint8Array }): Promise<SignResult> {
    const account = await this.requireAccount();
    const messageBytes =
      typeof params.message === 'string'
        ? utf8ToBytes(params.message)
        : params.message;

    const result = await this._adapter.signMessage({
      message: Array.from(messageBytes),
      account,
    });

    return {
      signature: stripHexPrefix(result.signature).toLowerCase(),
      address: account.address,
      messageBytes: stripHexPrefix(result.messageBytes).toLowerCase(),
    };
  }

  async send(params: { to: string; amount: string; token?: string }): Promise<SendResult> {
    const account = await this.requireAccount();
    const token = params.token ?? DEFAULT_TOKEN;
    const { tokenId, decimals } = await this.resolveSendToken(token);
    const certificate = await this._adapter.transfer({
      amount: toHex(params.amount, decimals),
      recipient: params.to,
      account,
      tokenId: tokenId === 'native' ? undefined : tokenId,
    });
    const txHash = getCertificateHash(certificate);
    const explorerUrl = await this._provider.getExplorerUrl(txHash);

    return {
      txHash,
      certificate,
      explorerUrl,
    };
  }

  async submitClaim(params: {
    recipient: string;
    claimData: Uint8Array | number[];
    verifierCommittee?: Array<number[]>;
    verifierQuorum?: number;
    signatures?: Array<[number[], number[]]>;
  }): Promise<SubmitResult> {
    const account = await this.requireAccount();
    const certificate = await this._adapter.submitClaim({
      recipient: params.recipient,
      claimData: Array.from(params.claimData),
      account,
      verifierCommittee: params.verifierCommittee,
      verifierQuorum: params.verifierQuorum,
      signatures: params.signatures,
    });

    return {
      txHash: getCertificateHash(certificate),
      certificate,
    };
  }

  private async requireAccount(): Promise<FastBrowserWalletAccount> {
    if (this._accounts.length === 0) {
      await this.refreshState();
    }
    const account = this._accounts[0];
    if (!account) {
      throw new FastError('UNSUPPORTED_OPERATION', 'No connected wallet account available', {
        note: 'Call connect() first and ensure the extension exposes at least one account.',
      });
    }
    return account;
  }

  private async refreshState(): Promise<void> {
    await this.getActiveNetwork().catch(() => {});
    await this.getAccounts();
  }

  private async resolveSendToken(
    token: string,
  ): Promise<{ tokenId: string; decimals: number }> {
    if (token.toUpperCase() === 'FAST') {
      return { tokenId: 'native', decimals: FAST_DECIMALS };
    }

    if (HEX_TOKEN_PATTERN.test(token)) {
      const info = await this._provider.getTokenInfo(token);
      return {
        tokenId: info?.tokenId ?? `0x${stripHexPrefix(token).toLowerCase()}`,
        decimals: info?.decimals ?? FAST_DECIMALS,
      };
    }

    const known = await this._provider.resolveKnownToken(token);
    if (known && known.tokenId !== 'native') {
      const info = await this._provider.getTokenInfo(known.tokenId);
      if (!info || info.tokenId === 'native') {
        throw new FastError('TOKEN_NOT_FOUND', `Token "${token}" not found on ${this._provider.network}`, {
          note: 'Use a token symbol configured for the selected network or pass a valid hex token ID.',
        });
      }

      return {
        tokenId: info.tokenId,
        decimals: info.decimals,
      };
    }

    throw new FastError('TOKEN_NOT_FOUND', `Token "${token}" not found`, {
      note: 'Use a known token symbol (FAST, fastUSDC) or a hex token ID.',
    });
  }
}
