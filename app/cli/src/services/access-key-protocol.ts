import { bcs } from "@mysten/bcs";
import { fromFastAddress, fromHex, hashHex, Signer, toHex } from "@fastxyz/sdk";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const ACCESS_KEY_PERMISSION_NAMES = [
  "TokenTransfer",
  "TokenCreation",
  "TokenManagement",
  "Mint",
  "Burn",
  "StateInitialization",
  "StateUpdate",
  "StateReset",
  "ExternalClaim",
  "JoinCommittee",
  "LeaveCommittee",
  "ChangeCommittee",
  "Escrow",
  "AccessKeyManagement",
] as const;

export type AccessKeyPermissionName = (typeof ACCESS_KEY_PERMISSION_NAMES)[number];

const AmountBcs = bcs.u256().transform({
  input: (val: string) => BigInt(`0x${val.replace(/^0x/i, "")}`).toString(),
});

const AccessKeyPermissionBcs = bcs.enum("AccessKeyPermission", {
  TokenTransfer: bcs.tuple([]),
  TokenCreation: bcs.tuple([]),
  TokenManagement: bcs.tuple([]),
  Mint: bcs.tuple([]),
  Burn: bcs.tuple([]),
  StateInitialization: bcs.tuple([]),
  StateUpdate: bcs.tuple([]),
  StateReset: bcs.tuple([]),
  ExternalClaim: bcs.tuple([]),
  JoinCommittee: bcs.tuple([]),
  LeaveCommittee: bcs.tuple([]),
  ChangeCommittee: bcs.tuple([]),
  Escrow: bcs.tuple([]),
  AccessKeyManagement: bcs.tuple([]),
});

const AuthorizeAccessKeyBcs = bcs.struct("AuthorizeAccessKey", {
  delegate: bcs.bytes(32),
  client_id: bcs.string(),
  expires_at: bcs.u128(),
  allowed_operations: bcs.vector(AccessKeyPermissionBcs),
  allowed_tokens: bcs.vector(bcs.bytes(32)),
  max_total_spend: AmountBcs,
});

const RevokeAccessKeyBcs = bcs.struct("RevokeAccessKey", {
  access_key_id: bcs.bytes(32),
});

const AccessKeyOperationBcs = bcs.enum("AccessKeyOperation", {
  Authorize: AuthorizeAccessKeyBcs,
  Revoke: RevokeAccessKeyBcs,
});

const TokenTransferBcs = bcs.struct("TokenTransfer", {
  token_id: bcs.bytes(32),
  recipient: bcs.bytes(32),
  amount: AmountBcs,
  user_data: bcs.option(bcs.bytes(32)),
});

const Release20260407OperationBcs = bcs.enum("OperationRelease20260407", {
  TokenTransfer: TokenTransferBcs,
  TokenCreation: bcs.tuple([]),
  TokenManagement: bcs.tuple([]),
  Mint: bcs.tuple([]),
  Burn: bcs.tuple([]),
  StateInitialization: bcs.tuple([]),
  StateUpdate: bcs.tuple([]),
  ExternalClaim: bcs.tuple([]),
  StateReset: bcs.tuple([]),
  JoinCommittee: bcs.tuple([]),
  LeaveCommittee: bcs.tuple([]),
  ChangeCommittee: bcs.tuple([]),
  Escrow: bcs.tuple([]),
  AccessKey: AccessKeyOperationBcs,
});

const Release20260319ClaimBcs = bcs.enum("ClaimType", {
  TokenTransfer: TokenTransferBcs,
});

const Release20260319TransactionBcs = bcs.struct("TransactionRelease20260319", {
  network_id: bcs.string(),
  sender: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claim: Release20260319ClaimBcs,
  archival: bcs.bool(),
  fee_token: bcs.option(bcs.bytes(32)),
});

const Release20260407TransactionBcs = bcs.struct("TransactionRelease20260407", {
  network_id: bcs.string(),
  sender: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claims: bcs.vector(Release20260407OperationBcs),
  archival: bcs.bool(),
  fee_token: bcs.option(bcs.bytes(32)),
});

export const VersionedTransactionBcs = bcs.enum("VersionedTransaction", {
  Release20260319: Release20260319TransactionBcs,
  Release20260407: Release20260407TransactionBcs,
});

export interface Release20260407TransactionWire {
  readonly Release20260407: {
    readonly network_id: string;
    readonly sender: number[];
    readonly nonce: bigint;
    readonly timestamp_nanos: bigint;
    readonly claims: unknown[];
    readonly archival: boolean;
    readonly fee_token: null;
  };
}

