/**
 * intents.ts — Intent builders for AllSet external execution
 *
 * Intents define what actions to perform on EVM chains after
 * transferring tokens from Fast network.
 */

import { encodeAbiParameters } from 'viem';
import { fastAddressToBytes32 } from './address.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Intent action types supported by AllSet bridge.
 */
export enum IntentAction {
  /** Generic contract call */
  Execute = 0,
  /** ERC-20 transfer to address */
  DynamicTransfer = 1,
  /** Deposit tokens back to Fast network */
  DynamicDeposit = 2,
  /** Cancel/revoke pending intent */
  Revoke = 3,
}

/**
 * An intent to execute on an EVM chain.
 */
export interface Intent {
  /** The action type */
  action: IntentAction;
  /** ABI-encoded payload for the action */
  payload: `0x${string}`;
  /** Native token value (ETH) to send, 0 for ERC-20 operations */
  value: bigint;
}

// ---------------------------------------------------------------------------
// Intent Builders
// ---------------------------------------------------------------------------

/**
 * Build a transfer intent to send ERC-20 tokens to an address.
 *
 * @param token - ERC-20 token contract address
 * @param receiver - Recipient EVM address
 * @returns Intent for DynamicTransfer action
 *
 * @example
 * ```ts
 * const intent = buildTransferIntent(
 *   '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC
 *   '0xRecipientAddress'
 * );
 * ```
 */
export function buildTransferIntent(token: string, receiver: string): Intent {
  const payload = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [token as `0x${string}`, receiver as `0x${string}`]);
  return {
    action: IntentAction.DynamicTransfer,
    payload,
    value: 0n,
  };
}

/**
 * Build a generic execute intent for arbitrary contract calls.
 *
 * @param target - Target contract address
 * @param calldata - ABI-encoded function call data
 * @param value - Native token value to send (default: 0)
 * @returns Intent for Execute action
 *
 * @example
 * ```ts
 * // Call a contract function
 * const calldata = encodeFunctionData({
 *   abi: contractAbi,
 *   functionName: 'someFunction',
 *   args: [arg1, arg2],
 * });
 * const intent = buildExecuteIntent('0xContractAddress', calldata);
 * ```
 */
export function buildExecuteIntent(target: string, calldata: string, value: bigint = 0n): Intent {
  const payload = encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [target as `0x${string}`, calldata as `0x${string}`]);
  return {
    action: IntentAction.Execute,
    payload,
    value,
  };
}

/**
 * Build an intent to deposit tokens back to Fast network.
 *
 * @param token - ERC-20 token contract address on EVM
 * @param fastReceiver - Fast network recipient address (fast1...)
 * @returns Intent for DynamicDeposit action
 *
 * @example
 * ```ts
 * const intent = buildDepositBackIntent(
 *   '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC
 *   'fast1recipientaddress...'
 * );
 * ```
 */
export function buildDepositBackIntent(token: string, fastReceiver: string): Intent {
  const receiverBytes = fastAddressToBytes32(fastReceiver);
  const payload = encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [token as `0x${string}`, receiverBytes]);
  return {
    action: IntentAction.DynamicDeposit,
    payload,
    value: 0n,
  };
}

/**
 * Build a revoke intent to cancel pending operations.
 *
 * @returns Intent for Revoke action
 *
 * @example
 * ```ts
 * const intent = buildRevokeIntent();
 * ```
 */
export function buildRevokeIntent(): Intent {
  return {
    action: IntentAction.Revoke,
    payload: '0x',
    value: 0n,
  };
}
