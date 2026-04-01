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

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fast RPC URLs */
const FAST_RPC_URLS = {
  testnet: 'https://testnet.api.fast.xyz/proxy',
  mainnet: 'https://api.fast.xyz/proxy',
} as const;

/** USDC token ID on Fast mainnet */
const MAINNET_USDC_TOKEN_ID = 'c655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130';

/** testUSDC token ID on Fast testnet */
const TESTNET_USDC_TOKEN_ID = 'd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46';

// ─── Bridge Configurations (previously from AllSetProvider) ───────────────────

interface AllSetChainConfig {
  fastBridgeAddress: string;
  relayerUrl: string;
  crossSignUrl: string;
  tokenEvmAddress: string;
  tokenFastTokenId: string;
}

const ALLSET_CONFIGS: Record<string, AllSetChainConfig> = {
  'ethereum-sepolia': {
    fastBridgeAddress: process.env.ALLSET_ETH_SEPOLIA_BRIDGE_ADDRESS || '',
    relayerUrl: process.env.ALLSET_ETH_SEPOLIA_RELAYER_URL || '',
    crossSignUrl: process.env.ALLSET_CROSS_SIGN_URL || '',
    tokenEvmAddress: process.env.ALLSET_ETH_SEPOLIA_USDC_ADDRESS || '',
    tokenFastTokenId: TESTNET_USDC_TOKEN_ID,
  },
  'arbitrum-sepolia': {
    fastBridgeAddress: process.env.ALLSET_ARB_SEPOLIA_BRIDGE_ADDRESS || '',
    relayerUrl: process.env.ALLSET_ARB_SEPOLIA_RELAYER_URL || '',
    crossSignUrl: process.env.ALLSET_CROSS_SIGN_URL || '',
    tokenEvmAddress: process.env.ALLSET_ARB_SEPOLIA_USDC_ADDRESS || '',
    tokenFastTokenId: TESTNET_USDC_TOKEN_ID,
  },
  'arbitrum': {
    fastBridgeAddress: process.env.ALLSET_ARB_BRIDGE_ADDRESS || '',
    relayerUrl: process.env.ALLSET_ARB_RELAYER_URL || '',
    crossSignUrl: process.env.ALLSET_CROSS_SIGN_URL || '',
    tokenEvmAddress: process.env.ALLSET_ARB_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokenFastTokenId: MAINNET_USDC_TOKEN_ID,
  },
  'base': {
    fastBridgeAddress: process.env.ALLSET_BASE_BRIDGE_ADDRESS || '',
    relayerUrl: process.env.ALLSET_BASE_RELAYER_URL || '',
    crossSignUrl: process.env.ALLSET_CROSS_SIGN_URL || '',
    tokenEvmAddress: process.env.ALLSET_BASE_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenFastTokenId: MAINNET_USDC_TOKEN_ID,
  },
};

// ─── Cached Providers ─────────────────────────────────────────────────────────

const fastProviders: Record<string, FastProvider> = {};

function getFastProvider(network: 'testnet' | 'mainnet' = 'testnet'): FastProvider {
  if (!fastProviders[network]) {
    fastProviders[network] = new FastProvider({ 
      rpcUrl: FAST_RPC_URLS[network],
    });
  }
  return fastProviders[network];
}

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Bridge configuration per EVM chain */
export interface BridgeChainConfig {
  chainId: number;
  usdcAddress: string;
  fastBridgeAddress: string;
  relayerUrl: string;
  bridgeContract?: string;
}

export interface BridgeParams {
  /** Fast wallet with USDC/testUSDC */
  fastWallet: X402FastWallet;
  /** EVM address to receive USDC */
  evmReceiverAddress: string;
  /** Amount to bridge (raw, 6 decimals) */
  amount: bigint;
  /** Target EVM network (e.g., 'arbitrum-sepolia') */
  network: string;
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

      const isTestnet = !wallet.rpcUrl || wallet.rpcUrl.includes('testnet');
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
 * Get bridge configuration for a network.
 */
export function getBridgeConfig(network: string): BridgeChainConfig | null {
  const config = ALLSET_CONFIGS[network];
  if (!config || !config.fastBridgeAddress || !config.relayerUrl) {
    return null;
  }

  // Chain IDs for supported networks
  const chainIds: Record<string, number> = {
    'ethereum-sepolia': 11155111,
    'arbitrum-sepolia': 421614,
    'arbitrum': 42161,
    'base': 8453,
  };

  return {
    chainId: chainIds[network] || 0,
    usdcAddress: config.tokenEvmAddress,
    fastBridgeAddress: config.fastBridgeAddress,
    relayerUrl: config.relayerUrl,
  };
}

/**
 * Get USDC/testUSDC balance on Fast network.
 */
export async function getFastBalance(wallet: X402FastWallet): Promise<bigint> {
  const isTestnet = !wallet.rpcUrl || wallet.rpcUrl.includes('testnet');
  const provider = getFastProvider(isTestnet ? 'testnet' : 'mainnet');
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

    // Check for both mainnet USDC and testnet testUSDC
    const targetTokenId = isTestnet ? TESTNET_USDC_TOKEN_ID : MAINNET_USDC_TOKEN_ID;
    for (const [tokenIdBytes, balance] of tokenBalance) {
      const normalizedId = toHex(tokenIdBytes).replace(/^0x/, '');
      if (normalizedId === targetTokenId) {
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
  const { fastWallet, evmReceiverAddress, amount, network, verbose = false, logs = [] } = params;
  
  const log = (msg: string) => {
    if (verbose) {
      logs.push(`[${new Date().toISOString()}] [Bridge] ${msg}`);
      logs.push('');
    }
  };

  // Determine network type
  const isTestnet = network.includes('sepolia');
  const allsetNetwork = isTestnet ? 'testnet' : 'mainnet';
  const tokenName = isTestnet ? 'testUSDC' : 'USDC';
  
  log(`━━━ AllSet Bridge START ━━━`);
  log(`  Amount: ${Number(amount) / 1e6} ${tokenName}`);
  log(`  From: ${fastWallet.address}`);
  log(`  To: ${evmReceiverAddress} on ${network}`);
  log(`  Using: @fastxyz/allset-sdk executeIntent()`);

  const config = ALLSET_CONFIGS[network];
  if (!config || !config.fastBridgeAddress || !config.relayerUrl || !config.crossSignUrl) {
    return {
      success: false,
      error: `Bridge not configured for network ${network}. Set ALLSET_* environment variables.`,
    };
  }

  try {
    // Create provider and signer
    const provider = getFastProvider(allsetNetwork);
    const signer = new Signer(fastWallet.privateKey);

    // Create FastWalletLike adapter
    log(`[Step 1] Creating FastWalletLike adapter...`);
    const walletAdapter = createFastWalletAdapter(fastWallet, signer, provider);
    
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
      config.tokenEvmAddress as `0x${string}`,
      evmReceiverAddress as `0x${string}`,
    );

    const result = await executeIntent({
      fastBridgeAddress: config.fastBridgeAddress,
      relayerUrl: config.relayerUrl,
      crossSignUrl: config.crossSignUrl,
      tokenEvmAddress: config.tokenEvmAddress,
      tokenFastTokenId: config.tokenFastTokenId,
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
