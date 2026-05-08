import { TransactionCertificateFromRpc } from "@fastxyz/schema";
import { TransactionBuilder } from "@fastxyz/sdk";
import { Schema } from "effect";
import { decodeAbiParameters } from "viem";
import { fastAddressToBytes } from "./address.js";
import { encodeIntentClaim, extractClaimId } from "./claims.js";
import { buildDepositTransaction } from "./deposit.js";
import { FastError } from "./errors.js";
import { ERC20_ABI, type EvmClients } from "./evm.js";
import { buildTransferIntent, type Intent, IntentAction } from "./intents.js";
import { relayExecute } from "./relay.js";
import type {
  BridgeResult,
  ExecuteDepositParams,
  ExecuteIntentParams,
  ExecuteWithdrawParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bigIntToNumber(obj: unknown): unknown {
  if (typeof obj === "bigint") return Number(obj);
  if (obj instanceof Uint8Array) return Array.from(obj);
  if (Array.isArray(obj)) return obj.map(bigIntToNumber);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = bigIntToNumber(value);
    }
    return result;
  }
  return obj;
}

function resolveExternalAddress(
  intents: Intent[],
  externalAddressOverride?: string,
): `0x${string}` | null {
  if (externalAddressOverride) return externalAddressOverride as `0x${string}`;

  for (const intent of intents) {
    if (intent.action === IntentAction.DynamicTransfer) {
      try {
        const [, receiver] = decodeAbiParameters(
          [{ type: "address" }, { type: "address" }],
          intent.payload,
        );
        return receiver;
      } catch {
        continue;
      }
    }
    if (intent.action === IntentAction.Execute) {
      try {
        const [target] = decodeAbiParameters(
          [{ type: "address" }, { type: "bytes" }],
          intent.payload,
        );
        return target;
      } catch {}
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// EVM transaction helpers
// ---------------------------------------------------------------------------

async function sendTx(
  clients: EvmClients,
  tx: { to: string; data: string; value: string; gas?: string },
): Promise<{ txHash: string; status: "success" | "reverted" }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walletClient = clients.walletClient as any;
  const hash = await walletClient.sendTransaction({
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value),
    gas: tx.gas ? BigInt(tx.gas) : undefined,
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({
    hash,
  });
  return {
    txHash: hash,
    status: receipt.status === "success" ? "success" : "reverted",
  };
}

async function checkAllowance(
  clients: EvmClients,
  token: string,
  spender: string,
  owner: string,
): Promise<bigint> {
  return clients.publicClient.readContract({
    address: token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`],
  });
}

async function approveErc20(
  clients: EvmClients,
  token: string,
  spender: string,
  amount: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walletClient = clients.walletClient as any;
  const hash = await walletClient.writeContract({
    address: token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender as `0x${string}`, BigInt(amount)],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new FastError(
      "TX_FAILED",
      `ERC-20 approve transaction reverted: ${hash}`,
      {
        note: "Check that you have sufficient ETH for gas fees.",
      },
    );
  }

  // Wait until the RPC reflects the updated allowance before proceeding.
  // Load-balanced RPC nodes can lag behind, causing the deposit's eth_estimateGas
  // to see stale state (allowance=0) and revert even though the approve was confirmed.
  const amountBig = BigInt(amount);
  const walletAddress = walletClient.account?.address as `0x${string}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await checkAllowance(clients, token, spender, walletAddress);
    if (current >= amountBig) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// ---------------------------------------------------------------------------
// evmSign
// ---------------------------------------------------------------------------

export interface EvmSignResult {
  transaction: number[];
  signature: string;
}

/**
 * Request EVM cross-signing for a Fast network certificate.
 *
 * @param certificate - Certificate from fastWallet.submit()
 * @param crossSignUrl - AllSet cross-sign service URL (required)
 */
export async function evmSign(
  certificate: unknown,
  crossSignUrl: string,
): Promise<EvmSignResult> {
  const wireFormat = Schema.encodeSync(TransactionCertificateFromRpc)(
    certificate as never,
  );
  const serialized = bigIntToNumber(wireFormat);
  const res = await fetch(crossSignUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "crossSign_evmSignCertificate",
      params: { certificate: serialized },
    }),
  });

  if (!res.ok) {
    throw new FastError(
      "TX_FAILED",
      `Cross-sign request failed: ${res.status}`,
      {
        note: "The AllSet cross-sign service rejected the request.",
      },
    );
  }

  const json = (await res.json()) as {
    result?: { transaction: number[]; signature: string };
    error?: { message: string };
  };

  if (json.error) {
    throw new FastError(
      "TX_FAILED",
      `Cross-sign error: ${json.error.message}`,
      {
        note: "The certificate could not be cross-signed.",
      },
    );
  }

  if (!json.result?.transaction || !json.result?.signature) {
    throw new FastError("TX_FAILED", "Cross-sign returned invalid response", {
      note: "Missing transaction or signature in response.",
    });
  }

  return json.result;
}

// ---------------------------------------------------------------------------
// executeDeposit (EVM → Fast)
// ---------------------------------------------------------------------------

/**
 * Execute a deposit from an EVM chain to the Fast network.
 *
 * All configuration values must be provided by the caller.
 *
 * @example
 * ```ts
 * const result = await executeDeposit({
 *   chainId: 421614,
 *   bridgeContract: '0xb536...',
 *   tokenAddress: '0x75fa...',
 *   amount: '1000000',
 *   receiverAddress: 'fast1abc...',
 *   evmClients,
 * });
 * ```
 */
export async function executeDeposit(
  params: ExecuteDepositParams,
): Promise<BridgeResult> {
  const {
    chainId,
    bridgeContract,
    tokenAddress,
    isNative = false,
    amount,
    receiverAddress,
    evmClients,
  } = params;

  let depositPlan;
  try {
    depositPlan = buildDepositTransaction({
      chainId,
      bridgeContract,
      tokenAddress,
      isNative,
      amount: BigInt(amount),
      receiver: receiverAddress,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FastError(
      "INVALID_ADDRESS",
      `Failed to decode Fast receiver address "${receiverAddress}": ${msg}`,
      {
        note: "The receiver address must be a valid Fast network bech32m address (fast1...).",
      },
    );
  }

  let txHash: string;

  if (isNative) {
    const receipt = await sendTx(evmClients, {
      to: depositPlan.to,
      data: depositPlan.data,
      value: depositPlan.value.toString(),
    });
    if (receipt.status === "reverted") {
      throw new FastError(
        "TX_FAILED",
        `Deposit transaction reverted: ${receipt.txHash}`,
        {
          note: "Check that you have sufficient ETH balance.",
        },
      );
    }
    txHash = receipt.txHash;
  } else {
    await approveErc20(evmClients, tokenAddress, bridgeContract, amount);
    const receipt = await sendTx(evmClients, {
      to: depositPlan.to,
      data: depositPlan.data,
      value: depositPlan.value.toString(),
    });
    if (receipt.status === "reverted") {
      throw new FastError(
        "TX_FAILED",
        `Deposit transaction reverted: ${receipt.txHash}`,
        {
          note: "Check that you have sufficient token balance and the approval succeeded.",
        },
      );
    }
    txHash = receipt.txHash;
  }

  return { txHash, orderId: txHash, estimatedTime: "1-5 minutes" };
}

// ---------------------------------------------------------------------------
// executeIntent (Fast → EVM)
// ---------------------------------------------------------------------------

/**
 * Execute intents on an EVM chain after transferring tokens from the Fast network.
 *
 * This is the core function for all Fast→EVM flows:
 * - Simple withdrawal: use buildTransferIntent + executeIntent (or use executeWithdraw)
 * - Custom contract call: use buildExecuteIntent + executeIntent
 * - Deposit back to Fast: use buildDepositBackIntent + executeIntent
 *
 * All configuration values must be provided by the caller.
 *
 * @example
 * ```ts
 * import { Signer, FastProvider } from '@fastxyz/sdk';
 *
 * const signer = new Signer(privateKeyHex);
 * const provider = new FastProvider({ url: 'https://proxy.fast.xyz', networkId: 'fast:mainnet' });
 *
 * const intent = buildTransferIntent(tokenEvmAddress, receiverEvmAddress);
 * const result = await executeIntent({
 *   fastBridgeAddress: 'fast1...',
 *   relayerUrl: 'https://...',
 *   crossSignUrl: 'https://...',
 *   tokenEvmAddress: '0x...',
 *   tokenFastTokenId: 'abc123...',
 *   amount: '1000000',
 *   intents: [intent],
 *   signer,
 *   provider,
 *   networkId: 'fast:testnet',
 * });
 * ```
 */
export async function executeIntent(
  params: ExecuteIntentParams,
): Promise<BridgeResult> {
  const {
    fastBridgeAddress,
    relayerUrl,
    crossSignUrl,
    tokenEvmAddress,
    tokenFastTokenId,
    amount,
    intents,
    externalAddress: externalAddressOverride,
    deadlineSeconds = 3600,
    signer,
    provider,
    networkId,
  } = params;

  if (!intents || intents.length === 0) {
    throw new FastError(
      "INVALID_PARAMS",
      "executeIntent requires at least one intent",
      {
        note: "Use intent builders like buildTransferIntent(), buildExecuteIntent(), etc.",
      },
    );
  }

  if (externalAddressOverride && !externalAddressOverride.startsWith("0x")) {
    throw new FastError(
      "INVALID_PARAMS",
      "executeIntent externalAddress must be an EVM address",
      {
        note: "Pass a 0x-prefixed address for the relayer target.",
      },
    );
  }

  const tokenId = hexToUint8Array(tokenFastTokenId);
  const publicKey = await signer.getPublicKey();
  const fastAddress = await signer.getFastAddress();

  // Step 1: Transfer tokens to bridge address on Fast network
  const accountInfo1 = await provider.getAccountInfo({
    address: publicKey,
    tokenBalancesFilter: null,
    stateKeyFilter: null,
    certificateByNonce: null,
  });

  const transferEnvelope = await new TransactionBuilder({
    networkId: networkId as any,
    signer,
    nonce: accountInfo1.nextNonce,
  })
    .addTokenTransfer({
      tokenId,
      recipient: fastAddressToBytes(fastBridgeAddress),
      amount: BigInt(amount),
      userData: null,
    })
    .sign();

  const transferResult = await provider.submitTransaction(transferEnvelope);
  if (transferResult.type !== "Success") {
    throw new FastError(
      "TX_FAILED",
      `Token transfer submission incomplete: ${transferResult.type}`,
      {
        note: "The transfer transaction was not fully confirmed. Try again.",
      },
    );
  }

  // Step 2: Cross-sign the transfer certificate
  const transferCrossSign = await evmSign(transferResult.value, crossSignUrl);

  // Derive the Fast tx ID from cross-sign bytes[32:64] — this is the canonical transaction hash
  const transferFastTxId = extractClaimId(transferCrossSign.transaction);

  // Step 3: Build and encode the intent claim
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const intentClaimEncoded = encodeIntentClaim({
    transferFastTxId,
    deadline,
    intents,
  });
  const intentBytes = hexToUint8Array(intentClaimEncoded);

  // Step 4: Submit intent claim on Fast network
  const accountInfo2 = await provider.getAccountInfo({
    address: publicKey,
    tokenBalancesFilter: null,
    stateKeyFilter: null,
    certificateByNonce: null,
  });

  const intentEnvelope = await new TransactionBuilder({
    networkId: networkId as any,
    signer,
    nonce: accountInfo2.nextNonce,
  })
    .addExternalClaim({
      claim: {
        verifierCommittee: [],
        verifierQuorum: 0,
        claimData: intentBytes,
      },
      signatures: [],
    })
    .sign();

  const intentResult = await provider.submitTransaction(intentEnvelope);
  if (intentResult.type !== "Success") {
    throw new FastError(
      "TX_FAILED",
      `Intent claim submission incomplete: ${intentResult.type}`,
      {
        note: "The intent claim transaction was not fully confirmed. Try again.",
      },
    );
  }

  // Step 5: Cross-sign the intent certificate
  const intentCrossSign = await evmSign(intentResult.value, crossSignUrl);
  const intentFastTxId = extractClaimId(intentCrossSign.transaction);

  // Step 6: Resolve external address and submit to relayer
  const externalAddress = resolveExternalAddress(
    intents,
    externalAddressOverride,
  );
  if (!externalAddress) {
    throw new FastError(
      "INVALID_PARAMS",
      "executeIntent requires externalAddress when intents do not include a transfer recipient or execute target",
      {
        note: "Pass externalAddress for flows like buildDepositBackIntent() or buildRevokeIntent().",
      },
    );
  }

  await relayExecute({
    relayerUrl,
    encodedTransferClaim: Array.from(
      new Uint8Array(transferCrossSign.transaction.map(Number)),
    ),
    transferProof: transferCrossSign.signature,
    transferFastTxId,
    fastsetAddress: fastAddress,
    externalAddress,
    encodedIntentClaim: Array.from(
      new Uint8Array(intentCrossSign.transaction.map(Number)),
    ),
    intentProof: intentCrossSign.signature,
    intentFastTxId,
    intentClaimId: intentFastTxId,
    externalTokenAddress: tokenEvmAddress,
  });

  return {
    txHash: transferFastTxId,
    orderId: transferFastTxId,
    estimatedTime: "1-5 minutes",
  };
}

// ---------------------------------------------------------------------------
// executeWithdraw (Fast → EVM simple withdrawal)
// ---------------------------------------------------------------------------

/**
 * Withdraw tokens from the Fast network to an EVM address.
 *
 * This is a convenience wrapper around executeIntent that builds a
 * DynamicTransfer intent automatically.
 *
 * @example
 * ```ts
 * import { Signer, FastProvider } from '@fastxyz/sdk';
 *
 * const signer = new Signer(privateKeyHex);
 * const provider = new FastProvider({ url: 'https://proxy.fast.xyz', networkId: 'fast:mainnet' });
 *
 * const result = await executeWithdraw({
 *   fastBridgeAddress: 'fast1...',
 *   relayerUrl: 'https://...',
 *   crossSignUrl: 'https://...',
 *   tokenEvmAddress: '0x...',
 *   tokenFastTokenId: 'abc123...',
 *   amount: '1000000',
 *   receiverEvmAddress: '0xRecipient...',
 *   signer,
 *   provider,
 *   networkId: 'fast:testnet',
 * });
 * ```
 */
export async function executeWithdraw(
  params: ExecuteWithdrawParams,
): Promise<BridgeResult> {
  const { receiverEvmAddress, tokenEvmAddress, ...rest } = params;
  const intent = buildTransferIntent(tokenEvmAddress, receiverEvmAddress);
  return executeIntent({ ...rest, tokenEvmAddress, intents: [intent] });
}
