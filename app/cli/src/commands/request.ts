import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { bech32m } from 'bech32';
import { Clock, Effect, Option } from 'effect';
import QRCode from 'qrcode';
import { tokenizeArgv } from '../argv.js';
import type { RequestArgs } from '../cli.js';
import {
  ExplorerNotConfiguredError,
  FileIOError,
  InternalError,
  InvalidAddressError,
  InvalidAmountError,
  InvalidUsageError,
} from '../errors/index.js';
import { formatBaseUnits, parsePositiveAmount } from '../services/amount.js';
import { historyTypeOf } from '../services/api/explorer.js';
import { FastIdResolver, fastIdRecipient } from '../services/api/fast-id.js';
import { ClientConfig } from '../services/config/client.js';
import { validateWaitTimeoutSeconds, waitForIncoming } from '../services/incoming-payments.js';
import { Output } from '../services/output.js';
import { ensureMultisigNetwork } from '../services/signer-resolver.js';
import { AccountStore } from '../services/storage/account.js';
import { NetworkConfigService } from '../services/storage/network.js';
import type { Command } from './index.js';

/**
 * The Fast app's Send screen. It prefills the recipient from `to` and the
 * amount from `amount`; the payer reviews and confirms the transfer there.
 */
export const PAYMENT_REQUEST_BASE_URL = 'https://app.fast.xyz/send';

/** app.fast.xyz runs on mainnet only, so a request link is only meaningful there. */
const REQUEST_NETWORK = 'mainnet';

/** How long `--wait` waits for the payment when `--timeout` is not given. */
export const DEFAULT_WAIT_TIMEOUT_SECONDS = 300;

/** What `fast request --json` returns (plus `qrFile` when `--qr-file` is set). */
export interface PaymentRequest {
  readonly url: string;
  /** fast1… address to be paid (for a Fast ID payee, the address the name resolved to). */
  readonly address: string;
  /** The Fast ID name, when `--to` was one. */
  readonly toName?: string;
  readonly amount: string;
  readonly token: string;
  readonly network: string;
  readonly createdAt: string;
}

export const buildPaymentRequestUrl = (address: string, amount: string): string => {
  const params = new URLSearchParams({ to: address, amount });
  return `${PAYMENT_REQUEST_BASE_URL}?${params.toString()}`;
};

const DECIMAL = /^(?:(\d+)(?:\.(\d+))?|\.(\d+))$/;

/**
 * Validate a requested amount and return it in canonical form: no leading
 * zeros in the whole part, no trailing zeros in the fraction (`010.50` →
 * `10.5`). That is also a form the app's amount field accepts as-is.
 */
export const normalizeRequestAmount = (raw: string, decimals: number, symbol: string): Effect.Effect<string, InvalidAmountError> => {
  const input = raw.trim();
  const match = DECIMAL.exec(input);
  if (!match) {
    return Effect.fail(
      new InvalidAmountError({
        message: input.startsWith('-')
          ? `Amount must be greater than zero (got "${raw}").`
          : `Invalid amount "${raw}". Expected a positive decimal number such as 10 or 2.50.`,
      }),
    );
  }
  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? match[3] ?? '').replace(/0+$/, '');
  if (fraction.length > decimals) {
    return Effect.fail(
      new InvalidAmountError({
        message: `Amount "${raw}" has too many decimal places for ${symbol} (max ${decimals}).`,
      }),
    );
  }
  if (whole === '0' && fraction === '') {
    return Effect.fail(new InvalidAmountError({ message: `Amount must be greater than zero (got "${raw}").` }));
  }
  return Effect.succeed(fraction === '' ? whole : `${whole}.${fraction}`);
};

/** `fast request`'s own value-taking options, whose values are not operands. */
const REQUEST_VALUE_FLAGS = ['--to', '--qr-file', '--timeout'];

/**
 * Explain a `fast request` command line the parser rejected, when argv shows the
 * real mistake. A negative whole amount (`fast request -5`) looks like an unknown
 * option to the parser and never reaches the handler, so it is reported here as
 * the same INVALID_AMOUNT the handler gives `0` or `-0.5`; a missing amount gets
 * a usage hint. Undefined when argv does have an amount, so the parser's own
 * message stands.
 */
export const diagnoseRequestArgv = (argv: readonly string[]): InvalidAmountError | string | undefined => {
  const { operands, negativeNumbers } = tokenizeArgv(argv, REQUEST_VALUE_FLAGS);
  if (operands.length >= 2) return undefined; // `request <amount>`
  const negative = negativeNumbers[0];
  return negative === undefined
    ? 'Missing required argument: <amount>'
    : new InvalidAmountError({ message: `Amount must be greater than zero (got "${negative}").` });
};

