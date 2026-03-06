/**
 * types.ts — Fast SDK types
 */

/** Network types */
export type NetworkType = 'testnet' | 'mainnet';

/** Chain configuration */
export interface ChainConfig {
  rpc: string;
  keyfile: string;
  network: string;
  defaultToken: string;
}

/** Persisted SDK config (~/.fast/config.json) */
export interface FastConfig {
  chains: Record<string, ChainConfig>;
}

/** Client returned by the fast() factory — the primary SDK interface for agents */
export interface FastClient {
  /** Create or load a wallet, persist config. Must be called before other methods. */
  setup(): Promise<{ address: string }>;
  /** Get balance for native SET, a held custom token symbol like SETUSDC, or a hex token ID */
  balance(opts?: { token?: string }): Promise<{ amount: string; token: string }>;
  /** Send tokens to an address. Defaults to native SET; custom tokens can be passed by held symbol or hex token ID. */
  send(params: { to: string; amount: string; token?: string }): Promise<{ txHash: string; explorerUrl: string }>;
  /** Sign a message with the wallet's Ed25519 key */
  sign(params: { message: string | Uint8Array }): Promise<{ signature: string; address: string }>;
  /** Verify an Ed25519 signature against a fast1... address */
  verify(params: { message: string | Uint8Array; signature: string; address: string }): Promise<{ valid: boolean }>;
  /** List all tokens held on-chain with balances (queries the chain directly) */
  tokens(): Promise<Array<{ symbol: string; address: string; balance: string; decimals: number }>>;
  /** Get on-chain metadata for a token by held symbol or hex token ID */
  tokenInfo(params: { token: string }): Promise<{
    name: string;
    symbol: string;
    address: string;
    decimals: number;
    totalSupply?: string;
    admin?: string;
    minters?: string[];
  }>;
  /** Submit any claim to the Fast chain. Returns txHash and certificate. */
  submit(params: { recipient: string; claim: Record<string, unknown> }): Promise<{ txHash: string; certificate: unknown }>;
  /** Get EVM-compatible cross-signature for a transaction certificate */
  evmSign(params: { certificate: unknown }): Promise<{ transaction: number[]; signature: string }>;
  /** Export public key and address (never exposes private key) */
  exportKeys(): Promise<{ publicKey: string; address: string }>;
  /** The current wallet address, or null if setup() hasn't been called */
  readonly address: string | null;
}
