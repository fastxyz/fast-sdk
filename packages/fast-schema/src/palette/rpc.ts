import {
  makeMultiSig,
  makeMultiSigConfig,
  makeSignatureOrMultiSig,
  makeTransactionCertificate,
  makeTransactionEnvelope,
  makeValidatedTransaction,
} from "../composite/envelope.ts";
import {
  makeBurn,
  makeClaimType,
  makeCommitteeChange,
  makeCommitteeConfig,
  makeExternalClaim,
  makeExternalClaimBody,
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
} from "../composite/operations.ts";
import {
  makeAccountInfoResponse,
  makeConfirmTransactionResponse,
  makeNonceRange,
  makePageRequest,
  makeProxySubmitTransactionResult,
  makeSubmitTransactionResponse,
  makeTokenInfoResponse,
  makeTokenMetadata,
} from "../composite/response.ts";
import {
  makeTransaction,
  makeVersionedTransaction,
} from "../composite/transaction.ts";
import {
  makeFaucetDripParams,
  makeGetAccountInfoParams,
  makeGetPendingMultisigParams,
  makeGetTokenInfoParams,
  makeGetTransactionCertificatesParams,
  makeSubmitTransactionParams,
} from "../interface/proxy.ts";
import { RpcPalette } from "./definition.ts";

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
export const OperationFromRpc = makeOperation(p);
export const ClaimTypeFromRpc = makeClaimType(p);
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
export const SubmitTransactionResponseFromRpc =
  makeSubmitTransactionResponse(p);
export const ConfirmTransactionResponseFromRpc =
  makeConfirmTransactionResponse(p);
export const ProxySubmitTransactionResultFromRpc =
  makeProxySubmitTransactionResult(p);

export const SubmitTransactionParamsFromRpc = makeSubmitTransactionParams(p);
export const FaucetDripParamsFromRpc = makeFaucetDripParams(p);
export const GetAccountInfoParamsFromRpc = makeGetAccountInfoParams(p);
export const GetPendingMultisigParamsFromRpc = makeGetPendingMultisigParams(p);
export const GetTokenInfoParamsFromRpc = makeGetTokenInfoParams(p);
export const GetTransactionCertificatesParamsFromRpc =
  makeGetTransactionCertificatesParams(p);

export type TokenTransfer = typeof TokenTransferFromRpc.Type;
export type TokenCreation = typeof TokenCreationFromRpc.Type;
export type TokenManagement = typeof TokenManagementFromRpc.Type;
export type Mint = typeof MintFromRpc.Type;
export type Burn = typeof BurnFromRpc.Type;
export type StateInitialization = typeof StateInitializationFromRpc.Type;
export type StateUpdate = typeof StateUpdateFromRpc.Type;
export type StateReset = typeof StateResetFromRpc.Type;
export type ExternalClaimBody = typeof ExternalClaimBodyFromRpc.Type;
export type VerifierSig = typeof VerifierSigFromRpc.Type;
export type ExternalClaim = typeof ExternalClaimFromRpc.Type;
export type ValidatorConfig = typeof ValidatorConfigFromRpc.Type;
export type CommitteeConfig = typeof CommitteeConfigFromRpc.Type;
export type CommitteeChange = typeof CommitteeChangeFromRpc.Type;
export type Operation = typeof OperationFromRpc.Type;
export type ClaimType = typeof ClaimTypeFromRpc.Type;
export type Transaction = typeof TransactionFromRpc.Type;
export type VersionedTransaction = typeof VersionedTransactionFromRpc.Type;
export type MultiSigConfig = typeof MultiSigConfigFromRpc.Type;
export type MultiSig = typeof MultiSigFromRpc.Type;
export type SignatureOrMultiSig = typeof SignatureOrMultiSigFromRpc.Type;
export type TransactionEnvelope = typeof TransactionEnvelopeFromRpc.Type;
export type ValidatedTransaction = typeof ValidatedTransactionFromRpc.Type;
export type TransactionCertificate = typeof TransactionCertificateFromRpc.Type;
export type NonceRange = typeof NonceRangeFromRpc.Type;
export type PageRequest = typeof PageRequestFromRpc.Type;
export type TokenMetadata = typeof TokenMetadataFromRpc.Type;
export type AccountInfoResponse = typeof AccountInfoResponseFromRpc.Type;
export type TokenInfoResponse = typeof TokenInfoResponseFromRpc.Type;
export type SubmitTransactionResponse =
  typeof SubmitTransactionResponseFromRpc.Type;
export type ConfirmTransactionResponse =
  typeof ConfirmTransactionResponseFromRpc.Type;
export type SubmitTransactionResult =
  typeof ProxySubmitTransactionResultFromRpc.Type;
export type SubmitTransactionParams =
  typeof SubmitTransactionParamsFromRpc.Type;
export type FaucetDripParams = typeof FaucetDripParamsFromRpc.Type;
export type GetAccountInfoParams = typeof GetAccountInfoParamsFromRpc.Type;
export type GetPendingMultisigParams =
  typeof GetPendingMultisigParamsFromRpc.Type;
export type GetTokenInfoParams = typeof GetTokenInfoParamsFromRpc.Type;
export type GetTransactionCertificatesParams =
  typeof GetTransactionCertificatesParamsFromRpc.Type;