/** Accept only a well-formed Fast address: bech32m, `fast` prefix, 32-byte payload. */
export const parseFastAddress = (raw: string): Effect.Effect<string, InvalidAddressError> =>
  Effect.try({
    try: () => {
      const input = raw.trim();
      const decoded = bech32m.decode(input);
      if (decoded.prefix !== 'fast') throw new Error('unexpected address prefix');
      if (bech32m.fromWords(decoded.words).length !== 32) throw new Error('unexpected address length');
      return input.toLowerCase();
    },
    catch: () =>
      new InvalidAddressError({
        message: `Invalid --to "${raw}". Expected a Fast address (fast1…) or a Fast ID name such as alice.smith.`,
      }),
  });

interface Payee {
  readonly address: string;
  /** Canonical Fast ID name when the payee was given as one. */
  readonly name?: string;
  readonly ownAccount: boolean;
}

/**
 * `--to` as a fast1… address, or a Fast ID name resolved on the network's
 * registry (fails closed: an unregistered name or an unreadable registry stops
 * the command before a link exists). Without `--to`, the active account.
 */
const resolvePayee = (to: string | undefined, networkId: string | undefined) =>
  Effect.gen(function* () {
    if (to !== undefined) {
      const name = fastIdRecipient(to);
      if (name === undefined) {
        const payee: Payee = { address: yield* parseFastAddress(to), ownAccount: false };
        return payee;
      }
      if (networkId !== 'fast:mainnet' && networkId !== 'fast:testnet') {
        return yield* Effect.fail(
          new InvalidUsageError({ message: `Fast ID names can only be resolved on mainnet or testnet; use the payee's fast1… address.` }),
        );
      }
      const fastIds = yield* FastIdResolver;
      const resolved = yield* fastIds.resolve(name, networkId);
      const payee: Payee = { address: resolved.address, name: resolved.name, ownAccount: false };
      return payee;
    }
    const accounts = yield* AccountStore;
    const config = yield* ClientConfig;
    const account = yield* accounts.resolveAccount(config.account);
    if (account.kind === 'multisig') {
      yield* ensureMultisigNetwork(account, config.network);
    }
    const payee: Payee = { address: account.fastAddress, ownAccount: true };
    return payee;
  });

const resolveQrFilePath = (file: string) =>
  path.extname(file).toLowerCase() === '.svg'
    ? Effect.succeed(path.resolve(file))
    : Effect.fail(new InvalidUsageError({ message: `--qr-file writes an SVG image; use a path ending in .svg (got "${file}").` }));

const renderQr = (url: string, options: QRCode.QRCodeToStringOptions) =>
  Effect.tryPromise({
    try: () => QRCode.toString(url, options),
    catch: (cause) => new InternalError({ message: 'Failed to render the QR code', cause }),
  });

/** The terminal renderer ends with a line holding only color codes; drop trailing lines with nothing drawn. */
const trimTrailingBlankLines = (text: string): string => {
  const lines = text.split('\n');
  while (lines.length > 0 && !/[▀▄█]/.test(lines[lines.length - 1]!)) lines.pop();
  return lines.join('\n');
};

const writeQrSvg = (file: string, url: string) =>
  Effect.gen(function* () {
    const svg = yield* renderQr(url, { type: 'svg', margin: 4, width: 512 });
    yield* Effect.try({
      try: () => writeFileSync(file, svg),
      catch: (cause) => new FileIOError({ message: `Failed to write QR code to "${file}"`, cause }),
    });
  });

