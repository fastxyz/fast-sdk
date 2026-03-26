import { Address } from './address';
import { fromHex } from './amounts';
import { FAST_DECIMALS, FAST_TOKEN_ID, hashTransaction, tokenIdEquals, type FastTransaction } from './bcs';
import { bytesToPrefixedHex } from './bytes';
import type {
  FastTokenTransferSummary,
  FastTransactionCertificate,
  FastVersionedTransaction,
} from './types';

function unwrapTransaction(transaction: FastVersionedTransaction): FastTransaction {
  return 'Release20260319' in transaction ? transaction.Release20260319 : transaction;
}

export function getCertificateTransaction(certificate: FastTransactionCertificate): FastTransaction {
  return unwrapTransaction(certificate.envelope.transaction);
}

export function getCertificateHash(certificate: FastTransactionCertificate): string {
  return hashTransaction(getCertificateTransaction(certificate));
}

export function getCertificateTokenTransfer(
  certificate: FastTransactionCertificate,
): FastTokenTransferSummary | null {
  const transaction = getCertificateTransaction(certificate);
  if (!('TokenTransfer' in transaction.claim)) {
    return null;
  }

  const transfer = transaction.claim.TokenTransfer;
  const tokenIdBytes = new Uint8Array(Array.from(transfer.token_id));
  const native = tokenIdEquals(tokenIdBytes, FAST_TOKEN_ID);
  const decimals = native ? FAST_DECIMALS : undefined;

  const sender = new Address(new Uint8Array(transaction.sender));
  const recipient = new Address(new Uint8Array(transfer.recipient));

  return {
    sender: sender.toString(),
    recipient: recipient.toString(),
    tokenId: native ? 'native' : bytesToPrefixedHex(tokenIdBytes),
    amountHex: `0x${transfer.amount}`,
    amount: decimals === undefined ? undefined : fromHex(transfer.amount, decimals),
    userData: transfer.user_data
      ? bytesToPrefixedHex(new Uint8Array(Array.from(transfer.user_data)))
      : null,
  };
}
