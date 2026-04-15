import { Schema } from 'effect';
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
} from '../base/input.ts';
import { BigIntFromNumberOrSelf } from '../util/index.ts';

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
    Schema.Tuple(Schema.Union(Schema.Struct({ type: Schema.Literal('Add') }), Schema.Struct({ type: Schema.Literal('Remove') })), AddressFromInput),
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

export const FixedAmountOrBpsInput = Schema.Union(
  Schema.Struct({ type: Schema.Literal('Fixed'), value: AmountFromInput }),
  Schema.Struct({ type: Schema.Literal('Bps'), value: Schema.Number }),
);

export const EscrowCreateConfigInput = Schema.Struct({
  tokenId: TokenIdFromInput,
  evaluator: AddressFromInput,
  evaluationFee: FixedAmountOrBpsInput,
  minEvaluatorFee: AmountFromInput,
});

export const EscrowCreateJobInput = Schema.Struct({
  configId: TokenIdFromInput,
  provider: AddressFromInput,
  providerFee: AmountFromInput,
  description: Schema.String,
});

export const EscrowSubmitInput = Schema.Struct({
  jobId: TokenIdFromInput,
  deliverable: TokenIdFromInput,
});

export const EscrowRejectInput = Schema.Struct({
  jobId: TokenIdFromInput,
});

export const EscrowCompleteInput = Schema.Struct({
  jobId: TokenIdFromInput,
});

export const EscrowInput = Schema.Union(
  Schema.Struct({ type: Schema.Literal('CreateConfig'), value: EscrowCreateConfigInput }),
  Schema.Struct({ type: Schema.Literal('CreateJob'), value: EscrowCreateJobInput }),
  Schema.Struct({ type: Schema.Literal('Submit'), value: EscrowSubmitInput }),
  Schema.Struct({ type: Schema.Literal('Reject'), value: EscrowRejectInput }),
  Schema.Struct({ type: Schema.Literal('Complete'), value: EscrowCompleteInput }),
);

/** Single operation (13 variants, used inside Batch and Claims). */
export const OperationInput = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('TokenTransfer'),
    value: TokenTransferInput,
  }),
  Schema.Struct({
    type: Schema.Literal('TokenCreation'),
    value: TokenCreationInput,
  }),
  Schema.Struct({
    type: Schema.Literal('TokenManagement'),
    value: TokenManagementInput,
  }),
  Schema.Struct({ type: Schema.Literal('Mint'), value: MintInput }),
  Schema.Struct({ type: Schema.Literal('Burn'), value: BurnInput }),
  Schema.Struct({
    type: Schema.Literal('StateInitialization'),
    value: StateInitializationInput,
  }),
  Schema.Struct({
    type: Schema.Literal('StateUpdate'),
    value: StateUpdateInput,
  }),
  Schema.Struct({ type: Schema.Literal('StateReset'), value: StateResetInput }),
  Schema.Struct({
    type: Schema.Literal('ExternalClaim'),
    value: ExternalClaimInput,
  }),
  Schema.Struct({
    type: Schema.Literal('JoinCommittee'),
    value: ValidatorConfigInput,
  }),
  Schema.Struct({ type: Schema.Literal('LeaveCommittee') }),
  Schema.Struct({
    type: Schema.Literal('ChangeCommittee'),
    value: CommitteeChangeInput,
  }),
  Schema.Struct({
    type: Schema.Literal('Escrow'),
    value: EscrowInput,
  }),
);

/** Top-level claim (13 operation variants + Batch). */
export const ClaimTypeInput = Schema.Union(
  ...OperationInput.members,
  Schema.Struct({
    type: Schema.Literal('Batch'),
    value: Schema.Array(OperationInput),
  }),
);

export const TransactionRelease20260319Input = Schema.Struct({
  networkId: NetworkIdFromInput,
  sender: AddressFromInput,
  nonce: NonceFromInput,
  timestampNanos: BigIntFromNumberOrSelf,
  claim: ClaimTypeInput,
  archival: Schema.Boolean,
  feeToken: Schema.NullOr(TokenIdFromInput),
});

/** Input schema for Release20260407 transactions. Uses `claims` (array of operations). */
export const TransactionRelease20260407Input = Schema.Struct({
  networkId: NetworkIdFromInput,
  sender: AddressFromInput,
  nonce: NonceFromInput,
  timestampNanos: BigIntFromNumberOrSelf,
  claims: Schema.Array(OperationInput),
  archival: Schema.Boolean,
  feeToken: Schema.NullOr(TokenIdFromInput),
});

/** Alias for the latest transaction input format. Currently {@link TransactionRelease20260407Input}. */
export const TransactionInput = TransactionRelease20260407Input;

export type TransactionInputParams = typeof TransactionInput.Encoded;
export type TransactionRelease20260319InputParams = typeof TransactionRelease20260319Input.Encoded;
export type TransactionRelease20260407InputParams = typeof TransactionRelease20260407Input.Encoded;
export type OperationInputParams = typeof OperationInput.Encoded;
export type TokenTransferInputParams = typeof TokenTransferInput.Encoded;
export type TokenCreationInputParams = typeof TokenCreationInput.Encoded;
export type TokenManagementInputParams = typeof TokenManagementInput.Encoded;
export type MintInputParams = typeof MintInput.Encoded;
export type BurnInputParams = typeof BurnInput.Encoded;
export type StateInitializationInputParams = typeof StateInitializationInput.Encoded;
export type StateUpdateInputParams = typeof StateUpdateInput.Encoded;
export type StateResetInputParams = typeof StateResetInput.Encoded;
export type ExternalClaimInputParams = typeof ExternalClaimInput.Encoded;
export type ValidatorConfigInputParams = typeof ValidatorConfigInput.Encoded;
export type CommitteeChangeInputParams = typeof CommitteeChangeInput.Encoded;
export type EscrowCreateConfigInputParams = typeof EscrowCreateConfigInput.Encoded;
export type EscrowCreateJobInputParams = typeof EscrowCreateJobInput.Encoded;
export type EscrowSubmitInputParams = typeof EscrowSubmitInput.Encoded;
export type EscrowRejectInputParams = typeof EscrowRejectInput.Encoded;
export type EscrowCompleteInputParams = typeof EscrowCompleteInput.Encoded;
export type EscrowInputParams = typeof EscrowInput.Encoded;
