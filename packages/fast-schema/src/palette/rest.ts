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
  makeClaimType,
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
import { RestPalette } from './definition.ts';

const p = RestPalette;

export const TokenTransferFromRest = makeTokenTransfer(p);
export const TokenCreationFromRest = makeTokenCreation(p);
export const TokenManagementFromRest = makeTokenManagement(p);
export const MintFromRest = makeMint(p);
export const BurnFromRest = makeBurn(p);
export const StateInitializationFromRest = makeStateInitialization(p);
export const StateUpdateFromRest = makeStateUpdate(p);
export const StateResetFromRest = makeStateReset(p);
export const ExternalClaimBodyFromRest = makeExternalClaimBody(p);
export const VerifierSigFromRest = makeVerifierSig(p);
export const ExternalClaimFromRest = makeExternalClaim(p);
export const ValidatorConfigFromRest = makeValidatorConfig(p);
export const CommitteeConfigFromRest = makeCommitteeConfig(p);
export const CommitteeChangeFromRest = makeCommitteeChange(p);
export const FixedAmountOrBpsFromRest = makeFixedAmountOrBps(p);
export const EscrowCreateConfigFromRest = makeEscrowCreateConfig(p);
export const EscrowCreateJobFromRest = makeEscrowCreateJob(p);
export const EscrowSubmitFromRest = makeEscrowSubmit(p);
export const EscrowRejectFromRest = makeEscrowReject(p);
export const EscrowCompleteFromRest = makeEscrowComplete(p);
export const EscrowFromRest = makeEscrow(p);
export const OperationFromRest = makeOperation(p);
export const ClaimTypeFromRest = makeClaimType(p);
export const TransactionRelease20260319FromRest = makeTransactionRelease20260319(p);
export const TransactionRelease20260407FromRest = makeTransactionRelease20260407(p);
export const TransactionFromRest = makeTransaction(p);
export const VersionedTransactionFromRest = makeVersionedTransaction(p);
export const MultiSigConfigFromRest = makeMultiSigConfig(p);
export const MultiSigFromRest = makeMultiSig(p);
export const SignatureOrMultiSigFromRest = makeSignatureOrMultiSig(p);
export const TransactionEnvelopeFromRest = makeTransactionEnvelope(p);
export const ValidatedTransactionFromRest = makeValidatedTransaction(p);
export const TransactionCertificateFromRest = makeTransactionCertificate(p);
export const NonceRangeFromRest = makeNonceRange(p);
export const PageRequestFromRest = makePageRequest(p);
export const TokenMetadataFromRest = makeTokenMetadata(p);
export const AccountInfoResponseFromRest = makeAccountInfoResponse(p);
export const TokenInfoResponseFromRest = makeTokenInfoResponse(p);
export const SubmitTransactionResponseFromRest = makeSubmitTransactionResponse(p);
export const ConfirmTransactionResponseFromRest = makeConfirmTransactionResponse(p);
export const ProxySubmitTransactionResultFromRest = makeProxySubmitTransactionResult(p);
export const EscrowJobRecordFromRest = makeEscrowJobRecord(p);
export const EscrowJobWithCertsFromRest = makeEscrowJobWithCerts(p);

// Domain type aliases — canonical internal types derived from the REST palette.
export type TokenTransfer = typeof TokenTransferFromRest.Type;
export type TokenCreation = typeof TokenCreationFromRest.Type;
export type TokenManagement = typeof TokenManagementFromRest.Type;
export type Mint = typeof MintFromRest.Type;
export type Burn = typeof BurnFromRest.Type;
export type StateInitialization = typeof StateInitializationFromRest.Type;
export type StateUpdate = typeof StateUpdateFromRest.Type;
export type StateReset = typeof StateResetFromRest.Type;
export type ExternalClaimBody = typeof ExternalClaimBodyFromRest.Type;
export type VerifierSig = typeof VerifierSigFromRest.Type;
export type ExternalClaim = typeof ExternalClaimFromRest.Type;
export type ValidatorConfig = typeof ValidatorConfigFromRest.Type;
export type CommitteeConfig = typeof CommitteeConfigFromRest.Type;
export type CommitteeChange = typeof CommitteeChangeFromRest.Type;
export type FixedAmountOrBps = typeof FixedAmountOrBpsFromRest.Type;
export type EscrowCreateConfig = typeof EscrowCreateConfigFromRest.Type;
export type EscrowCreateJob = typeof EscrowCreateJobFromRest.Type;
export type EscrowSubmit = typeof EscrowSubmitFromRest.Type;
export type EscrowReject = typeof EscrowRejectFromRest.Type;
export type EscrowComplete = typeof EscrowCompleteFromRest.Type;
export type Escrow = typeof EscrowFromRest.Type;
export type Operation = typeof OperationFromRest.Type;
export type ClaimType = typeof ClaimTypeFromRest.Type;
export type Transaction = typeof TransactionFromRest.Type;
export type VersionedTransaction = typeof VersionedTransactionFromRest.Type;
export type MultiSigConfig = typeof MultiSigConfigFromRest.Type;
export type MultiSig = typeof MultiSigFromRest.Type;
export type SignatureOrMultiSig = typeof SignatureOrMultiSigFromRest.Type;
export type TransactionEnvelope = typeof TransactionEnvelopeFromRest.Type;
export type ValidatedTransaction = typeof ValidatedTransactionFromRest.Type;
export type TransactionCertificate = typeof TransactionCertificateFromRest.Type;
export type NonceRange = typeof NonceRangeFromRest.Type;
export type PageRequest = typeof PageRequestFromRest.Type;
export type TokenMetadata = typeof TokenMetadataFromRest.Type;
export type AccountInfoResponse = typeof AccountInfoResponseFromRest.Type;
export type TokenInfoResponse = typeof TokenInfoResponseFromRest.Type;
export type SubmitTransactionResponse = typeof SubmitTransactionResponseFromRest.Type;
export type ConfirmTransactionResponse = typeof ConfirmTransactionResponseFromRest.Type;
export type SubmitTransactionResult = typeof ProxySubmitTransactionResultFromRest.Type;
export type EscrowJobRecord = typeof EscrowJobRecordFromRest.Type;
export type EscrowJobWithCerts = typeof EscrowJobWithCertsFromRest.Type;