export const request: Command<RequestArgs> = {
  cmd: 'request',
  handler: (args) =>
    Effect.gen(function* () {
      const output = yield* Output;
      const config = yield* ClientConfig;
      const networkConfig = yield* NetworkConfigService;

      // Taken before the link exists, so it is a safe lower bound for
      // "payments received since this request", even if the payer acts at once.
      const createdAt = new Date(yield* Clock.currentTimeMillis).toISOString();

      const qrFile = args.qrFile === undefined ? undefined : yield* resolveQrFilePath(args.qrFile);

      if (args.timeout !== undefined && !args.wait) {
        return yield* Effect.fail(new InvalidUsageError({ message: '--timeout only applies with --wait.' }));
      }
      const timeoutSeconds = yield* validateWaitTimeoutSeconds(args.timeout ?? DEFAULT_WAIT_TIMEOUT_SECONDS);

      if (config.network !== REQUEST_NETWORK) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message:
              `Payment-request links open the Fast app (app.fast.xyz), which is mainnet only. ` +
              `Current network: ${config.network}. Re-run with --network mainnet.`,
          }),
        );
      }

      const network = yield* networkConfig.resolve(config.network);
      const token = network.defaultToken;
      if (token === undefined) {
        return yield* Effect.fail(new InvalidUsageError({ message: `Network "${config.network}" has no default token configured.` }));
      }

      if (args.wait && !network.explorerApiUrl) {
        return yield* Effect.fail(new ExplorerNotConfiguredError({ network: config.network }));
      }

      const amount = yield* normalizeRequestAmount(args.amount, token.decimals, token.symbol);
      const payee = yield* resolvePayee(args.to, network.networkId);
      const payeeLabel = payee.name === undefined ? payee.address : `${payee.name} (${payee.address})`;

      // A Fast ID payee goes into the link as the name, as the app's own links do:
      // the payer sees the name, and the app resolves it again when they send.
      const paymentRequest: PaymentRequest = {
        url: buildPaymentRequestUrl(payee.name ?? payee.address, amount),
        address: payee.address,
        ...(payee.name === undefined ? {} : { toName: payee.name }),
        amount,
        token: token.symbol,
        network: config.network,
        createdAt,
      };

      if (qrFile !== undefined) {
        yield* writeQrSvg(qrFile, paymentRequest.url);
      }
      const terminalQr = args.qr ? trimTrailingBlankLines(yield* renderQr(paymentRequest.url, { type: 'terminal', small: true })) : undefined;

      yield* output.humanLine(`Payment request: ${amount} ${token.symbol} to ${payeeLabel} (${config.network}).`);
      yield* output.humanLine('Share this link with the payer. It opens the Fast app with the recipient and amount filled in:');
      yield* output.humanLine('');
      yield* output.humanLine(`  ${paymentRequest.url}`);
      yield* output.humanLine('');
      if (terminalQr !== undefined) {
        // stdout carries the JSON envelope in --json mode, so the QR goes to stderr there.
        yield* config.json ? Effect.sync(() => void process.stderr.write(`${terminalQr}\n`)) : output.humanLine(terminalQr);
        yield* output.humanLine('');
      }
      if (qrFile !== undefined) {
        yield* output.humanLine(`QR code (SVG) written to ${qrFile}`);
      }
      yield* output.humanLine('Nothing has been paid yet: the payer still has to open the link and confirm the transfer.');

      const result = qrFile === undefined ? paymentRequest : { ...paymentRequest, qrFile };

      if (!args.wait) {
        if (payee.ownAccount) {
          const accountFlag = Option.match(config.account, { onNone: () => '', onSome: (name) => ` --account ${name}` });
          yield* output.humanLine(`Check that it arrived with: fast info balance --network ${config.network}${accountFlag}`);
        }
        yield* output.ok(result);
        return;
      }

      // --wait: watch the payee's incoming feed for exactly this amount, sent after
      // the request was created. On timeout the error repeats the link and createdAt,
      // because in --json mode the error envelope replaces the result that carried
      // them, and createdAt is the --since for waiting again with wait-for-payment.
      const amountRaw = yield* Effect.try({
        try: () => parsePositiveAmount(amount, token.decimals, token.symbol),
        catch: (e) => e as InvalidAmountError,
      });
      yield* output.humanLine('');
      yield* output.humanLine(`Waiting up to ${timeoutSeconds}s for the payment (Ctrl-C stops waiting; the link stays valid)...`);
      const payment = yield* waitForIncoming({
        address: payee.address,
        amountRaw,
        tokenId: token.tokenId,
        since: new Date(createdAt),
        timeoutMs: timeoutSeconds * 1000,
        description: `${amount} ${token.symbol} to ${payeeLabel} for the request ${paymentRequest.url} created ${createdAt}`,
      });

      const received = formatBaseUnits(payment.amount, token.decimals);
      yield* output.humanLine(`Paid: ${received} ${token.symbol} from ${payment.from}`);
      yield* output.humanLine(`  Transaction: ${payment.hash}`);
      yield* output.humanLine(`  Time:        ${payment.timestamp}`);
      yield* output.humanLine(`  Explorer:    ${payment.explorerUrl}`);
      yield* output.ok({
        ...result,
        payment: {
          hash: payment.hash,
          type: historyTypeOf(payment.type),
          from: payment.from,
          to: payment.to,
          amount: payment.amount.toString(),
          formatted: received,
          tokenName: token.symbol,
          tokenId: payment.tokenId,
          timestamp: payment.timestamp,
          explorerUrl: payment.explorerUrl,
        },
      });
    }),
};
