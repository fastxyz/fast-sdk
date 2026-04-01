/**
 * Payment settlement logic
 * Aligned with reference implementation
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  parseAbi,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashHex } from "@fastxyz/fast-sdk";
import { bcsSchema } from "@fastxyz/fast-schema";
import type {
  PaymentPayload,
  PaymentRequirement,
  SettleResponse,
  EvmPayload,
  FastPayload,
  FacilitatorConfig,
} from "./types.js";
import { getNetworkType } from "./types.js";
import { getEvmChainConfig } from "./chains.js";
import { verify } from "./verify.js";

/**
 * USDC ABI for transferWithAuthorization
 */
const USDC_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external",
  "function authorizationState(address authorizer, bytes32 nonce) external view returns (bool)",
]);

// Type alias for certificate structure
interface FastTransactionCertificate {
  envelope: {
    transaction: unknown;
    signature: unknown;
  };
  signatures: unknown[];
}

/**
 * Compute a hash for a Fast transaction certificate.
 * Replaces the old getCertificateHash from @fastxyz/sdk/core.
 */
async function getCertificateHash(certificate: FastTransactionCertificate): Promise<string> {
  try {
    return await hashHex(bcsSchema.VersionedTransaction, certificate.envelope.transaction as any);
  } catch {
    return "";
  }
}

/**
 * Settle a payment on-chain
 */
export async function settle(
  paymentPayload: PaymentPayload,
  paymentRequirement: PaymentRequirement,
  config: FacilitatorConfig
): Promise<SettleResponse> {
  if (paymentPayload.network === "fast" || paymentRequirement.network === "fast") {
    return {
      success: false,
      errorReason: "invalid_network",
      network: paymentPayload.network,
    };
  }

  const networkType = getNetworkType(paymentPayload.network);

  switch (networkType) {
    case "evm":
      return settleEvmPayment(paymentPayload, paymentRequirement, config);
    case "fast":
      return settleFastPayment(paymentPayload, paymentRequirement, config);
    default:
      return {
        success: false,
        errorReason: `unsupported_network_type`,
        network: paymentPayload.network,
      };
  }
}

async function getFastTransactionId(certificate: FastPayload["transactionCertificate"]): Promise<string> {
  if (certificate.envelope && typeof certificate.envelope === "object") {
    try {
      return await getCertificateHash(certificate as FastTransactionCertificate);
    } catch {
      return "";
    }
  }

  return "";
}

/**
 * Settle EVM payment by calling transferWithAuthorization
 */
async function settleEvmPayment(
  paymentPayload: PaymentPayload,
  paymentRequirement: PaymentRequirement,
  config: FacilitatorConfig
): Promise<SettleResponse> {
  if (!config.evmPrivateKey) {
    return {
      success: false,
      errorReason: "facilitator_not_configured",
      network: paymentPayload.network,
    };
  }

  const chainConfig = getEvmChainConfig(paymentPayload.network);
  if (!chainConfig) {
    return {
      success: false,
      errorReason: "invalid_network",
      network: paymentPayload.network,
    };
  }

  const payload = paymentPayload.payload as EvmPayload;
  if (!payload?.signature || !payload?.authorization) {
    return {
      success: false,
      errorReason: "invalid_payload",
      network: paymentPayload.network,
    };
  }

  const { authorization, signature } = payload;

  // Re-verify before settling
  const verifyResult = await verify(paymentPayload, paymentRequirement, config);
  if (!verifyResult.isValid) {
    return {
      success: false,
      errorReason: verifyResult.invalidReason || "invalid_payment",
      network: paymentPayload.network,
      payer: authorization.from,
    };
  }

  try {
    const account = privateKeyToAccount(config.evmPrivateKey);
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    // Check if authorization was already used
    const alreadyUsed = await publicClient.readContract({
      address: chainConfig.usdcAddress,
      abi: USDC_ABI,
      functionName: "authorizationState",
      args: [authorization.from as `0x${string}`, authorization.nonce as `0x${string}`],
    });

    if (alreadyUsed) {
      return {
        success: false,
        errorReason: "authorization_already_used",
        network: paymentPayload.network,
        payer: authorization.from,
      };
    }

    const parsedSig = parseSignature(signature as Hex);
    const v = parsedSig.v !== undefined 
      ? Number(parsedSig.v) 
      : (parsedSig.yParity === 0 ? 27 : 28);

    const txHash = await walletClient.writeContract({
      address: chainConfig.usdcAddress,
      abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [
        authorization.from as `0x${string}`,
        authorization.to as `0x${string}`,
        BigInt(authorization.value),
        BigInt(authorization.validAfter),
        BigInt(authorization.validBefore),
        authorization.nonce as `0x${string}`,
        v,
        parsedSig.r,
        parsedSig.s,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: "invalid_transaction_state",
        transaction: txHash,
        txHash,
        network: paymentPayload.network,
        payer: authorization.from,
      };
    }

    return {
      success: true,
      transaction: txHash,
      txHash,
      network: paymentPayload.network,
      payer: authorization.from,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      errorReason: `settlement_failed: ${message}`,
      network: paymentPayload.network,
      payer: authorization.from,
    };
  }
}

/**
 * Settle Fast payment (no-op - already on-chain)
 */
async function settleFastPayment(
  paymentPayload: PaymentPayload,
  paymentRequirement: PaymentRequirement,
  config: FacilitatorConfig,
): Promise<SettleResponse> {
  const payload = paymentPayload.payload as FastPayload;
  if (!payload?.transactionCertificate) {
    return {
      success: false,
      errorReason: "invalid_payload",
      network: paymentPayload.network,
    };
  }

  const verifyResult = await verify(paymentPayload, paymentRequirement, config);
  if (!verifyResult.isValid) {
    return {
      success: false,
      errorReason: verifyResult.invalidReason || "invalid_payment",
      network: paymentPayload.network,
      payer: verifyResult.payer,
    };
  }

  const transactionId = await getFastTransactionId(payload.transactionCertificate);

  return {
    success: true,
    transaction: transactionId,
    network: paymentPayload.network,
  };
}
