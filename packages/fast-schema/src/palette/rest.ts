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
  makeExternalClaim,
  makeExternalClaimBody,
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
  makeNonceRange,
  makePageRequest,
  makeProxySubmitTransactionResult,
  makeSubmitTransactionResponse,
  makeTokenInfoResponse,
  makeTokenMetadata,
} from '../composite/response.ts';
import { makeTransaction, makeVersionedTransaction } from '../composite/transaction.ts';
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
export const OperationFromRest = makeOperation(p);
export const ClaimTypeFromRest = makeClaimType(p);
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
