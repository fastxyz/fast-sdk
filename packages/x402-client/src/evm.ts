/**
 * EVM payment handler for x402 using EIP-3009 transferWithAuthorization
 *
 * No hardcoded network config — all chain info provided via EvmChainConfig.
 * Includes auto-bridge from Fast when EVM USDC balance is insufficient.
 */

import { createPublicClient, http, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EvmChainConfig } from '@fastxyz/x402-types';
import type {
  EvmWallet,
  FastWallet,
  PaymentRequired,
  ClientPaymentRequirement,
  X402PayResult,
  Eip3009Authorization,
  BridgeConfig,
} from './types.js';
import { bridgeFastusdcToUsdc, getFastBalance } from './bridge.js';

/**
 * Get EVM USDC balance
 */
async function getEvmUsdcBalance(
  address: `0x${string}`,
  usdcAddress: `0x${string}`,
  chainId: number,
  rpcUrl: string,
): Promise<bigint> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  try {
    const balance = await client.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
    return balance;
  } catch {
    return 0n;
  }
}

/**
 * Poll for USDC balance to reach target
 */
async function pollForBalance(
  address: `0x${string}`,
  usdcAddress: `0x${string}`,
  chainId: number,
  rpcUrl: string,
  targetAmount: bigint,
  maxWaitMs: number = 120000,
  pollIntervalMs: number = 3000,
  log: (msg: string) => void = () => {},
): Promise<{ arrived: boolean; balance: bigint }> {
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    pollCount++;

    const balance = await getEvmUsdcBalance(address, usdcAddress, chainId, rpcUrl);
    log(`  [Poll ${pollCount}] Balance: ${Number(balance) / 1e6} USDC (need ${Number(targetAmount) / 1e6})`);

    if (balance >= targetAmount) {
      return { arrived: true, balance };
    }
  }

  return { arrived: false, balance: 0n };
}

/**
 * Handle x402 payment on EVM networks using EIP-3009.
 *
 * @param evmChainConfig  Chain config provided by the caller (no hardcoded defaults).
 */
