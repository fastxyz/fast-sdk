/**
 * AllSet bridge integration for x402-client
 * 
 * Bridges USDC/testUSDC from Fast to USDC on EVM chains when needed.
 * Uses @fastxyz/allset-sdk executeIntent() for bridge operations.
 */

import {
  executeIntent,
  buildTransferIntent,
  fastAddressToBytes,
  type FastWalletLike,
} from '@fastxyz/allset-sdk';
import { FastProvider, Signer, TransactionBuilder, hashHex, toFastAddress, toHex } from '@fastxyz/fast-sdk';
import { bcsSchema } from '@fastxyz/fast-schema';
import type { FastWallet as X402FastWallet } from './types.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface BridgeParams {
  /** Fast wallet with USDC/testUSDC */
  fastWallet: X402FastWallet;
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
  /** Token ID on Fast network */
  tokenFastTokenId: string;
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

// ─── FastWalletLike Adapter ───────────────────────────────────────────────────

/**
 * Create a FastWalletLike adapter from x402 wallet credentials.
 * This bridges the x402 FastWallet type to allset-sdk's FastWalletLike interface.
 */
function createFastWalletAdapter(
  wallet: X402FastWallet,
  signer: Signer,
  provider: FastProvider,
  rpcUrl: string,
): FastWalletLike {
  return {
    address: wallet.address,
    async submit(params: { claim: Record<string, unknown> }) {
      // Get the public key
      const publicKey = await signer.getPublicKey();

      // Get current nonce
      const accountInfo = await provider.getAccountInfo({
        address: publicKey,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      });

      const isTestnet = rpcUrl.includes('testnet');
      const networkId = isTestnet ? 'fast:testnet' : 'fast:mainnet';

      // Build transaction with the given claim
      const builder = new TransactionBuilder({
        networkId,
        signer,
        nonce: accountInfo.nextNonce,
      });

      // The claim is a variant like { TokenTransfer: {...} } or { ExternalClaim: {...} }
      const claimKeys = Object.keys(params.claim);
      if (claimKeys.length !== 1) {
        throw new Error(`Expected exactly one claim type, got: ${claimKeys.join(', ')}`);
      }
      const claimType = claimKeys[0]!;
      const claimValue = params.claim[claimType];

      switch (claimType) {
        case 'TokenTransfer':
          builder.addTokenTransfer(claimValue as Parameters<typeof builder.addTokenTransfer>[0]);
          break;
        case 'ExternalClaim':
          builder.addExternalClaim(claimValue as Parameters<typeof builder.addExternalClaim>[0]);
          break;
        default:
          throw new Error(`Unsupported claim type in bridge adapter: ${claimType}`);
      }

      const envelope = await builder.sign();
      const submitResult = await provider.submitTransaction(envelope);

      if (submitResult.type !== 'Success') {
        throw new Error(`Fast transaction failed: ${submitResult.type}`);
      }

      const certificate = submitResult.value;
      const tx = certificate.envelope.transaction;
      const bcsInput = { [tx.type]: tx.value } as unknown as Parameters<typeof bcsSchema.VersionedTransaction.serialize>[0];
      const txHash = await hashHex(bcsSchema.VersionedTransaction, bcsInput);

      return { txHash, certificate };
    },
  };
}

// ─── Public Functions ─────────────────────────────────────────────────────────

/**
 * Get USDC/testUSDC balance on Fast network.
 */
export async function getFastBalance(
  wallet: X402FastWallet,
  options: { rpcUrl: string; tokenId: string },
): Promise<bigint> {
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
 * Bridge USDC/testUSDC from Fast to USDC on EVM via AllSet.
 * Uses @fastxyz/allset-sdk's executeIntent().
 */
export async function bridgeFastusdcToUsdc(params: BridgeParams): Promise<BridgeResult> {
  const {
    fastWallet, evmReceiverAddress, amount, rpcUrl,
    fastBridgeAddress, relayerUrl, crossSignUrl, tokenEvmAddress, tokenFastTokenId,
    verbose = false, logs = [],
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
  log(`  Using: @fastxyz/allset-sdk executeIntent()`);

  try {
    // Create provider and signer
    const provider = new FastProvider({ rpcUrl });
    const signer = new Signer(fastWallet.privateKey);

    // Create FastWalletLike adapter
    log(`[Step 1] Creating FastWalletLike adapter...`);
    const walletAdapter = createFastWalletAdapter(fastWallet, signer, provider, rpcUrl);
    
    // Verify address matches
    const publicKey = await signer.getPublicKey();
    const derivedAddress = toFastAddress(publicKey);
    if (derivedAddress !== fastWallet.address) {
      throw new Error(
        `Address mismatch: expected ${fastWallet.address}, got ${derivedAddress}`
      );
    }
    log(`  ✓ Wallet adapter created: ${derivedAddress}`);

    // Build transfer intent
    log(`[Step 2] Calling executeIntent()...`);
    const intent = buildTransferIntent(
      tokenEvmAddress as `0x${string}`,
      evmReceiverAddress as `0x${string}`,
    );

    const result = await executeIntent({
      fastBridgeAddress,
      relayerUrl,
      crossSignUrl,
      tokenEvmAddress,
      tokenFastTokenId,
      amount: amount.toString(),
      intents: [intent],
      externalAddress: evmReceiverAddress,
      fastWallet: walletAdapter,
    });

    log(`  ✓ Bridge submitted: ${result.txHash}`);
    log(`  Order ID: ${result.orderId}`);
    log(`  Estimated time: ${result.estimatedTime}`);
    log(`━━━ AllSet Bridge END ━━━`);

    return {
      success: true,
      txHash: result.txHash,
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`  ✗ Bridge failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
