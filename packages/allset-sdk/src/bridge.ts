import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { FastError } from './errors.js';
import { fastAddressToBytes } from './address.js';
import { buildDepositTransaction } from './deposit.js';
import { IntentAction, type Intent } from './intents.js';
import { ERC20_ABI, type EvmClients } from './evm-executor.js';
import type { BridgeResult, ExecuteDepositParams, ExecuteIntentParams } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function amountToHex(amount: string): string {
  return BigInt(amount).toString(16);
}

function bigIntToNumber(obj: unknown): unknown {
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(bigIntToNumber);
  if (obj !== null && typeof obj === 'object') {
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
          [{ type: 'address' }, { type: 'address' }],
          intent.payload,
        );
        return receiver;
      } catch { continue; }
    }
    if (intent.action === IntentAction.Execute) {
      try {
        const [target] = decodeAbiParameters(
          [{ type: 'address' }, { type: 'bytes' }],
          intent.payload,
        );
        return target;
      } catch { continue; }
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
): Promise<{ txHash: string; status: 'success' | 'reverted' }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walletClient = clients.walletClient as any;
  const hash = await walletClient.sendTransaction({
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value),
    gas: tx.gas ? BigInt(tx.gas) : undefined,
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, status: receipt.status === 'success' ? 'success' : 'reverted' };
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
    functionName: 'allowance',
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
    functionName: 'approve',
    args: [spender as `0x${string}`, BigInt(amount)],
  });
  await clients.publicClient.waitForTransactionReceipt({ hash });
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
  const serialized = bigIntToNumber(certificate);
  const res = await fetch(crossSignUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'crossSign_evmSignCertificate',
      params: { certificate: serialized },
    }),
  });

  if (!res.ok) {
    throw new FastError('TX_FAILED', `Cross-sign request failed: ${res.status}`, {
      note: 'The AllSet cross-sign service rejected the request.',
    });
  }

  const json = await res.json() as {
    result?: { transaction: number[]; signature: string };
    error?: { message: string };
  };

  if (json.error) {
    throw new FastError('TX_FAILED', `Cross-sign error: ${json.error.message}`, {
      note: 'The certificate could not be cross-signed.',
    });
  }

  if (!json.result?.transaction || !json.result?.signature) {
    throw new FastError('TX_FAILED', 'Cross-sign returned invalid response', {
      note: 'Missing transaction or signature in response.',
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
 *   senderAddress: '0xYourEvmAddress',
 *   receiverAddress: 'fast1abc...',
 *   evmClients,
 * });
 * ```
 */
export async function executeDeposit(params: ExecuteDepositParams): Promise<BridgeResult> {
  const { chainId, bridgeContract, tokenAddress, isNative = false, amount, senderAddress, receiverAddress, evmClients } = params;

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
    throw new FastError('INVALID_ADDRESS', `Failed to decode Fast receiver address "${receiverAddress}": ${msg}`, {
      note: 'The receiver address must be a valid Fast network bech32m address (fast1...).',
    });
  }

  let txHash: string;

  if (isNative) {
    const receipt = await sendTx(evmClients, {
      to: depositPlan.to,
      data: depositPlan.data,
      value: depositPlan.value.toString(),
    });
    if (receipt.status === 'reverted') {
      throw new FastError('TX_FAILED', `Deposit transaction reverted: ${receipt.txHash}`, {
        note: 'Check that you have sufficient ETH balance.',
      });
    }
    txHash = receipt.txHash;
  } else {
    const requiredAmount = BigInt(amount);
    const currentAllowance = await checkAllowance(evmClients, tokenAddress, bridgeContract, senderAddress);
    if (currentAllowance < requiredAmount) {
      await approveErc20(evmClients, tokenAddress, bridgeContract, amount);
    }
    const receipt = await sendTx(evmClients, {
      to: depositPlan.to,
      data: depositPlan.data,
      value: depositPlan.value.toString(),
    });
    if (receipt.status === 'reverted') {
      throw new FastError('TX_FAILED', `Deposit transaction reverted: ${receipt.txHash}`, {
        note: 'Check that you have sufficient token balance and the approval succeeded.',
      });
    }
    txHash = receipt.txHash;
  }

  return { txHash, orderId: txHash, estimatedTime: '1-5 minutes' };
}

// ---------------------------------------------------------------------------
// executeIntent (Fast → EVM)
// ---------------------------------------------------------------------------

/**
 * Execute intents on an EVM chain after transferring tokens from the Fast network.
 *
 * This is the core function for all Fast→EVM flows:
 * - Simple withdrawal: use buildTransferIntent + executeIntent
 * - Custom contract call: use buildExecuteIntent + executeIntent
 * - Deposit back to Fast: use buildDepositBackIntent + executeIntent
 *
 * All configuration values must be provided by the caller.
 *
 * @example
 * ```ts
 * // Simple withdrawal (Fast → EVM transfer)
 * const intent = buildTransferIntent(tokenEvmAddress, receiverEvmAddress);
 * const result = await executeIntent({
 *   fastBridgeAddress: 'fast1...',
 *   relayerUrl: 'https://...',
 *   crossSignUrl: 'https://...',
 *   tokenEvmAddress: '0x...',
 *   tokenFastTokenId: 'abc123...',
 *   amount: '1000000',
 *   intents: [intent],
 *   fastWallet,
 * });
 * ```
 */
export async function executeIntent(params: ExecuteIntentParams): Promise<BridgeResult> {
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
    fastWallet,
  } = params;

  if (!intents || intents.length === 0) {
    throw new FastError('INVALID_PARAMS', 'executeIntent requires at least one intent', {
      note: 'Use intent builders like buildTransferIntent(), buildExecuteIntent(), etc.',
    });
  }

  if (externalAddressOverride && !externalAddressOverride.startsWith('0x')) {
    throw new FastError('INVALID_PARAMS', 'executeIntent externalAddress must be an EVM address', {
      note: 'Pass a 0x-prefixed address for the relayer target.',
    });
  }

  const tokenId = hexToUint8Array(tokenFastTokenId);

  // Step 1: Transfer tokens to bridge address on Fast network
  const transferResult = await fastWallet.submit({
    claim: {
      TokenTransfer: {
        token_id: tokenId,
        recipient: fastAddressToBytes(fastBridgeAddress),
        amount: amountToHex(amount),
        user_data: null,
      },
    },
  });

  // Step 2: Cross-sign the transfer certificate
  const transferCrossSign = await evmSign(transferResult.certificate, crossSignUrl);
  const transferFastTxId = transferResult.txHash as `0x${string}`;

  // Step 3: Build and encode the intent claim
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const intentClaimEncoded = encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'transferFastTxId', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
        {
          name: 'intents',
          type: 'tuple[]',
          components: [
            { name: 'action', type: 'uint8' },
            { name: 'payload', type: 'bytes' },
            { name: 'value', type: 'uint256' },
          ],
        },
      ],
    }],
    [{ transferFastTxId, deadline, intents: intents.map(i => ({ action: i.action, payload: i.payload, value: i.value })) }],
  );

  const intentBytes = hexToUint8Array(intentClaimEncoded);

  // Step 4: Submit intent claim on Fast network
  const intentResult = await fastWallet.submit({
    claim: {
      ExternalClaim: {
        claim: {
          verifier_committee: [] as Uint8Array[],
          verifier_quorum: 0,
          claim_data: Array.from(intentBytes),
        },
        signatures: [] as Array<[Uint8Array, Uint8Array]>,
      },
    },
  });

  // Step 5: Cross-sign the intent certificate
  const intentCrossSign = await evmSign(intentResult.certificate, crossSignUrl);

  // Step 6: Resolve external address and submit to relayer
  const externalAddress = resolveExternalAddress(intents, externalAddressOverride);
  if (!externalAddress) {
    throw new FastError(
      'INVALID_PARAMS',
      'executeIntent requires externalAddress when intents do not include a transfer recipient or execute target',
      { note: 'Pass externalAddress for flows like buildDepositBackIntent() or buildRevokeIntent().' },
    );
  }

  const relayerBody = {
    encoded_transfer_claim: Array.from(new Uint8Array(transferCrossSign.transaction.map(Number))),
    transfer_proof: transferCrossSign.signature,
    transfer_fast_tx_id: transferResult.txHash,
    transfer_claim_id: transferResult.txHash,
    fastset_address: fastWallet.address,
    external_address: externalAddress,
    encoded_intent_claim: Array.from(new Uint8Array(intentCrossSign.transaction.map(Number))),
    intent_proof: intentCrossSign.signature,
    intent_fast_tx_id: intentResult.txHash,
    intent_claim_id: intentResult.txHash,
    external_token_address: tokenEvmAddress,
  };

  const relayRes = await fetch(`${relayerUrl}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(relayerBody),
  });

  if (!relayRes.ok) {
    const text = await relayRes.text();
    throw new FastError('TX_FAILED', `Relayer request failed (${relayRes.status}): ${text}`, {
      note: 'The intent was submitted to Fast network but the relayer rejected it. Try again.',
    });
  }

  return {
    txHash: transferResult.txHash,
    orderId: transferFastTxId,
    estimatedTime: '1-5 minutes',
  };
}
