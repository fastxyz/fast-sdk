import { encodeFunctionData } from 'viem';
import { fastAddressToBytes32 } from './address.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildDepositTransactionParams {
  chainId: number;
  bridgeContract: `0x${string}`;
  tokenAddress: `0x${string}`;
  isNative?: boolean;
  amount: bigint;
  /** Receiver Fast address (fast1...) */
  receiver: string;
}

export interface EncodeDepositCalldataParams {
  tokenAddress: string;
  amount: bigint;
  receiverBytes32: `0x${string}`;
}

export interface DepositTransactionPlan {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  receiverBytes32: `0x${string}`;
}

// ---------------------------------------------------------------------------
// ABI
// ---------------------------------------------------------------------------

const BRIDGE_DEPOSIT_ABI = [{
  type: 'function' as const,
  name: 'deposit' as const,
  inputs: [
    { name: 'token', type: 'address' as const },
    { name: 'amount', type: 'uint256' as const },
    { name: 'receiver', type: 'bytes32' as const },
  ],
  outputs: [],
  stateMutability: 'payable' as const,
}];

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Encode calldata for the bridge deposit(token, amount, receiver) call.
 */
export function encodeDepositCalldata(params: EncodeDepositCalldataParams): `0x${string}` {
  return encodeFunctionData({
    abi: BRIDGE_DEPOSIT_ABI,
    functionName: 'deposit',
    args: [
      params.tokenAddress as `0x${string}`,
      params.amount,
      params.receiverBytes32,
    ],
  });
}

/**
 * Build a deposit transaction plan for bridging tokens from EVM to Fast network.
 *
 * All configuration values (chainId, bridgeContract, tokenAddress) must be
 * provided by the caller — this function contains no embedded config.
 *
 * @example
 * ```ts
 * const plan = buildDepositTransaction({
 *   chainId: 421614,
 *   bridgeContract: '0xb536...',
 *   tokenAddress: '0x75fa...',
 *   amount: 1000000n,
 *   receiver: 'fast1abc...',
 * });
 * // plan.to, plan.data, plan.value are ready to send via viem walletClient
 * ```
 */
export function buildDepositTransaction(
  params: BuildDepositTransactionParams,
): DepositTransactionPlan {
  const receiverBytes32 = fastAddressToBytes32(params.receiver);
  return {
    chainId: params.chainId,
    to: params.bridgeContract,
    data: encodeDepositCalldata({
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      receiverBytes32,
    }),
    value: params.isNative ? params.amount : 0n,
    receiverBytes32,
  };
}
