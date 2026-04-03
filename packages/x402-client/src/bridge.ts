/**
 * Bridge integration for x402-client
 *
 * Bridges USDC from Fast to EVM chains when needed.
 * Uses @fastxyz/allset-sdk executeWithdraw() with the signer+provider API.
 */

import { executeWithdraw } from '@fastxyz/allset-sdk';
import { FastProvider, Signer, toFastAddress, toHex } from '@fastxyz/fast-sdk';
import type { FastWallet } from './types.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface BridgeParams {
  /** Fast wallet with USDC */
  fastWallet: FastWallet;
  /** EVM address to receive USDC */
  evmReceiverAddress: string;
  /** Amount to bridge (raw, 6 decimals) */
  amount: bigint;
  /** Fast RPC URL */
  rpcUrl: string;
  /** AllSet Fast bridge address */
  fastBridgeAddress: string;
  /** AllSet relayer URL */
  relayerUrl: string;
  /** AllSet cross-sign URL */
  crossSignUrl: string;
  /** USDC address on the target EVM chain */
  tokenEvmAddress: string;
  /** Token ID on Fast network (hex, no 0x prefix) */
  tokenFastTokenId: string;
  /** Fast network ID (e.g. 'fast:testnet') */
  networkId: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Log collector */
  logs?: string[];
}

export interface BridgeResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ─── Public Functions ─────────────────────────────────────────────────────────

/**
 * Get USDC balance on Fast network.
 */
export async function getFastBalance(wallet: FastWallet, options: { rpcUrl: string; tokenId: string }): Promise<bigint> {
  const provider = new FastProvider({ rpcUrl: options.rpcUrl });
  const signer = new Signer(wallet.privateKey);
  const publicKey = await signer.getPublicKey();

  try {
    const accountInfo = await provider.getAccountInfo({
      address: publicKey,
      tokenBalancesFilter: null,
      stateKeyFilter: null,
      certificateByNonce: null,
    });

    const tokenBalance = accountInfo.tokenBalance;
    if (!tokenBalance) return 0n;

    for (const [tokenIdBytes, balance] of tokenBalance) {
      const normalizedId = toHex(tokenIdBytes).replace(/^0x/, '');
      if (normalizedId === options.tokenId) {
        return balance as bigint;
      }
    }
    return 0n;
  } catch {
    return 0n;
  }
}

/**
 * Bridge USDC from Fast to EVM via AllSet.
 * Uses @fastxyz/allset-sdk executeWithdraw() with signer + provider.
 */
export async function bridgeFastusdcToUsdc(params: BridgeParams): Promise<BridgeResult> {
  const {
    fastWallet,
    evmReceiverAddress,
    amount,
    rpcUrl,
    fastBridgeAddress,
    relayerUrl,
    crossSignUrl,
    tokenEvmAddress,
    tokenFastTokenId,
    networkId,
    verbose = false,
    logs = [],
  } = params;

  const log = (msg: string) => {
    if (verbose) {
      logs.push(`[${new Date().toISOString()}] [Bridge] ${msg}`);
      logs.push('');
    }
  };

  log(`━━━ AllSet Bridge START ━━━`);
  log(`  Amount: ${Number(amount) / 1e6}`);
  log(`  From: ${fastWallet.address}`);
  log(`  To: ${evmReceiverAddress}`);

  try {
    const provider = new FastProvider({ rpcUrl });
    const signer = new Signer(fastWallet.privateKey);

    // Verify address matches
    const publicKey = await signer.getPublicKey();
    const derivedAddress = toFastAddress(publicKey);
    if (derivedAddress !== fastWallet.address) {
      throw new Error(`Address mismatch: expected ${fastWallet.address}, got ${derivedAddress}`);
    }
    log(`  ✓ Address verified: ${derivedAddress}`);

    // Use executeWithdraw which handles simple Fast → EVM transfers
    log(`[Step] Calling executeWithdraw()...`);
    const result = await executeWithdraw({
      fastBridgeAddress,
      relayerUrl,
      crossSignUrl,
      tokenEvmAddress,
      tokenFastTokenId,
      amount: amount.toString(),
      receiverEvmAddress: evmReceiverAddress,
      networkId,
      signer,
      provider,
    });

    log(`  ✓ Bridge submitted: ${result.txHash}`);
    log(`  Order ID: ${result.orderId}`);
    log(`━━━ AllSet Bridge END ━━━`);

    return { success: true, txHash: result.txHash };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`  ✗ Bridge failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
