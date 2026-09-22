import { FastProvider } from "@fastxyz/sdk";
import { mainnet, testnet } from "@fastxyz/sdk/networks";
import { encodeTxForWalletSigning } from "@fastxyz/sdk/wallet";
import {
  getTransactionVersionConfig,
  LatestTransactionVersion,
  SignatureFromInput,
} from "@fastxyz/schema";
import { Schema } from "effect";

import {
  NotSettledError,
  SettlementMismatchError,
  WrongNetworkError,
  asInsufficientFunds,
  asNonceConflict,
  type SubmissionRecovery,
} from "./errors.js";
import { txIdFromDomainTransaction } from "./fasttx.js";

const decodeUnknown = Schema.decodeUnknownSync as (
  schema: unknown,
) => (input: unknown) => unknown;

type FastNetworkId =
  | "fast:mainnet"
  | "fast:testnet"
  | "fast:devnet"
  | "fast:localnet";

export function toRestGateway(proxyUrl: string): string {
  return proxyUrl
    .replace(/\/proxy\/?$/, "/proxy-rest")
    .replace(/\/+$/, "");
}

export function feeTokenFor(networkId: string): {
  tokenId: string;
  symbol: string;
  decimals: number;
} {
  if (networkId === "fast:mainnet") return mainnet.defaultToken;
  if (networkId === "fast:testnet") return testnet.defaultToken;
  throw new Error(`No default fee token for unknown network ${networkId}`);
}

export function makeProvider(
  proxyUrl: string,
  networkId: string,
): FastProvider {
  return new FastProvider({
    url: toRestGateway(proxyUrl),
    networkId: networkId as FastNetworkId,
  });
}

export async function getNextNonce(
  provider: FastProvider,
  address: string,
): Promise<bigint> {
  const info = await provider.getAccountInfo({
    address,
    tokenBalancesFilter: null,
    stateKeyFilter: null,
  });
  return info.nextNonce as unknown as bigint;
}

export interface BuiltClaim {
  bytes: number[];
  versioned: unknown;
  nonce: string;
}

export async function buildExternalClaimBytes(args: {
  address: string;
  networkId: string;
  nonce: bigint;
  claimDataHex: string;
  feeToken: string | null;
  timestampNanos?: bigint;
}): Promise<BuiltClaim> {
  const config = getTransactionVersionConfig(
    LatestTransactionVersion,
  ) as unknown as {
    inputSchema: unknown;
    wrapOperations: (operations: unknown) => object;
  };
  const operation = {
    type: "ExternalClaim",
    value: {
      claim: {
        verifierCommittee: [],
        verifierQuorum: 0,
        claimData: `0x${args.claimDataHex}`,
      },
      signatures: [],
    },
  };
  const transaction = decodeUnknown(config.inputSchema)({
    networkId: args.networkId,
    sender: args.address,
    nonce: args.nonce,
    timestampNanos:
      args.timestampNanos ?? BigInt(Date.now()) * 1_000_000n,
    ...config.wrapOperations([operation]),
    archival: false,
    feeToken: args.feeToken,
  });
  const versioned = { type: LatestTransactionVersion, value: transaction };
  const bytes = Array.from(
    await encodeTxForWalletSigning(
      versioned as unknown as Parameters<typeof encodeTxForWalletSigning>[0],
    ),
  );
  if (bytes.length > 4096) {
    throw new Error(
      `ExternalClaim signing bytes (${bytes.length}) exceed the 4096 popup limit`,
    );
  }
  return { bytes, versioned, nonce: args.nonce.toString() };
}

export interface SettledClaim {
  txIdHex: string;
  nonce: string;
}

export class IndeterminateProviderSubmissionError extends Error {
  constructor(
    public readonly recovery: SubmissionRecovery,
    options?: { cause?: unknown },
  ) {
    super(
      "provider submission outcome is indeterminate; the signed transaction may have settled",
      options,
    );
    this.name = "IndeterminateProviderSubmissionError";
  }
}

export async function submitSignedClaim(
  provider: FastProvider,
  versioned: unknown,
  signatureHex: string,
  expectedNetworkId: string,
  feeSymbol: string | null,
): Promise<SettledClaim> {
  const signature = decodeUnknown(SignatureFromInput)(
    `0x${signatureHex.replace(/^0x/i, "")}`,
  );
  const envelope = {
    transaction: versioned,
    signature: { type: "Signature", value: signature },
  };
  const submittedTxId = await txIdFromDomainTransaction(versioned as never);
  const recovery: SubmissionRecovery = {
    nonce: (versioned as { value?: { nonce?: bigint } }).value?.nonce,
    txIdHex: submittedTxId,
    recoveryEnvelope: structuredClone(envelope),
  };
  let result: {
    type: string;
    value?: { envelope: { transaction: unknown } };
  } | null | undefined;
  try {
    result = (await provider.submitTransaction(
      structuredClone(recovery.recoveryEnvelope) as Parameters<
        typeof provider.submitTransaction
      >[0],
    )) as {
      type: string;
      value?: { envelope: { transaction: unknown } };
    };
  } catch (error) {
    const conflict = asNonceConflict(error);
    if (conflict) throw conflict;
    const funds = asInsufficientFunds(
      error,
      feeSymbol ?? "fee token",
    );
    if (funds) throw funds;
    throw new IndeterminateProviderSubmissionError(recovery, { cause: error });
  }
  if (!result) {
    throw new IndeterminateProviderSubmissionError(recovery, {
      cause: new Error("provider returned no submission result"),
    });
  }
  if (result.type !== "Success" || !result.value) {
    throw new NotSettledError(result.type, recovery);
  }

  let certificateTransaction: unknown;
  try {
    certificateTransaction = result.value.envelope.transaction;
  } catch (cause) {
    throw new IndeterminateProviderSubmissionError(recovery, { cause });
  }
  let certificateTxId: string;
  try {
    certificateTxId = await txIdFromDomainTransaction(certificateTransaction as never);
  } catch (cause) {
    throw new IndeterminateProviderSubmissionError(recovery, { cause });
  }
  if (submittedTxId !== certificateTxId) {
    throw new SettlementMismatchError(submittedTxId, certificateTxId, recovery);
  }

  const value = (
    certificateTransaction as {
      value?: { nonce?: bigint; networkId?: string; network?: string };
    }
  ).value;
  if (!value || value.nonce === undefined) {
    throw new IndeterminateProviderSubmissionError(recovery, {
      cause: new Error("Settled certificate is missing a nonce; unrecognized transaction shape."),
    });
  }
  const certificateNetwork = value.networkId ?? value.network ?? "";
  if (certificateNetwork !== expectedNetworkId) {
    throw new WrongNetworkError(expectedNetworkId, certificateNetwork, recovery);
  }
  return { txIdHex: certificateTxId, nonce: value.nonce.toString() };
}
