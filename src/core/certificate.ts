import { fromHex } from './amounts.js';
import { encodeFastAddress } from './address.js';
import { FAST_DECIMALS, FAST_TOKEN_ID, hashTransaction, tokenIdEquals, type FastTransaction } from './bcs.js';
import { bytesToPrefixedHex } from './bytes.js';
import type {
  FastTokenTransferSummary,
  FastTransactionCertificate,
  FastVersionedTransaction,
} from './types.js';

function unwrapTransaction(transaction: FastVersionedTransaction): FastTransaction {
  return 'Release20260303' in transaction ? transaction.Release20260303 : transaction;
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

  return {
    sender: encodeFastAddress(new Uint8Array(transaction.sender)),
    recipient: encodeFastAddress(new Uint8Array(transaction.recipient)),
    tokenId: native ? 'native' : bytesToPrefixedHex(tokenIdBytes),
    amountHex: `0x${transfer.amount}`,
    amount: decimals === undefined ? undefined : fromHex(transfer.amount, decimals),
    userData: transfer.user_data
      ? bytesToPrefixedHex(new Uint8Array(Array.from(transfer.user_data)))
      : null,
  };
}
