/**
 * eip7702.ts — EIP-7702 smartDeposit via AllSet Portal relay
 *
 * Flow:
 *   1. Check ERC-20 balance; throw InsufficientBalanceError if < amount
 *   2. POST /userop/prepare  → backend assembles UserOp + paymasterData (3 retries)
 *   3. Pin delegate address against TRUSTED_DELEGATES allowlist
 *   4. Sign EIP-7702 authorization (re-delegate EOA to v0.8 impl)
 *   5. Sign UserOperation (EIP-712, v0.8)
 *   6. POST /userop/submit  → backend calls Pimlico eth_sendUserOperation
 *
 * Private key never leaves the SDK.
 * Pimlico API key never touches the SDK.
 * Gas is paid in USDC via ERC-20 Paymaster.
 * Chain is inferred from rpcUrl (backend calls eth_chainId) — no hardcoded chain list.
 */

import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getUserOperationTypedData, type UserOperation } from 'viem/account-abstraction';

const ENTRY_POINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108' as Address;

/**
 * Allowlist of trusted EIP-7702 delegate addresses (lowercase).
 * smartDeposit will throw if the backend returns a delegate not in this set,
 * preventing a compromised backend from delegating EOAs to a malicious contract.
 */
const TRUSTED_DELEGATES = new Set([
  '0xe6cae83bde06e4c305530e199d7217f42808555b', // Simple7702Account v0.8
]);

const ERC20_BALANCEOF_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

/**
 * Encode a number/bigint as an even-length 0x-prefixed hex string.
 * Some strict bundler parsers expect byte-aligned hex — pad to even length.
 */
function toEvenHex(n: number | bigint): Hex {
  let h = n.toString(16);
  if (h.length % 2 !== 0) h = `0${h}`;
  return `0x${h}` as Hex;
}

/**
 * POST JSON with a hard timeout via AbortController.
 * Node's global fetch has no default timeout.
 */
async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`POST ${url} failed (${res.status}): ${err}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`POST ${url} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmartDepositParams {
  /**
   * EOA private key — stays local, never sent to backend.
   * The EOA should be quiescent during this call: do not send other
   * transactions from this key concurrently. EIP-7702 authorization
   * signing binds to the account nonce, and a concurrent tx from
   * another process will silently invalidate the delegation.
   */
  privateKey: Hex;
  /** EVM JSON-RPC URL — used for balance check and forwarded to backend for chainId detection */
  rpcUrl: string;
  /** AllSet Portal backend base URL, e.g. https://api.allset.xyz */
  allsetApiUrl: string;
  /** ERC-20 token to deposit (e.g. USDC on Base) */
  tokenAddress: Address;
  /** Exact token amount to deposit (raw, with decimals); throws if balance is insufficient */
  amount: bigint;
  /** AllSet bridge contract address */
  bridgeAddress: Address;
  /** Encoded bridge.deposit(...) calldata from encodeDepositCalldata() */
  depositCalldata: Hex;
  /** Per-request HTTP timeout in ms for backend POSTs (default: 60000) */
  requestTimeoutMs?: number;
}

export interface SmartDepositResult {
  txHash: Hash;
  userOpHash: Hash;
  userAddress: Address;
}

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly balance: bigint,
    public readonly required: bigint,
    public readonly tokenAddress: Address,
  ) {
    super(
      `Insufficient token balance: have ${balance}, need ${required} (token ${tokenAddress})`,
    );
    this.name = 'InsufficientBalanceError';
  }
}

// ─── Backend API shapes ───────────────────────────────────────────────────────

// Raw shapes as returned by the Go backend (numeric fields as hex strings)
interface RawUserOp {
  sender: string;
  nonce: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymaster?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterData?: string;
  factory?: string;
  factoryData?: string;
}

interface PrepareRequest {
  rpcUrl: string;
  from: Address;
  tokenAddress: Address;
  amount: string;
  bridgeAddress: Address;
  depositCalldata: Hex;
  chainId: number;
  nonce: Hex;
  timestamp: number;
  authSig: Hex;
}

interface PrepareResponse {
  unsignedUserOp: RawUserOp;
  delegate7702Address: Address;
  needsAuthorization: boolean;
}

// eip7702Auth format expected by Pimlico bundler (all numerics as 0x hex strings)
interface Eip7702Auth {
  address: Address;
  chainId: Hex;
  nonce: Hex;
  yParity: Hex;
  r: Hex;
  s: Hex;
}