export async function handleEvmPayment(
  url: string,
  method: string,
  customHeaders: Record<string, string>,
  requestBody: string | undefined,
  paymentRequired: PaymentRequired,
  evmReq: ClientPaymentRequirement,
  wallet: EvmWallet,
  evmChainConfig: EvmChainConfig,
  verbose: boolean = false,
  logs: string[] = [],
  fastWallet?: FastWallet,
  bridgeConfig?: BridgeConfig,
): Promise<X402PayResult> {
  const log = (msg: string) => {
    if (verbose) {
      logs.push(`[${new Date().toISOString()}] ${msg}`);
      logs.push('');
    }
  };

  log(`━━━ EVM Payment Handler START ━━━`);
  log(`  Network: ${evmReq.network}`);
  log(`  Amount: ${evmReq.maxAmountRequired} (raw) = ${Number(evmReq.maxAmountRequired) / 1e6} USDC`);
  log(`  Recipient: ${evmReq.payTo}`);
  log(`  Asset (USDC): ${evmReq.asset}`);
  log(`  Chain ID: ${evmChainConfig.chainId}`);

  const account = privateKeyToAccount(wallet.privateKey);
  log(`  Payer address: ${account.address}`);

  const usdcAddress = (evmReq.asset ?? evmChainConfig.usdcAddress) as `0x${string}`;
  if (!usdcAddress) {
    throw new Error('No USDC asset address in payment requirements');
  }

  const requiredAmount = BigInt(evmReq.maxAmountRequired);
  let bridged = false;
  let bridgeTxHash: string | undefined;

  // ─── Auto-Bridge Logic ──────────────────────────────────────────────────────
  log(`[EVM] Checking USDC balance...`);
  let currentBalance = await getEvmUsdcBalance(account.address, usdcAddress, evmChainConfig.chainId, evmChainConfig.rpcUrl);
  log(`  Current balance: ${Number(currentBalance) / 1e6} USDC`);
  log(`  Required: ${Number(requiredAmount) / 1e6} USDC`);

  if (currentBalance < requiredAmount) {
    log(`  ⚠ Insufficient balance!`);

    if (!fastWallet) {
      throw new Error(
        `Insufficient USDC balance: have ${Number(currentBalance) / 1e6}, need ${Number(requiredAmount) / 1e6}. ` +
        `Provide a Fast wallet with USDC to enable auto-bridge.`
      );
    }

    if (!bridgeConfig) {
      throw new Error(
        `Insufficient USDC balance and no bridge config provided for ${evmReq.network}`
      );
    }

    log(`[EVM] Checking Fast USDC balance...`);
    const fastBalance = await getFastBalance(fastWallet, {
      rpcUrl: bridgeConfig.rpcUrl,
      tokenId: bridgeConfig.tokenFastTokenId,
    });
    log(`  Fast USDC balance: ${Number(fastBalance) / 1e6}`);

    const shortfall = requiredAmount - currentBalance;
    if (fastBalance < shortfall) {
      throw new Error(
        `Insufficient balance for payment. ` +
        `EVM USDC: ${Number(currentBalance) / 1e6}, Fast USDC: ${Number(fastBalance) / 1e6}, ` +
        `Need: ${Number(requiredAmount) / 1e6}`
      );
    }

    log(`[EVM] Auto-bridging ${Number(shortfall) / 1e6} USDC via AllSet...`);
    const bridgeStartTime = Date.now();

    const bridgeResult = await bridgeFastusdcToUsdc({
      fastWallet,
      evmReceiverAddress: account.address,
      amount: shortfall,
      rpcUrl: bridgeConfig.rpcUrl,
      fastBridgeAddress: bridgeConfig.fastBridgeAddress,
      relayerUrl: bridgeConfig.relayerUrl,
      crossSignUrl: bridgeConfig.crossSignUrl,
      tokenEvmAddress: bridgeConfig.tokenEvmAddress,
      tokenFastTokenId: bridgeConfig.tokenFastTokenId,
      networkId: bridgeConfig.networkId,
      verbose,
      logs,
    });

    if (!bridgeResult.success) {
      throw new Error(`Auto-bridge failed: ${bridgeResult.error}`);
    }

    bridged = true;
    bridgeTxHash = bridgeResult.txHash;
    log(`  ✓ Bridge submitted: ${bridgeTxHash}`);

    log(`[EVM] Waiting for USDC to arrive...`);
    const pollResult = await pollForBalance(
      account.address,
      usdcAddress,
      evmChainConfig.chainId,
      evmChainConfig.rpcUrl,
      requiredAmount,
      120000,
      3000,
      log,
    );

    if (!pollResult.arrived) {
      throw new Error(
        `Bridge submitted (${bridgeTxHash}) but USDC has not arrived after 2 minutes. ` +
        `The bridge may still be processing. Check your balance later and retry.`
      );
    }

    const bridgeDuration = Date.now() - bridgeStartTime;
    currentBalance = pollResult.balance;
    log(`  ✓ USDC arrived in ${bridgeDuration}ms`);
    log(`  New balance: ${Number(currentBalance) / 1e6} USDC`);
  } else {
    log(`  ✓ Sufficient balance`);
  }

  // ─── EIP-3009 Authorization ─────────────────────────────────────────────────
  log(`[EVM] Building EIP-3009 transferWithAuthorization...`);
  const authorization: Eip3009Authorization = {
    from: account.address,
    to: evmReq.payTo as `0x${string}`,
    value: evmReq.maxAmountRequired,
    validAfter: '0',
    validBefore: String(Math.floor(Date.now() / 1000) + 3600),
    nonce: ('0x' + Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString('hex')) as `0x${string}`,
  };
  log(`  Authorization: ${JSON.stringify(authorization, null, 2)}`);

  const usdcName = evmReq.extra?.name ?? evmChainConfig.usdcName ?? 'USD Coin';
  const usdcVersion = evmReq.extra?.version ?? evmChainConfig.usdcVersion ?? '2';
  const domain = {
    name: usdcName,
    version: usdcVersion,
    chainId: evmChainConfig.chainId,
    verifyingContract: usdcAddress,
  };
  log(`  Domain: ${JSON.stringify(domain)}`);

  const authorizationTypes = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  log(`[EVM] Signing EIP-712 typed data...`);
  const signature = await account.signTypedData({
    domain,
    types: authorizationTypes,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  log(`  Signature: ${signature.slice(0, 20)}...`);

  log(`[EVM] Building x402 payment payload...`);
  const paymentPayload = {
    x402Version: paymentRequired.x402Version ?? 1,
    scheme: 'exact',
    network: evmReq.network,
    payload: {
      signature,
      authorization,
    },
  };

  const payloadBase64 = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  log(`  Payload base64 length: ${payloadBase64.length}`);

  log(`[EVM] Sending paid request with X-PAYMENT header...`);
  const paidRes = await fetch(url, {
    method,
    headers: { ...customHeaders, 'X-PAYMENT': payloadBase64 },
    body: requestBody,
  });
  log(`  Response: ${paidRes.status} ${paidRes.statusText}`);

  const resHeaders: Record<string, string> = {};
  paidRes.headers.forEach((v: string, k: string) => { resHeaders[k] = v; });

  let resBody: unknown;
  try { resBody = await paidRes.json(); } catch { resBody = await paidRes.text(); }

  let settleTxHash = signature.slice(0, 66);
  if (typeof resBody === 'object' && resBody !== null) {
    const rb = resBody as Record<string, unknown>;
    if (typeof rb.txHash === 'string') {
      settleTxHash = rb.txHash;
    }
  }

  const amountHuman = (Number(evmReq.maxAmountRequired) / 1e6).toString();
  const bridgeNote = bridged ? ` (auto-bridged ${bridgeTxHash?.slice(0, 10)}...)` : '';

  log(`━━━ EVM Payment Handler END ━━━`);

  return {
    success: paidRes.ok,
    statusCode: paidRes.status,
    headers: resHeaders,
    body: resBody,
    payment: {
      network: evmReq.network,
      amount: amountHuman,
      recipient: evmReq.payTo,
      txHash: settleTxHash,
      bridged,
      bridgeTxHash,
    },
    note: paidRes.ok
      ? `EVM payment of ${amountHuman} USDC successful${bridgeNote}. Content delivered.`
      : `Payment signed but server returned ${paidRes.status}.`,
    logs: verbose ? logs : undefined,
  };
}
