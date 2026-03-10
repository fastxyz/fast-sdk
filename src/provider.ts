/**
 * provider.ts — FastProvider class
 *
 * Read-only connection to the Fast network. No private key needed.
 * Use for querying balances, token info, and account data.
 */

import { FastError } from './errors.js';
import { getNetworkInfo, getExplorerUrl, resolveKnownFastToken } from './defaults.js';
import { rpcCall } from './rpc.js';
import {
  FAST_DECIMALS,
  FAST_TOKEN_ID,
  tokenIdEquals,
  hexToTokenId,
} from './bcs.js';
import { addressToPubkey } from './address.js';
import { fromHex } from './utils.js';
import type { NetworkType, ProviderOptions, TokenInfo, TokenBalance } from './types.js';

const HEX_TOKEN_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

type FastAccountInfo = {
  balance?: string;
  token_balance?: Array<[number[], string]>;
  next_nonce?: number;
} | null;

type FastTokenMetadata = {
  token_name?: string;
  decimals?: number;
  total_supply?: string;
  admin?: number[];
  mints?: number[][];
};

type FastTokenInfoResponse = {
  requested_token_metadata?: Array<[number[], FastTokenMetadata | null]>;
} | null;

function isNativeFastToken(token: string): boolean {
  const upper = token.toUpperCase();
  return upper === 'FAST';
}