export interface RawTransactionEnvelope {
  readonly transaction: Release20260407TransactionWire;
  readonly signature: {
    readonly Signature: number[];
  };
}

const permissionVariant = (permission: AccessKeyPermissionName) => ({
  [permission]: [] as const,
});

const amountToHex = (value: string | bigint): string => {
  if (typeof value === "bigint") {
    return value.toString(16);
  }
  const normalized = value.trim();
  if (normalized.startsWith("0x") || normalized.startsWith("0X")) {
    return normalized.slice(2);
  }
  return BigInt(normalized).toString(16);
};

const le64 = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const computeAccessKeyId = (
  ownerFastAddress: string,
  nonce: bigint,
  operationIndex: number,
): string => {
  const bytes = concatBytes(
    fromFastAddress(ownerFastAddress),
    le64(nonce),
    le64(BigInt(operationIndex)),
  );
  return toHex(keccak_256(bytes));
};

export interface BuildAuthorizeAccessKeyEnvelopeInput {
  readonly signer: Signer;
  readonly ownerFastAddress: string;
  readonly networkId: string;
  readonly nonce: bigint;
  readonly timestampNanos: bigint;
  readonly delegatePublicKeyHex: string;
  readonly clientId: string;
  readonly expiresAtNanos: bigint;
  readonly allowedOperations: AccessKeyPermissionName[];
  readonly allowedTokenIds: string[];
  readonly maxTotalSpend: string;
}

export interface BuildRevokeAccessKeyEnvelopeInput {
  readonly signer: Signer;
  readonly ownerFastAddress: string;
  readonly networkId: string;
  readonly nonce: bigint;
  readonly timestampNanos: bigint;
  readonly accessKeyId: string;
}

async function signEnvelope(
  signer: Signer,
  transaction: Release20260407TransactionWire,
): Promise<RawTransactionEnvelope> {
  const signature = await signer.signTypedData(VersionedTransactionBcs, transaction);
  return {
    transaction,
    signature: {
      Signature: Array.from(signature),
    },
  };
}

export async function buildAuthorizeAccessKeyEnvelope(
  input: BuildAuthorizeAccessKeyEnvelopeInput,
): Promise<{
  readonly accessKeyId: string;
  readonly txHash: string;
  readonly transaction: Release20260407TransactionWire;
  readonly envelope: RawTransactionEnvelope;
}> {
  const transaction: Release20260407TransactionWire = {
    Release20260407: {
      network_id: input.networkId,
      sender: Array.from(fromFastAddress(input.ownerFastAddress)),
      nonce: input.nonce,
      timestamp_nanos: input.timestampNanos,
      claims: [
        {
          AccessKey: {
            Authorize: {
              delegate: Array.from(fromHex(input.delegatePublicKeyHex)),
              client_id: input.clientId,
              expires_at: input.expiresAtNanos,
              allowed_operations: input.allowedOperations.map(permissionVariant),
              allowed_tokens: input.allowedTokenIds.map((tokenId) => Array.from(fromHex(tokenId))),
              max_total_spend: amountToHex(input.maxTotalSpend),
            },
          },
        },
      ],
      archival: false,
      fee_token: null,
    },
  };

  const txHash = await hashHex(VersionedTransactionBcs, transaction);
  const accessKeyId = computeAccessKeyId(
    input.ownerFastAddress,
    input.nonce,
    0,
  );
  const envelope = await signEnvelope(input.signer, transaction);
  return { accessKeyId, txHash, transaction, envelope };
}

export async function buildRevokeAccessKeyEnvelope(
  input: BuildRevokeAccessKeyEnvelopeInput,
): Promise<{
  readonly txHash: string;
  readonly transaction: Release20260407TransactionWire;
  readonly envelope: RawTransactionEnvelope;
}> {
  const transaction: Release20260407TransactionWire = {
    Release20260407: {
      network_id: input.networkId,
      sender: Array.from(fromFastAddress(input.ownerFastAddress)),
      nonce: input.nonce,
      timestamp_nanos: input.timestampNanos,
      claims: [
        {
          AccessKey: {
            Revoke: {
              access_key_id: Array.from(fromHex(input.accessKeyId)),
            },
          },
        },
      ],
      archival: false,
      fee_token: null,
    },
  };

  const txHash = await hashHex(VersionedTransactionBcs, transaction);
  const envelope = await signEnvelope(input.signer, transaction);
  return { txHash, transaction, envelope };
}
