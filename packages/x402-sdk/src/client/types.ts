/**
 * x402 Client Types
 */

/**
 * Payment requirement from 402 response
 */
export interface PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset?: string;
  extra?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
}

/**
 * Parsed 402 response
 */
export interface PaymentRequired {
  x402Version?: number;
  accepts?: PaymentRequirement[];
}

/**
 * Fast wallet configuration
 */
export interface FastWallet {
  type: 'fast';
  privateKey: string;  // Hex-encoded Ed25519 private key
  publicKey: string;   // Hex-encoded Ed25519 public key
  address: string;     // bech32m address (fast1...)
  rpcUrl?: string;     // Fast RPC endpoint
}

/**
 * EVM wallet configuration
 */
export interface EvmWallet {
  type: 'evm';
  privateKey: `0x${string}`;  // Hex-encoded secp256k1 private key
  address: `0x${string}`;     // Ethereum address
}

/**
 * Combined wallet type
 */
export type Wallet = FastWallet | EvmWallet;

/**
 * x402Pay parameters
 */
export interface X402PayParams {
  /** URL of the x402-protected resource */
  url: string;
  /** HTTP method (default: GET) */
  method?: string;
  /** Custom headers to include in the request */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT) */
  body?: string;
  /** Wallet(s) to use for payment */
  wallet: Wallet | Wallet[];
  /** Bridge configuration for auto-bridge from Fast to EVM */
  bridgeConfig?: {
    rpcUrl: string;
    fastBridgeAddress: string;
    relayerUrl: string;
    crossSignUrl: string;
    tokenEvmAddress: string;
    tokenFastTokenId: string;
  };
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Payment details in response
 */
export interface PaymentDetails {
  network: string;
  amount: string;
  recipient: string;
  txHash: string;
  bridged?: boolean;
  bridgeTxHash?: string;
}

/**
 * x402Pay response
 */
export interface X402PayResult {
  /** Whether the request succeeded after payment */
  success: boolean;
  /** HTTP status code of final response */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body */
  body: unknown;
  /** Payment details (if payment was made) */
  payment?: PaymentDetails;
  /** Human-readable note */
  note: string;
  /** Debug logs (if verbose: true) */
  logs?: string[];
}

/**
 * EIP-3009 authorization parameters
 */
export interface Eip3009Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

/**
 * x402 payment payload for Fast
 */
export interface FastPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    type: 'signAndSendTransaction';
    transactionCertificate: unknown;
  };
}

/**
 * x402 payment payload for EVM (EIP-3009)
 */
export interface EvmPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: Eip3009Authorization;
  };
}
