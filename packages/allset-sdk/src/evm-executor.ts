import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrum, arbitrumSepolia, base, mainnet as ethereum, sepolia } from 'viem/chains';

/**
 * Account-compatible wallet returned by createEvmWallet().
 *
 * Includes the normalized private key so generated accounts can be persisted
 * or reconstructed by the caller.
 */
export type EvmAccount = Account & {
  privateKey: `0x${string}`;
};

function normalizePrivateKey(privateKey: string): `0x${string}` {
  return (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
}

/**
 * Create an EVM wallet from an optional private key.
 *
 * @param privateKey - Optional. If omitted, generates a new random wallet.
 *   Accepts a hex private key (64 chars, with or without 0x prefix).
 *
 * @returns Account-compatible object with viem signing methods and `privateKey`
 *
 * @example
 * ```ts
 * // Generate new wallet
 * const account = createEvmWallet();
 * console.log(account.address);    // 0x...
 * console.log(account.privateKey); // persist this to reuse the wallet
 *
 * // Restore from private key
 * const account = createEvmWallet('0x1234...64hexchars');
 * ```
 */
export function createEvmWallet(privateKey?: string): EvmAccount {
  const key = privateKey ? normalizePrivateKey(privateKey) : generatePrivateKey();
  return Object.assign(privateKeyToAccount(key), { privateKey: key });
}

/** ERC20 ABI for allowance and approve */
export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

/** Bundled supported chain mappings */
export const CHAIN_MAP: Record<number, Chain> = {
  1: ethereum,
  11155111: sepolia,
  421614: arbitrumSepolia,
  42161: arbitrum,
  8453: base,
};

/**
 * EVM clients returned by createEvmExecutor.
 */
export interface EvmClients {
  walletClient: WalletClient;
  publicClient: PublicClient;
}

/**
 * Create viem wallet and public clients for EVM operations.
 *
 * @param account - viem Account from createEvmWallet() or privateKeyToAccount()
 * @param rpcUrl - RPC endpoint URL
 * @param chainOrId - A viem Chain object, or a chain ID number (looked up in CHAIN_MAP).
 *
 * @example
 * ```ts
 * import { arbitrumSepolia } from 'viem/chains';
 *
 * const account = createEvmWallet('0xabc123...');
 * // Pass a Chain object directly (preferred — no hardcoded map):
 * const { walletClient, publicClient } = createEvmExecutor(account, rpcUrl, arbitrumSepolia);
 * // Or pass a chain ID (uses built-in CHAIN_MAP):
 * const { walletClient, publicClient } = createEvmExecutor(account, rpcUrl, 421614);
 * ```
 */
export function createEvmExecutor(
  account: Account,
  rpcUrl: string,
  chainOrId: Chain | number,
): EvmClients {
  const chain =
    typeof chainOrId === 'number' ? resolveChain(chainOrId) : chainOrId;

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  return { walletClient, publicClient };
}

function resolveChain(chainId: number): Chain {
  const chain = CHAIN_MAP[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported EVM chain ID: ${chainId}. Supported: ${Object.keys(CHAIN_MAP).join(', ')}. ` +
        `Pass a viem Chain object directly to avoid this restriction.`,
    );
  }
  return chain;
}
