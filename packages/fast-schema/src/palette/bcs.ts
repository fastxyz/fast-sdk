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
import { BcsPalette } from './definition.ts';

const p = BcsPalette;

export const TokenTransferFromBcs = makeTokenTransfer(p);
export const TokenCreationFromBcs = makeTokenCreation(p);
export const TokenManagementFromBcs = makeTokenManagement(p);
export const MintFromBcs = makeMint(p);
export const BurnFromBcs = makeBurn(p);
export const StateInitializationFromBcs = makeStateInitialization(p);
export const StateUpdateFromBcs = makeStateUpdate(p);
export const StateResetFromBcs = makeStateReset(p);
export const ExternalClaimBodyFromBcs = makeExternalClaimBody(p);
export const VerifierSigFromBcs = makeVerifierSig(p);
export const ExternalClaimFromBcs = makeExternalClaim(p);
export const ValidatorConfigFromBcs = makeValidatorConfig(p);
export const CommitteeConfigFromBcs = makeCommitteeConfig(p);
export const CommitteeChangeFromBcs = makeCommitteeChange(p);
const bcsOpts = { unitEncoding: 'bcs' } as const;
export const OperationFromBcs = makeOperation(p, bcsOpts);
export const ClaimTypeFromBcs = makeClaimType(p, bcsOpts);
export const TransactionFromBcs = makeTransaction(p, bcsOpts);
export const VersionedTransactionFromBcs = makeVersionedTransaction(p, bcsOpts);
export const MultiSigConfigFromBcs = makeMultiSigConfig(p);
export const MultiSigFromBcs = makeMultiSig(p);
export const SignatureOrMultiSigFromBcs = makeSignatureOrMultiSig(p);
export const TransactionEnvelopeFromBcs = makeTransactionEnvelope(p);
export const ValidatedTransactionFromBcs = makeValidatedTransaction(p);
export const TransactionCertificateFromBcs = makeTransactionCertificate(p);
export const NonceRangeFromBcs = makeNonceRange(p);
export const PageRequestFromBcs = makePageRequest(p);
export const TokenMetadataFromBcs = makeTokenMetadata(p);
export const AccountInfoResponseFromBcs = makeAccountInfoResponse(p);
export const TokenInfoResponseFromBcs = makeTokenInfoResponse(p);
export const SubmitTransactionResponseFromBcs = makeSubmitTransactionResponse(p);
export const ConfirmTransactionResponseFromBcs = makeConfirmTransactionResponse(p);
export const ProxySubmitTransactionResultFromBcs = makeProxySubmitTransactionResult(p);
