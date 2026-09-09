import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Account, type Chain, type PublicClient, type WalletClient } from 'viem';
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

/** ERC20 ABI for allowance, approve, and balanceOf */
export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

/**
 * Arc mainnet (Circle's USDC-native L1). Not shipped by viem, so defined here.
 * USDC is the gas token; its ERC-20 interface lives at 0x3600...0000 (6 decimals).
 * No default RPC: callers pass the URL to createEvmExecutor().
 */
export const arc: Chain = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
  custom: {
    /** ERC-20 interface of the gas token: the same USDC balance the chain burns for fees. */
    gasTokenErc20: '0x3600000000000000000000000000000000000000',
  },
});

/**
 * ERC-20 address of the chain's gas token, when the gas token is also an ERC-20
 * that users deposit (Arc: USDC). Undefined for chains whose gas token (ETH, POL)
 * is not a bridged ERC-20.
 */
export function gasTokenErc20(chain: Chain | undefined): `0x${string}` | undefined {
  const v = (chain?.custom as { gasTokenErc20?: string } | undefined)?.gasTokenErc20;
  return v ? (v as `0x${string}`) : undefined;
}

/** Gas units budgeted for an ERC-20 approve followed by a bridge deposit. */
export const DEPOSIT_GAS_UNITS = 300_000n;

/**
 * Estimate, in native wei, the fee budget for `gasUnits` at the current fee level,
 * scaled by `multiplier` as a safety margin against fee movement.
 */
export async function estimateGasReserve(
  publicClient: PublicClient,
  gasUnits: bigint = DEPOSIT_GAS_UNITS,
  multiplier: bigint = 2n,
): Promise<bigint> {
  let feePerGas: bigint;
  try {
    const fees = await publicClient.estimateFeesPerGas();
    feePerGas = fees.maxFeePerGas ?? (fees as { gasPrice?: bigint }).gasPrice ?? 0n;
  } catch {
    feePerGas = await publicClient.getGasPrice();
  }
  return feePerGas * gasUnits * multiplier;
}

/** `estimateGasReserve` for callers that only have an RPC URL. */
export async function estimateGasReserveAt(
  rpcUrl: string,
  gasUnits: bigint = DEPOSIT_GAS_UNITS,
  multiplier: bigint = 2n,
): Promise<bigint> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return estimateGasReserve(client, gasUnits, multiplier);
}

/**
 * Convert a native-wei amount (18 decimals) into the smallest units of a token with
 * `tokenDecimals`, rounding up.
 */
export function weiToTokenUnits(wei: bigint, tokenDecimals: number): bigint {
  const scale = 10n ** BigInt(18 - tokenDecimals);
  return (wei + scale - 1n) / scale;
}

/** Bundled supported chain mappings */
export const CHAIN_MAP: Record<number, Chain> = {
  1: ethereum,
  11155111: sepolia,
  421614: arbitrumSepolia,
  42161: arbitrum,
  8453: base,
  5042: arc,
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
export function createEvmExecutor(account: Account, rpcUrl: string, chainOrId: Chain | number): EvmClients {
  const chain = typeof chainOrId === 'number' ? resolveChain(chainOrId) : chainOrId;

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

/**
 * Get the ERC-20 token balance of an EVM address.
 *
 * @param rpcUrl - EVM RPC endpoint
 * @param tokenAddress - ERC-20 contract address
 * @param ownerAddress - Account to query
 * @returns Raw balance as bigint (in token's smallest unit)
 */
export async function getEvmErc20Balance(rpcUrl: string, tokenAddress: string, ownerAddress: string): Promise<bigint> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return client.readContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ownerAddress as `0x${string}`],
  });
}

/**
 * Get the native token (ETH / gas token) balance of an EVM address.
 *
 * @param rpcUrl - EVM RPC endpoint
 * @param address - Account to query
 * @returns Balance in wei as bigint
 */
export async function getEvmNativeBalance(rpcUrl: string, address: string): Promise<bigint> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return client.getBalance({ address: address as `0x${string}` });
}