interface RawUserOpWithAuth extends RawUserOp {
  eip7702Auth?: Eip7702Auth;
}

interface SubmitRequest {
  rpcUrl: string;
  signedUserOp: RawUserOpWithAuth;
}

interface SubmitResponse {
  txHash: Hash;
  userOpHash: Hash;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert the backend's hex-string UserOp to viem's bigint-typed UserOperation<'0.8'>.
 */
function parseUserOp(raw: RawUserOp): UserOperation<'0.8'> {
  return {
    sender: raw.sender as Address,
    nonce: BigInt(raw.nonce),
    callData: raw.callData as Hex,
    callGasLimit: BigInt(raw.callGasLimit),
    verificationGasLimit: BigInt(raw.verificationGasLimit),
    preVerificationGas: BigInt(raw.preVerificationGas),
    maxFeePerGas: BigInt(raw.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(raw.maxPriorityFeePerGas),
    ...(raw.paymaster && { paymaster: raw.paymaster as Address }),
    ...(raw.paymasterVerificationGasLimit && {
      paymasterVerificationGasLimit: BigInt(raw.paymasterVerificationGasLimit),
    }),
    ...(raw.paymasterPostOpGasLimit && {
      paymasterPostOpGasLimit: BigInt(raw.paymasterPostOpGasLimit),
    }),
    ...(raw.paymasterData && { paymasterData: raw.paymasterData as Hex }),
    ...(raw.factory && { factory: raw.factory as Address }),
    ...(raw.factoryData && { factoryData: raw.factoryData as Hex }),
    signature: '0x',
  };
}

/**
 * Convert UserOperation<'0.8'> bigint fields → hex strings for JSON serialization.
 * The Go backend expects all numeric fields as 0x-prefixed hex strings.
 */
function serializeUserOp(op: UserOperation<'0.8'>): RawUserOpWithAuth {
  const toHex = (n: bigint) => `0x${n.toString(16)}`;
  return {
    sender: op.sender,
    nonce: toHex(op.nonce),
    callData: op.callData,
    callGasLimit: toHex(op.callGasLimit),
    verificationGasLimit: toHex(op.verificationGasLimit),
    preVerificationGas: toHex(op.preVerificationGas),
    maxFeePerGas: toHex(op.maxFeePerGas),
    maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
    ...(op.paymaster && { paymaster: op.paymaster }),
    ...(op.paymasterVerificationGasLimit !== undefined && {
      paymasterVerificationGasLimit: toHex(op.paymasterVerificationGasLimit),
    }),
    ...(op.paymasterPostOpGasLimit !== undefined && {
      paymasterPostOpGasLimit: toHex(op.paymasterPostOpGasLimit),
    }),
    ...(op.paymasterData && { paymasterData: op.paymasterData }),
    ...(op.factory && { factory: op.factory }),
    ...(op.factoryData && { factoryData: op.factoryData }),
    ...(op.signature && { signature: op.signature }),
  };
}

// ─── Main function ─────────────────────────────────────────────────────────────

export async function smartDeposit(params: SmartDepositParams): Promise<SmartDepositResult> {
  const {
    privateKey,
    rpcUrl,
    allsetApiUrl,
    tokenAddress,
    amount,
    bridgeAddress,
    depositCalldata,
    requestTimeoutMs = 60_000,
  } = params;

  const eoa = privateKeyToAccount(privateKey);
  // No chain object needed — chainId is fetched dynamically from the RPC
  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  // Step 1: One-shot balance check — caller is responsible for funding the EOA first
  const tokenBalance = (await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_BALANCEOF_ABI,
    functionName: 'balanceOf',
    args: [eoa.address],
  })) as bigint;

  if (tokenBalance < amount) {
    throw new InsufficientBalanceError(tokenBalance, amount, tokenAddress);
  }

  // Fetch chainId once — used for EIP-7702 auth and UserOp signing
  const chainId = await publicClient.getChainId();

