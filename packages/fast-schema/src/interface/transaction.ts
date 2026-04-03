import { Schema } from "effect";
import {
  AddressFromInput,
  AmountFromInput,
  ClaimDataFromInput,
  NetworkIdFromInput,
  NonceFromInput,
  QuorumFromInput,
  SignatureFromInput,
  StateFromInput,
  StateKeyFromInput,
  TokenIdFromInput,
  UserDataFromInput,
} from "../base/input.ts";
import { BigIntFromNumberOrSelf } from "../util/index.ts";

export const TokenTransferInput = Schema.Struct({
  tokenId: TokenIdFromInput,
  recipient: AddressFromInput,
  amount: AmountFromInput,
  userData: UserDataFromInput,
});

export const TokenCreationInput = Schema.Struct({
  tokenName: Schema.String,
  decimals: Schema.Number,
  initialAmount: AmountFromInput,
  mints: Schema.Array(AddressFromInput),
  userData: UserDataFromInput,
});

export const TokenManagementInput = Schema.Struct({
  tokenId: TokenIdFromInput,
  updateId: NonceFromInput,
  newAdmin: Schema.NullOr(AddressFromInput),
  mints: Schema.Array(
    Schema.Tuple(
      Schema.Union(
        Schema.Struct({ type: Schema.Literal("Add") }),
        Schema.Struct({ type: Schema.Literal("Remove") }),
      ),
      AddressFromInput,
    ),
  ),
  userData: UserDataFromInput,
});

export const MintInput = Schema.Struct({
  tokenId: TokenIdFromInput,
  recipient: AddressFromInput,
  amount: AmountFromInput,
});

export const BurnInput = Schema.Struct({
  tokenId: TokenIdFromInput,
  amount: AmountFromInput,
});

export const StateInitializationInput = Schema.Struct({
  key: StateKeyFromInput,
  initialState: StateFromInput,
});

export const StateUpdateInput = Schema.Struct({
  key: StateKeyFromInput,
  previousState: StateFromInput,
  nextState: StateFromInput,
  computeClaimTxHash: StateKeyFromInput,
  computeClaimTxTimestamp: BigIntFromNumberOrSelf,
});

export const StateResetInput = Schema.Struct({
  key: StateKeyFromInput,
  resetState: StateFromInput,
});

export const ExternalClaimInput = Schema.Struct({
  claim: Schema.Struct({
    verifierCommittee: Schema.Array(AddressFromInput),
    verifierQuorum: QuorumFromInput,
    claimData: ClaimDataFromInput,
  }),
  signatures: Schema.Array(
    Schema.Struct({
      verifierAddr: AddressFromInput,
      sig: SignatureFromInput,
    }),
  ),
});

export const ValidatorConfigInput = Schema.Struct({
  address: AddressFromInput,
  host: Schema.String,
  rpcPort: Schema.Number,
});

export const CommitteeChangeInput = Schema.Struct({
  newCommittee: Schema.Struct({
    validators: Schema.Array(ValidatorConfigInput),
  }),
  epoch: Schema.Number,
});

/** Single operation (12 variants, used inside Batch). */
const OperationInput = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("TokenTransfer"),
    value: TokenTransferInput,
  }),
  Schema.Struct({
    type: Schema.Literal("TokenCreation"),
    value: TokenCreationInput,
  }),
  Schema.Struct({
    type: Schema.Literal("TokenManagement"),
    value: TokenManagementInput,
  }),
  Schema.Struct({ type: Schema.Literal("Mint"), value: MintInput }),
  Schema.Struct({ type: Schema.Literal("Burn"), value: BurnInput }),
  Schema.Struct({
    type: Schema.Literal("StateInitialization"),
    value: StateInitializationInput,
  }),
  Schema.Struct({
    type: Schema.Literal("StateUpdate"),
    value: StateUpdateInput,
  }),
  Schema.Struct({ type: Schema.Literal("StateReset"), value: StateResetInput }),
  Schema.Struct({
    type: Schema.Literal("ExternalClaim"),
    value: ExternalClaimInput,
  }),
  Schema.Struct({
    type: Schema.Literal("JoinCommittee"),
    value: ValidatorConfigInput,
  }),
  Schema.Struct({ type: Schema.Literal("LeaveCommittee") }),
  Schema.Struct({
    type: Schema.Literal("ChangeCommittee"),
    value: CommitteeChangeInput,
  }),
);

/** Top-level claim (12 operation variants + Batch). */
const ClaimTypeInput = Schema.Union(
  ...OperationInput.members,
  Schema.Struct({
    type: Schema.Literal("Batch"),
    value: Schema.Array(OperationInput),
  }),
);

export const TransactionInput = Schema.Struct({
  networkId: NetworkIdFromInput,
  sender: AddressFromInput,
  nonce: NonceFromInput,
  timestampNanos: BigIntFromNumberOrSelf,
  claim: ClaimTypeInput,
  archival: Schema.Boolean,
  feeToken: Schema.NullOr(TokenIdFromInput),
});

export type TransactionInputParams = typeof TransactionInput.Encoded;
export type OperationInputParams = typeof OperationInput.Encoded;
export type TokenTransferInputParams = typeof TokenTransferInput.Encoded;
export type TokenCreationInputParams = typeof TokenCreationInput.Encoded;
export type TokenManagementInputParams = typeof TokenManagementInput.Encoded;
export type MintInputParams = typeof MintInput.Encoded;
export type BurnInputParams = typeof BurnInput.Encoded;
export type StateInitializationInputParams =
  typeof StateInitializationInput.Encoded;
export type StateUpdateInputParams = typeof StateUpdateInput.Encoded;
export type StateResetInputParams = typeof StateResetInput.Encoded;
export type ExternalClaimInputParams = typeof ExternalClaimInput.Encoded;
export type ValidatorConfigInputParams = typeof ValidatorConfigInput.Encoded;
export type CommitteeChangeInputParams = typeof CommitteeChangeInput.Encoded;
