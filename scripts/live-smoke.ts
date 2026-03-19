import assert from 'node:assert/strict';

import {
  FastProvider,
  FastWallet,
  fastAddressToBytes,
  type FastTransaction,
  type FastTransactionCertificate,
  type FastVersionedTransaction,
  type TokenBalance,
} from '../src/index.js';

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

function toTransaction(transaction: FastVersionedTransaction): FastTransaction {
  return 'Release20260319' in transaction ? transaction.Release20260319 : transaction;
}

function requireLiveOptIn(): void {
  if (process.argv.includes('--live') || process.env.FAST_LIVE_SMOKE === '1') {
    return;
  }

  throw new Error(
    'Refusing to run live smoke without explicit opt-in. Pass --live or set FAST_LIVE_SMOKE=1.',
  );
}

function formatTokenId(bytes: Iterable<number>): string {
  return `0x${Buffer.from(Array.from(bytes)).toString('hex')}`;
}

async function pollForCreatedToken(
  wallet: FastWallet,
  symbol: string,
  attempts: number,
  delayMs: number,
): Promise<TokenBalance> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tokens = await wallet.tokens();
    const match = tokens.find((token) => token.symbol === symbol);
    if (match) {
      return match;
    }

    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Created token "${symbol}" did not appear in wallet balances after polling.`);
}

requireLiveOptIn();

const network = process.env.FAST_LIVE_SMOKE_NETWORK ?? 'testnet';
const tokenPrefix = process.env.FAST_LIVE_SMOKE_PREFIX ?? 'CODX';
const decimals = Number.parseInt(process.env.FAST_LIVE_SMOKE_DECIMALS ?? '6', 10);
const initialAmountHex = stripHexPrefix(process.env.FAST_LIVE_SMOKE_INITIAL_AMOUNT_HEX ?? '1').toLowerCase();
const pollAttempts = Number.parseInt(process.env.FAST_LIVE_SMOKE_POLL_ATTEMPTS ?? '6', 10);
const pollDelayMs = Number.parseInt(process.env.FAST_LIVE_SMOKE_POLL_DELAY_MS ?? '500', 10);

assert.ok(Number.isInteger(decimals) && decimals >= 0 && decimals <= 255, 'FAST_LIVE_SMOKE_DECIMALS must be an integer between 0 and 255.');
assert.ok(/^[0-9a-f]+$/i.test(initialAmountHex), 'FAST_LIVE_SMOKE_INITIAL_AMOUNT_HEX must be a hex string.');
assert.ok(!/^0+$/i.test(initialAmountHex), 'FAST_LIVE_SMOKE_INITIAL_AMOUNT_HEX must be non-zero so the transfer step can run.');
assert.ok(Number.isInteger(pollAttempts) && pollAttempts > 0, 'FAST_LIVE_SMOKE_POLL_ATTEMPTS must be a positive integer.');
assert.ok(Number.isInteger(pollDelayMs) && pollDelayMs >= 0, 'FAST_LIVE_SMOKE_POLL_DELAY_MS must be a non-negative integer.');

const provider = new FastProvider({ network });
const creator = await FastWallet.generate(provider);
const recipient = await FastWallet.generate(provider);
const tokenName = `${tokenPrefix}${String(Date.now()).slice(-6)}`;
const networkId = await provider.getNetworkId();

const creation = await creator.submit({
  claim: {
    TokenCreation: {
      token_name: tokenName,
      decimals,
      initial_amount: initialAmountHex,
      mints: [],
      user_data: null,
    },
  },
});

const createdToken = await pollForCreatedToken(creator, tokenName, pollAttempts, pollDelayMs);
const createdTokenInfo = await provider.getTokenInfo(createdToken.tokenId);
assert.ok(createdTokenInfo, 'Created token metadata was not returned by getTokenInfo().');
assert.equal(createdTokenInfo.symbol, tokenName);
assert.equal(createdTokenInfo.decimals, decimals);
assert.equal(createdTokenInfo.totalSupply, initialAmountHex);

const creatorBalanceAfterCreate = await creator.balance(createdToken.tokenId);
assert.equal(creatorBalanceAfterCreate.amount, createdToken.balance);

const transferAmount = creatorBalanceAfterCreate.amount;
const transfer = await creator.send({
  to: recipient.address,
  amount: transferAmount,
  token: createdToken.tokenId,
});

const creatorBalanceAfterSend = await creator.balance(createdToken.tokenId);
const recipientBalanceAfterSend = await provider.getBalance(recipient.address, createdToken.tokenId);
const recipientTokensAfterSend = await provider.getTokens(recipient.address);
const creatorCertificates = await provider.getTransactionCertificates(creator.address, 0, 5);
const creationCertByNonce = await provider.getCertificateByNonce(creator.address, 0);
const transferCertByNonce = await provider.getCertificateByNonce(creator.address, 1);

assert.equal(creatorBalanceAfterSend.amount, '0');
assert.equal(recipientBalanceAfterSend.amount, transferAmount);

const recipientToken = recipientTokensAfterSend.find((token) => token.tokenId === createdToken.tokenId);
assert.ok(recipientToken, 'Recipient wallet did not report the transferred token via getTokens().');
assert.equal(recipientToken.balance, transferAmount);

assert.ok(creationCertByNonce, 'Creation certificate was not returned by getCertificateByNonce().');
assert.ok(transferCertByNonce, 'Transfer certificate was not returned by getCertificateByNonce().');
assert.ok(creatorCertificates.length >= 2, 'Expected at least two creator certificates after creation and transfer.');

const creationTransaction = toTransaction((creationCertByNonce as FastTransactionCertificate).envelope.transaction);
const transferTransaction = toTransaction((transferCertByNonce as FastTransactionCertificate).envelope.transaction);

assert.equal(creationTransaction.network_id, networkId);
assert.equal(transferTransaction.network_id, networkId);
assert.ok('TokenCreation' in creationTransaction.claim, 'Nonce 0 certificate was not a TokenCreation.');
assert.ok('TokenTransfer' in transferTransaction.claim, 'Nonce 1 certificate was not a TokenTransfer.');
assert.equal(formatTokenId(transferTransaction.claim.TokenTransfer.token_id), createdToken.tokenId);
assert.deepEqual(
  Array.from(transferTransaction.claim.TokenTransfer.recipient),
  Array.from(fastAddressToBytes(recipient.address)),
);

const summary = {
  checkedAt: new Date().toISOString(),
  network,
  networkId,
  creator: creator.address,
  recipient: recipient.address,
  tokenName,
  createdToken,
  createdTokenInfo,
  creationTxHash: creation.txHash,
  transferTxHash: transfer.txHash,
  transferExplorerUrl: transfer.explorerUrl,
  creatorBalanceAfterCreate,
  creatorBalanceAfterSend,
  recipientBalanceAfterSend,
  recipientTokensAfterSend,
  creatorCertificateCount: creatorCertificates.length,
  creationNonceVerified: true,
  transferNonceVerified: true,
};

console.log(JSON.stringify(summary, null, 2));
