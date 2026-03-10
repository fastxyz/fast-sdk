/**
 * types.ts — Fast SDK types
 */

/** Network types */
export type NetworkType = 'testnet' | 'mainnet';

/* ─────────────────────────────────────────────────────────────────────────────
 * Provider Types
 * ───────────────────────────────────────────────────────────────────────────── */

/** Options for creating a FastProvider */
export interface ProviderOptions {
  /** Network to connect to (default: 'testnet') */
  network?: NetworkType;
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** Custom explorer URL (overrides network default) */
  explorerUrl?: string;
}

/** Token info returned by provider queries */
export interface TokenInfo {
  name: string;
  symbol: string;
  tokenId: string;
  decimals: number;
  totalSupply?: string;
  admin?: string;
  minters?: string[];
}

/** Token balance entry */
export interface TokenBalance {
  symbol: string;
  tokenId: string;
  balance: string;
  decimals: number;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Wallet Types
 * ───────────────────────────────────────────────────────────────────────────── */

/** Options for creating a FastWallet from keyfile */
export interface WalletKeyfileOptions {
  /** Path to keyfile (default: ~/.fast/keys/default.json) */
  keyFile?: string;
  /** Named key - resolves to ~/.fast/keys/{key}.json */
  key?: string;
  /** Create new key if keyfile doesn't exist (default: true) */
  createIfMissing?: boolean;
}

/** Result of a send operation */
export interface SendResult {
  txHash: string;
  explorerUrl: string | null;
}

/** Result of a sign operation */
export interface SignResult {
  signature: string;
  address: string;
}

/** Result of a submit operation */
export interface SubmitResult {
  txHash: string;
  certificate: unknown;
}

/** Exported wallet keys (never includes private key) */
export interface ExportedKeys {
  publicKey: string;
  address: string;
}
