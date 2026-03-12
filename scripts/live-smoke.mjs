import { FastProvider, FastWallet } from '../src/index.js';
import { FAST_DECIMALS, FAST_TOKEN_ID, hexToTokenId, tokenIdEquals } from '../src/bcs.js';
import { toHex } from '../src/utils.js';

const DEFAULT_RPC_URL = 'https://testnet.api.fast.xyz/proxy';
const DEFAULT_FAST_AMOUNT = '0.000001';
const DEFAULT_MESSAGE = 'fast-sdk live smoke';
const DEFAULT_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_DELAY_MS = 1_000;

function usage() {
  return [
    'Usage: npm run live:smoke',
    '',
    'Required sender configuration (choose one):',
    '  FAST_SENDER_PRIVATE_KEY=<hex>',
    '  FAST_SENDER_KEYFILE=~/.fast/keys/funded.json',
    '  FAST_SENDER_KEY_NAME=my-funded-key',
    '',
    'Optional configuration:',
    '  FAST_RPC_URL=https://testnet.api.fast.xyz/proxy',
    '  FAST_EXPLORER_URL=https://explorer.fast.xyz',
    '  FAST_RECIPIENT_ADDRESS=fast1...',
    '  FAST_FAST_AMOUNT=0.000001',
    '  FAST_SUBMIT_AMOUNT=0.000001',
    '  FAST_TOKEN=<symbol-or-0x-token-id>',
    '  FAST_TOKEN_AMOUNT=0.000001',
    '  FAST_POLL_ATTEMPTS=20',
    '  FAST_POLL_DELAY_MS=1000',
    '',
    'Notes:',
    '  - The sender wallet must be funded with FAST for fees plus transfer amounts.',
    '  - If FAST_RECIPIENT_ADDRESS is omitted, the script generates a fresh recipient wallet.',
    '  - FAST_TOKEN is optional and enables an additional non-native token transfer check.',
  ].join('\n');
}

function parsePositiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(name + ' must be a positive integer');
  }
  return value;
}

function requireNonEmpty(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(name + ' is required');
  }
  return value;
}

function rawHexToBigInt(value) {
  const text = typeof value === 'string' ? value : '0';
  const clean = text.startsWith('0x') || text.startsWith('0X') ? text.slice(2) : text;
  return BigInt('0x' + (clean || '0'));
}

function rawNativeBalance(info) {
  return rawHexToBigInt(info?.balance ?? '0');
}

function rawTokenBalance(info, tokenId) {
  const entry = info?.token_balance?.find(([candidate]) => tokenIdEquals(candidate, tokenId));
  return rawHexToBigInt(entry?.[1] ?? '0');
}

