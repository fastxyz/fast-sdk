import {
  makeMultiSig,
  makeMultiSigConfig,
  makeSignatureOrMultiSig,
  makeTransactionCertificate,
  makeTransactionEnvelope,
  makeValidatedTransaction,
} from '../composite/envelope.ts';
import {
  makeBurn,
  makeClaimType,
  makeCommitteeChange,
  makeCommitteeConfig,
  makeEscrow,
  makeEscrowComplete,
  makeEscrowCreateConfig,
  makeEscrowCreateJob,
  makeEscrowReject,
  makeEscrowSubmit,
  makeExternalClaim,
  makeExternalClaimBody,
  makeFixedAmountOrBps,
  makeMint,
  makeOperation,
  makeStateInitialization,
  makeStateReset,
  makeStateUpdate,
  makeTokenCreation,
  makeTokenManagement,
  makeTokenTransfer,
  makeValidatorConfig,
  makeVerifierSig,
} from '../composite/operations.ts';
import {
  makeAccountInfoResponse,
  makeConfirmTransactionResponse,
  makeEscrowJobRecord,
  makeEscrowJobWithCerts,
  makeNonceRange,
  makePageRequest,
  makeProxySubmitTransactionResult,
  makeSubmitTransactionResponse,
  makeTokenInfoResponse,
  makeTokenMetadata,
} from '../composite/response.ts';
import { makeTransaction, makeTransactionRelease20260319, makeTransactionRelease20260407, makeVersionedTransaction } from '../composite/transaction.ts';
import {
  makeFaucetDripParams,
  makeGetAccountInfoParams,
  makeGetPendingMultisigParams,
  makeGetTokenInfoParams,
  makeGetTransactionCertificatesParams,
  makeSubmitTransactionParams,
} from '../interface/proxy.ts';
import { RpcPalette } from './definition.ts';

const p = RpcPalette;

export const TokenTransferFromRpc = makeTokenTransfer(p);
export const TokenCreationFromRpc = makeTokenCreation(p);
export const TokenManagementFromRpc = makeTokenManagement(p);
export const MintFromRpc = makeMint(p);
export const BurnFromRpc = makeBurn(p);
export const StateInitializationFromRpc = makeStateInitialization(p);
export const StateUpdateFromRpc = makeStateUpdate(p);
export const StateResetFromRpc = makeStateReset(p);
export const ExternalClaimBodyFromRpc = makeExternalClaimBody(p);
export const VerifierSigFromRpc = makeVerifierSig(p);
export const ExternalClaimFromRpc = makeExternalClaim(p);
export const ValidatorConfigFromRpc = makeValidatorConfig(p);
export const CommitteeConfigFromRpc = makeCommitteeConfig(p);
export const CommitteeChangeFromRpc = makeCommitteeChange(p);
export const FixedAmountOrBpsFromRpc = makeFixedAmountOrBps(p);
export const EscrowCreateConfigFromRpc = makeEscrowCreateConfig(p);
export const EscrowCreateJobFromRpc = makeEscrowCreateJob(p);
export const EscrowSubmitFromRpc = makeEscrowSubmit(p);
export const EscrowRejectFromRpc = makeEscrowReject(p);
export const EscrowCompleteFromRpc = makeEscrowComplete(p);
export const EscrowFromRpc = makeEscrow(p);
export const OperationFromRpc = makeOperation(p);
export const ClaimTypeFromRpc = makeClaimType(p);
export const TransactionRelease20260319FromRpc = makeTransactionRelease20260319(p);
export const TransactionRelease20260407FromRpc = makeTransactionRelease20260407(p);
export const TransactionFromRpc = makeTransaction(p);
export const VersionedTransactionFromRpc = makeVersionedTransaction(p);
export const MultiSigConfigFromRpc = makeMultiSigConfig(p);
export const MultiSigFromRpc = makeMultiSig(p);
export const SignatureOrMultiSigFromRpc = makeSignatureOrMultiSig(p);
export const TransactionEnvelopeFromRpc = makeTransactionEnvelope(p);
export const ValidatedTransactionFromRpc = makeValidatedTransaction(p);
export const TransactionCertificateFromRpc = makeTransactionCertificate(p);
export const NonceRangeFromRpc = makeNonceRange(p);
export const PageRequestFromRpc = makePageRequest(p);
export const TokenMetadataFromRpc = makeTokenMetadata(p);
export const AccountInfoResponseFromRpc = makeAccountInfoResponse(p);
export const TokenInfoResponseFromRpc = makeTokenInfoResponse(p);
export const SubmitTransactionResponseFromRpc = makeSubmitTransactionResponse(p);
export const ConfirmTransactionResponseFromRpc = makeConfirmTransactionResponse(p);
export const ProxySubmitTransactionResultFromRpc = makeProxySubmitTransactionResult(p);
export const EscrowJobRecordFromRpc = makeEscrowJobRecord(p);
export const EscrowJobWithCertsFromRpc = makeEscrowJobWithCerts(p);

export const SubmitTransactionParamsFromRpc = makeSubmitTransactionParams(p);
export const FaucetDripParamsFromRpc = makeFaucetDripParams(p);
export const GetAccountInfoParamsFromRpc = makeGetAccountInfoParams(p);
export const GetPendingMultisigParamsFromRpc = makeGetPendingMultisigParams(p);
export const GetTokenInfoParamsFromRpc = makeGetTokenInfoParams(p);
export const GetTransactionCertificatesParamsFromRpc = makeGetTransactionCertificatesParams(p);

// Domain types — derived from the REST palette (canonical encoding).
// The internal `.Type` represents the SDK's domain model (Uint8Array addresses,
// bigint amounts, etc.) regardless of wire encoding.
export type { TokenTransfer, TokenCreation, TokenManagement, Mint, Burn } from './rest.ts';
export type { StateInitialization, StateUpdate, StateReset } from './rest.ts';
export type { ExternalClaimBody, VerifierSig, ExternalClaim } from './rest.ts';
export type { ValidatorConfig, CommitteeConfig, CommitteeChange } from './rest.ts';
export type { FixedAmountOrBps, EscrowCreateConfig, EscrowCreateJob } from './rest.ts';
export type { EscrowSubmit, EscrowReject, EscrowComplete, Escrow } from './rest.ts';
export type { Operation, ClaimType, Transaction, VersionedTransaction } from './rest.ts';
export type { MultiSigConfig, MultiSig, SignatureOrMultiSig } from './rest.ts';
export type { TransactionEnvelope, ValidatedTransaction, TransactionCertificate } from './rest.ts';
export type { NonceRange, PageRequest, TokenMetadata } from './rest.ts';
export type { AccountInfoResponse, TokenInfoResponse } from './rest.ts';
export type { SubmitTransactionResponse, ConfirmTransactionResponse, SubmitTransactionResult } from './rest.ts';
export type { EscrowJobRecord, EscrowJobWithCerts } from './rest.ts';
export type SubmitTransactionParams = typeof SubmitTransactionParamsFromRpc.Type;
export type FaucetDripParams = typeof FaucetDripParamsFromRpc.Type;
export type GetAccountInfoParams = typeof GetAccountInfoParamsFromRpc.Type;
export type GetPendingMultisigParams = typeof GetPendingMultisigParamsFromRpc.Type;
export type GetTokenInfoParams = typeof GetTokenInfoParamsFromRpc.Type;
export type GetTransactionCertificatesParams = typeof GetTransactionCertificatesParamsFromRpc.Type;