function tokenIdToHex(tokenId: number[] | Uint8Array): string {
  return Buffer.from(new Uint8Array(tokenId)).toString('hex').toLowerCase();
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

/**
 * FastProvider — Read-only connection to the Fast network.
 *
 * Use for querying balances, token info, and account data without a private key.
 *
 * @example
 * ```ts
 * const provider = new FastProvider({ network: 'testnet' });
 * const balance = await provider.getBalance('fast1...');
 * const tokenInfo = await provider.getTokenInfo('fastUSDC');
 * ```
 */
export class FastProvider {
  private _rpcUrl: string;
  private _network: NetworkType;
  private _explorerUrl: string | null = null;
  private _explicitExplorerUrl: boolean = false;
  private _initialized = false;

  constructor(opts?: ProviderOptions) {
    this._network = opts?.network ?? 'testnet';
    // Use provided RPC URL or fallback; will be updated in init() if needed
    this._rpcUrl = opts?.rpcUrl ?? 'https://staging.proxy.fastset.xyz';
    
    // Handle explicit explorer URL
    if (opts?.explorerUrl !== undefined) {
      this._explorerUrl = opts.explorerUrl;
      this._explicitExplorerUrl = true;
    }
    
    // If custom rpcUrl provided, skip network config loading entirely
    // (explorerUrl will be null unless explicitly provided)
    if (opts?.rpcUrl) {
      this._explicitExplorerUrl = true; // Don't load from network config
      this._initialized = true;
    }
  }

  /** Initialize the provider (loads network config if needed) */
  private async init(): Promise<void> {
    if (this._initialized) return;

    const networkInfo = await getNetworkInfo(this._network);
    if (networkInfo?.rpc) {
      this._rpcUrl = networkInfo.rpc;
    }
    // Only load explorer from config if not explicitly provided
    if (!this._explicitExplorerUrl) {
      this._explorerUrl = await getExplorerUrl(this._network);
    }
    this._initialized = true;
  }

  /** Get the RPC URL */
  get rpcUrl(): string {
    return this._rpcUrl;
  }

  /** Get the network */
  get network(): NetworkType {
    return this._network;
  }

  /** Get the explorer URL for a transaction. Returns null if no explorer configured. */
  async getExplorerUrl(txHash?: string): Promise<string | null> {
    await this.init();
    if (!this._explorerUrl) return null;
    return txHash ? `${this._explorerUrl}/txs/${txHash}` : this._explorerUrl;
  }

  /**
   * Get balance for an address.
   *
   * @param address - Fast address (fast1...)
   * @param token - Token symbol or hex ID (default: 'FAST')
   */
  async getBalance(address: string, token: string = 'FAST'): Promise<{ amount: string; token: string }> {
    await this.init();

    let pubkey: Uint8Array;
    try {
      pubkey = addressToPubkey(address);
    } catch {
      return { amount: '0', token };
    }

    const result = await this.fetchAccountInfo(pubkey);
    if (!result) return { amount: '0', token };

    // Native FAST balance
    if (isNativeFastToken(token)) {
      const hexBalance = result.balance ?? '0';
      return { amount: fromHex(hexBalance, FAST_DECIMALS), token: token.toUpperCase() };
    }

    // Non-native token by raw token ID
    if (HEX_TOKEN_PATTERN.test(token)) {
      const tokenIdBytes = hexToTokenId(token);
      const entry = result.token_balance?.find(([tid]) => tokenIdEquals(tid, tokenIdBytes));
      if (!entry) return { amount: '0', token };
      const [, bal] = entry;
      const rawBalance = stripHexPrefix(bal);
      const metadata = await this.fetchTokenMetadata([tokenIdBytes]);
      const decimals = metadata.get(tokenIdToHex(tokenIdBytes))?.decimals ?? FAST_DECIMALS;
      return { amount: fromHex(rawBalance, decimals), token };
    }

    // Known token symbol (e.g., 'fastUSDC')
    const known = await resolveKnownFastToken(token);
    if (known && known.tokenId !== 'native') {
      const tokenIdBytes = hexToTokenId(known.tokenId);
      const entry = result.token_balance?.find(([tid]) => tokenIdEquals(tid, tokenIdBytes));
      if (!entry) return { amount: '0', token: known.symbol };
      const [, bal] = entry;
      const rawBalance = stripHexPrefix(bal);
      return { amount: fromHex(rawBalance, known.decimals), token: known.symbol };
    }

    return { amount: '0', token };
  }

  /**
   * Get all token balances for an address.
   *
   * @param address - Fast address (fast1...)
   */
  async getTokens(address: string): Promise<TokenBalance[]> {
    await this.init();

    let pubkey: Uint8Array;
    try {
      pubkey = addressToPubkey(address);
    } catch {
      return [];
    }

    const result = await this.fetchAccountInfo(pubkey);
    if (!result) return [];

    const tokens: TokenBalance[] = [];

    // Native FAST
    if (result.balance) {
      tokens.push({
        symbol: 'FAST',
        tokenId: 'native',
        balance: fromHex(result.balance, FAST_DECIMALS),
        decimals: FAST_DECIMALS,
      });
    }

    // Other tokens
    if (result.token_balance && result.token_balance.length > 0) {
      const tokenIds = result.token_balance.map(([tid]) => new Uint8Array(tid));
      const metadata = await this.fetchTokenMetadata(tokenIds);

      for (const [tid, bal] of result.token_balance) {
        const tidHex = tokenIdToHex(tid);
        const meta = metadata.get(tidHex);
        const decimals = meta?.decimals ?? FAST_DECIMALS;
        const rawBalance = stripHexPrefix(bal);

        tokens.push({
          symbol: meta?.token_name ?? tidHex.slice(0, 8) + '...',
          tokenId: '0x' + tidHex,
          balance: fromHex(rawBalance, decimals),
          decimals,
        });
      }
    }

    return tokens;
  }

  /**
   * Get token info by symbol or hex token ID.
   *
   * @param token - Token symbol (e.g., 'fastUSDC') or hex token ID
   */
  async getTokenInfo(token: string): Promise<TokenInfo | null> {
    await this.init();

    const upper = token.toUpperCase();

    // Native FAST
    if (upper === 'FAST') {
      const known = await resolveKnownFastToken('FAST');
      return {
        name: 'FAST',
        symbol: 'FAST',
        tokenId: 'native',
        decimals: known?.decimals ?? FAST_DECIMALS,
      };
    }

    let tokenIdBytes: Uint8Array;

    // Hex token ID
    if (HEX_TOKEN_PATTERN.test(token)) {
      tokenIdBytes = hexToTokenId(token);
    } else {
      // Known symbol
      const known = await resolveKnownFastToken(token);
      if (known && known.tokenId !== 'native') {
        tokenIdBytes = hexToTokenId(known.tokenId);
      } else {
        return null;
      }
    }

    const metadata = await this.fetchTokenMetadata([tokenIdBytes]);
    const tidHex = tokenIdToHex(tokenIdBytes);
    const meta = metadata.get(tidHex);

    if (!meta) return null;

    return {
      name: meta.token_name ?? tidHex,
      symbol: meta.token_name ?? tidHex.slice(0, 8),
      tokenId: '0x' + tidHex,
      decimals: meta.decimals ?? FAST_DECIMALS,
      totalSupply: meta.total_supply,
      admin: meta.admin ? 'fast1' + Buffer.from(meta.admin).toString('hex').slice(0, 8) + '...' : undefined,
    };
  }

  /**
   * Get raw account info from RPC.
   */
  async getAccountInfo(address: string): Promise<FastAccountInfo> {
    await this.init();

    let pubkey: Uint8Array;
    try {
      pubkey = addressToPubkey(address);
    } catch {
      return null;
    }

    return this.fetchAccountInfo(pubkey);
  }

  /** Internal: fetch account info from RPC */
  private async fetchAccountInfo(pubkey: Uint8Array): Promise<FastAccountInfo> {
    return (await rpcCall(this._rpcUrl, 'proxy_getAccountInfo', {
      address: pubkey,
      token_balances_filter: [],
      state_key_filter: null,
      certificate_by_nonce: null,
    })) as FastAccountInfo;
  }

  /** Internal: fetch token metadata from RPC */
  private async fetchTokenMetadata(tokenIds: Uint8Array[]): Promise<Map<string, FastTokenMetadata>> {
    const uniq = new Map<string, Uint8Array>();
    for (const tokenId of tokenIds) {
      const key = tokenIdToHex(tokenId);
      if (!uniq.has(key)) {
        uniq.set(key, tokenId);
      }
    }
    if (uniq.size === 0) {
      return new Map();
    }

    const result = (await rpcCall(this._rpcUrl, 'proxy_getTokenInfo', {
      token_ids: [...uniq.values()],
    })) as FastTokenInfoResponse;

    const metadata = new Map<string, FastTokenMetadata>();
    for (const [tokenId, meta] of result?.requested_token_metadata ?? []) {
      if (meta) {
        metadata.set(tokenIdToHex(tokenId), meta);
      }
    }
    return metadata;
  }
}