function printSection(title) {
  console.log('');
  console.log('== ' + title + ' ==');
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccountInfoOrThrow(provider, address, label) {
  const info = await provider.getAccountInfo(address);
  if (!info) {
    throw new Error(label + ' account lookup returned null for ' + address);
  }
  return info;
}

async function loadSenderWallet(provider) {
  const privateKey = process.env.FAST_SENDER_PRIVATE_KEY;
  const keyFile = process.env.FAST_SENDER_KEYFILE;
  const keyName = process.env.FAST_SENDER_KEY_NAME;
  const configured = [privateKey, keyFile, keyName].filter(Boolean).length;

  if (configured !== 1) {
    throw new Error('Configure exactly one of FAST_SENDER_PRIVATE_KEY, FAST_SENDER_KEYFILE, or FAST_SENDER_KEY_NAME');
  }

  if (privateKey) {
    return FastWallet.fromPrivateKey(privateKey, provider);
  }
  if (keyFile) {
    return FastWallet.fromKeyfile({ keyFile, createIfMissing: false }, provider);
  }
  return FastWallet.fromKeyfile({ key: keyName, createIfMissing: false }, provider);
}

async function waitForTransfer(opts) {
  const {
    provider,
    label,
    senderAddress,
    recipientAddress,
    expectedNonce,
    senderBalanceBefore,
    recipientBalanceBefore,
    readSenderBalance,
    readRecipientBalance,
    attempts,
    delayMs,
  } = opts;

  let lastSenderInfo = null;
  let lastRecipientInfo = null;
  let lastSenderBalance = senderBalanceBefore;
  let lastRecipientBalance = recipientBalanceBefore;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    lastSenderInfo = await getAccountInfoOrThrow(provider, senderAddress, 'Sender');
    lastRecipientInfo = await getAccountInfoOrThrow(provider, recipientAddress, 'Recipient');
    lastSenderBalance = readSenderBalance(lastSenderInfo);
    lastRecipientBalance = readRecipientBalance(lastRecipientInfo);
    const nonce = lastSenderInfo.next_nonce ?? 0;

    if (
      nonce >= expectedNonce &&
      lastSenderBalance < senderBalanceBefore &&
      lastRecipientBalance > recipientBalanceBefore
    ) {
      return {
        senderInfo: lastSenderInfo,
        recipientInfo: lastRecipientInfo,
        senderBalance: lastSenderBalance,
        recipientBalance: lastRecipientBalance,
      };
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    label + ' did not settle as expected. ' +
      'Wanted nonce >= ' + expectedNonce + ', sender balance < ' + senderBalanceBefore + ', recipient balance > ' + recipientBalanceBefore + '. ' +
      'Last seen nonce=' + (lastSenderInfo?.next_nonce ?? 'n/a') + ', sender balance=' + lastSenderBalance + ', recipient balance=' + lastRecipientBalance,
  );
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(usage());
    return;
  }

  const rpcUrl = requireNonEmpty('FAST_RPC_URL', DEFAULT_RPC_URL);
  const explorerUrl = process.env.FAST_EXPLORER_URL;
  const fastAmount = requireNonEmpty('FAST_FAST_AMOUNT', DEFAULT_FAST_AMOUNT);
  const submitAmount = requireNonEmpty('FAST_SUBMIT_AMOUNT', fastAmount);
  const token = process.env.FAST_TOKEN;
  const tokenAmount = requireNonEmpty('FAST_TOKEN_AMOUNT', DEFAULT_FAST_AMOUNT);
  const pollAttempts = parsePositiveInt('FAST_POLL_ATTEMPTS', DEFAULT_POLL_ATTEMPTS);
  const pollDelayMs = parsePositiveInt('FAST_POLL_DELAY_MS', DEFAULT_POLL_DELAY_MS);

  const provider = new FastProvider({
    rpcUrl,
    explorerUrl: explorerUrl || undefined,
  });

  const sender = await loadSenderWallet(provider);
  const generatedRecipient = !process.env.FAST_RECIPIENT_ADDRESS;
  const recipientAddress = process.env.FAST_RECIPIENT_ADDRESS ?? (await FastWallet.generate(provider)).address;

  assertCondition(sender.address !== recipientAddress, 'Sender and recipient must be different addresses');

  console.log('RPC URL:', rpcUrl);
  console.log('Sender:', sender.address);
  console.log('Recipient:', recipientAddress, generatedRecipient ? '(generated)' : '(provided)');
  if (explorerUrl) {
    console.log('Explorer:', explorerUrl);
  }

  printSection('Read-only checks');
  const senderInfo = await getAccountInfoOrThrow(provider, sender.address, 'Sender');
  const recipientInfo = await getAccountInfoOrThrow(provider, recipientAddress, 'Recipient');
  const senderFast = await provider.getBalance(sender.address);
  const recipientFast = await provider.getBalance(recipientAddress);
  const senderTokens = await provider.getTokens(sender.address);
  const recipientTokens = await provider.getTokens(recipientAddress);
  const fastInfo = await provider.getTokenInfo('FAST');

  console.log('Sender nonce:', senderInfo.next_nonce ?? 0);
  console.log('Recipient nonce:', recipientInfo.next_nonce ?? 0);
  console.log('Sender FAST:', senderFast.amount);
  console.log('Recipient FAST:', recipientFast.amount);
  console.log('Sender token count:', senderTokens.length);
  console.log('Recipient token count:', recipientTokens.length);
  console.log('FAST token info:', JSON.stringify(fastInfo));

  printSection('Sign / verify');
  const signed = await sender.sign({ message: DEFAULT_MESSAGE });
  const verified = await sender.verify({
    message: DEFAULT_MESSAGE,
    signature: signed.signature,
    address: sender.address,
  });
  assertCondition(verified.valid === true, 'sign/verify roundtrip failed');
  console.log('Signature verified:', verified.valid);

  printSection('FAST send');
  const senderBeforeFast = await getAccountInfoOrThrow(provider, sender.address, 'Sender');
  const recipientBeforeFast = await getAccountInfoOrThrow(provider, recipientAddress, 'Recipient');
  const senderBeforeFastRaw = rawNativeBalance(senderBeforeFast);
  const recipientBeforeFastRaw = rawNativeBalance(recipientBeforeFast);
  const sendResult = await sender.send({ to: recipientAddress, amount: fastAmount });
  console.log('FAST send txHash:', sendResult.txHash);
  if (sendResult.explorerUrl) {
    console.log('FAST send explorer:', sendResult.explorerUrl);
  }

  const fastSettled = await waitForTransfer({
    provider,
    label: 'FAST send',
    senderAddress: sender.address,
    recipientAddress,
    expectedNonce: (senderBeforeFast.next_nonce ?? 0) + 1,
    senderBalanceBefore: senderBeforeFastRaw,
    recipientBalanceBefore: recipientBeforeFastRaw,
    readSenderBalance: rawNativeBalance,
    readRecipientBalance: rawNativeBalance,
    attempts: pollAttempts,
    delayMs: pollDelayMs,
  });
  console.log('Sender nonce after FAST send:', fastSettled.senderInfo.next_nonce ?? 0);
  console.log('Sender FAST raw after send:', fastSettled.senderBalance.toString());
  console.log('Recipient FAST raw after send:', fastSettled.recipientBalance.toString());

  printSection('Low-level submit');
  const senderBeforeSubmit = await getAccountInfoOrThrow(provider, sender.address, 'Sender');
  const recipientBeforeSubmit = await getAccountInfoOrThrow(provider, recipientAddress, 'Recipient');
  const senderBeforeSubmitRaw = rawNativeBalance(senderBeforeSubmit);
  const recipientBeforeSubmitRaw = rawNativeBalance(recipientBeforeSubmit);
  const submitResult = await sender.submit({
    recipient: recipientAddress,
    claim: {
      TokenTransfer: {
        token_id: FAST_TOKEN_ID,
        amount: toHex(submitAmount, FAST_DECIMALS),
        user_data: null,
      },
    },
  });
  console.log('Low-level submit txHash:', submitResult.txHash);

  const submitSettled = await waitForTransfer({
    provider,
    label: 'Low-level submit',
    senderAddress: sender.address,
    recipientAddress,
    expectedNonce: (senderBeforeSubmit.next_nonce ?? 0) + 1,
    senderBalanceBefore: senderBeforeSubmitRaw,
    recipientBalanceBefore: recipientBeforeSubmitRaw,
    readSenderBalance: rawNativeBalance,
    readRecipientBalance: rawNativeBalance,
    attempts: pollAttempts,
    delayMs: pollDelayMs,
  });
  console.log('Sender nonce after low-level submit:', submitSettled.senderInfo.next_nonce ?? 0);
  console.log('Sender FAST raw after submit:', submitSettled.senderBalance.toString());
  console.log('Recipient FAST raw after submit:', submitSettled.recipientBalance.toString());

  if (token) {
    printSection('Token send');
    const tokenInfo = await provider.getTokenInfo(token);
    assertCondition(tokenInfo !== null, 'Token ' + token + ' was not found on ' + rpcUrl);
    assertCondition(tokenInfo.tokenId !== 'native', 'FAST_TOKEN must refer to a non-native token');
    const tokenId = hexToTokenId(tokenInfo.tokenId);
    const senderBeforeToken = await getAccountInfoOrThrow(provider, sender.address, 'Sender');
    const recipientBeforeToken = await getAccountInfoOrThrow(provider, recipientAddress, 'Recipient');
    const senderBeforeTokenRaw = rawTokenBalance(senderBeforeToken, tokenId);
    const recipientBeforeTokenRaw = rawTokenBalance(recipientBeforeToken, tokenId);

    console.log('Resolved token:', JSON.stringify(tokenInfo));
    console.log('Sender token raw before:', senderBeforeTokenRaw.toString());
    console.log('Recipient token raw before:', recipientBeforeTokenRaw.toString());

    const tokenResult = await sender.send({ to: recipientAddress, amount: tokenAmount, token });
    console.log('Token send txHash:', tokenResult.txHash);
    if (tokenResult.explorerUrl) {
      console.log('Token send explorer:', tokenResult.explorerUrl);
    }

    const tokenSettled = await waitForTransfer({
      provider,
      label: 'Token send',
      senderAddress: sender.address,
      recipientAddress,
      expectedNonce: (senderBeforeToken.next_nonce ?? 0) + 1,
      senderBalanceBefore: senderBeforeTokenRaw,
      recipientBalanceBefore: recipientBeforeTokenRaw,
      readSenderBalance: (info) => rawTokenBalance(info, tokenId),
      readRecipientBalance: (info) => rawTokenBalance(info, tokenId),
      attempts: pollAttempts,
      delayMs: pollDelayMs,
    });
    console.log('Sender token raw after:', tokenSettled.senderBalance.toString());
    console.log('Recipient token raw after:', tokenSettled.recipientBalance.toString());
  } else {
    printSection('Token send');
    console.log('Skipped: set FAST_TOKEN to test a non-native token transfer path.');
  }

  printSection('Done');
  console.log('Live smoke checks completed successfully.');
}

main().catch((error) => {
  console.error('');
  console.error('Live smoke failed.');
  console.error(error instanceof Error ? error.message : error);
  if (error && typeof error === 'object') {
    if (typeof error.code === 'string') {
      console.error('Code:', error.code);
    }
    if (typeof error.note === 'string' && error.note) {
      console.error('Note:', error.note);
    }
  }
  console.error('');
  console.error(usage());
  process.exit(1);
});