  // Step 2: Build request auth signature (proves caller owns the private key).
  // Preimage: abi.encode(domainTag, chainId, nonce, from, tokenAddress, amount, bridgeAddress, depositCalldata, timestamp)
  // - Domain tag prevents cross-protocol signature collisions.
  // - chainId prevents cross-chain replay.
  // - nonce (random 32 bytes) prevents in-protocol replay; backend must track used nonces.
  // - abi.encode (not encodePacked) eliminates dynamic-field collision ambiguity.
  const timestamp = Math.floor(Date.now() / 1000);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = `0x${Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
  const DOMAIN_TAG = 'AllSet Portal authSig v1';
  const msgHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'string' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes' },
        { type: 'uint256' },
      ],
      [
        DOMAIN_TAG,
        BigInt(chainId),
        nonce,
        eoa.address,
        tokenAddress,
        amount,
        bridgeAddress,
        depositCalldata,
        BigInt(timestamp),
      ],
    ),
  );
  const authSig = await eoa.signMessage({ message: { raw: msgHash } });

  // Step 3: POST /userop/prepare (3 attempts with exponential backoff: 0, 500, 1500ms)
  const prepareReq: PrepareRequest = {
    rpcUrl,
    from: eoa.address,
    tokenAddress,
    amount: amount.toString(),
    bridgeAddress,
    depositCalldata,
    chainId,
    nonce,
    timestamp,
    authSig,
  };

  const PREPARE_DELAYS = [0, 500, 1500];
  let prepared!: PrepareResponse;
  for (let attempt = 0; attempt < PREPARE_DELAYS.length; attempt++) {
    if (PREPARE_DELAYS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, PREPARE_DELAYS[attempt]));
    }
    try {
      prepared = await postJson<PrepareResponse>(
        `${allsetApiUrl}/userop/prepare`,
        prepareReq,
        requestTimeoutMs,
      );
      break;
    } catch (e) {
      const isLast = attempt === PREPARE_DELAYS.length - 1;
      // Retry on network errors and 5xx/429 (message contains status code)
      const msg = (e as Error).message ?? '';
      const isRetryable = !msg.match(/POST .+ failed \([1-4][0-9]{2}\)/) || msg.includes('(429)') || msg.includes('(5');
      if (isLast || !isRetryable) throw e;
    }
  }

  // Step 4: Pin delegate address against trusted allowlist
  if (!TRUSTED_DELEGATES.has(prepared.delegate7702Address.toLowerCase())) {
    throw new Error(
      `smartDeposit: untrusted delegate address returned by backend: ${prepared.delegate7702Address}`,
    );
  }

  // Step 5: Sign EIP-7702 authorization.
  // We always re-sign to ensure the EOA is delegated to the correct v0.8 impl,
  // even if a prior (possibly outdated) delegation exists.
  let eip7702Auth: Eip7702Auth | undefined;
  if (prepared.needsAuthorization) {
    // Use 'pending' so mempool txs from this EOA are counted in the nonce.
    const accountNonce = await publicClient.getTransactionCount({
      address: eoa.address,
      blockTag: 'pending',
    });
    const signed = await eoa.signAuthorization({
      address: prepared.delegate7702Address,
      chainId,
      nonce: accountNonce,
    });
    const yParity = signed.yParity ?? 0;
    eip7702Auth = {
      address: prepared.delegate7702Address,
      chainId: toEvenHex(chainId),
      nonce: toEvenHex(accountNonce),
      yParity: toEvenHex(yParity),
      r: `0x${BigInt(signed.r).toString(16).padStart(64, '0')}` as Hex,
      s: `0x${BigInt(signed.s).toString(16).padStart(64, '0')}` as Hex,
    };
  }

  // Step 6: Parse backend response + sign UserOperation (v0.8 uses EIP-712 typed data)
  const userOpToSign: UserOperation<'0.8'> = parseUserOp(prepared.unsignedUserOp);

  // v0.8 requires EIP-712 signTypedData, NOT signMessage/personal_sign
  const typedData = getUserOperationTypedData({
    chainId,
    entryPointAddress: ENTRY_POINT_V08,
    userOperation: { ...userOpToSign, signature: '0x' },
  });
  const signature = await eoa.signTypedData(typedData);
  const signedUserOp: UserOperation<'0.8'> = { ...userOpToSign, signature };

  // Step 7: POST /userop/submit (single attempt — UserOps are not idempotent)
  const serialized = serializeUserOp(signedUserOp);
  if (eip7702Auth) {
    serialized.eip7702Auth = eip7702Auth;
  }
  const submitReq: SubmitRequest = {
    rpcUrl,
    signedUserOp: serialized,
  };

  const { txHash, userOpHash: returnedUserOpHash } = await postJson<SubmitResponse>(
    `${allsetApiUrl}/userop/submit`,
    submitReq,
    requestTimeoutMs,
  );

  return {
    txHash,
    userOpHash: returnedUserOpHash,
    userAddress: eoa.address,
  };
}
