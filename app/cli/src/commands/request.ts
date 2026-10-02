import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { bech32m } from 'bech32';
import { Clock, Effect, Option } from 'effect';
import QRCode from 'qrcode';
import type { RequestArgs } from '../cli.js';
import { FileIOError, InternalError, InvalidAddressError, InvalidAmountError, InvalidUsageError } from '../errors/index.js';
import { ClientConfig } from '../services/config/client.js';
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

/** What `fast request --json` returns (plus `qrFile` when `--qr-file` is set). */
export interface PaymentRequest {
  readonly url: string;
  readonly address: string;
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
        message:
          `Invalid --to address "${raw}". Expected a Fast address (fast1…).` +
          (raw.includes('.') ? ' Fast ID names are not accepted here; pass the fast1… address instead.' : ''),
      }),
  });

const resolvePayee = (to: string | undefined) =>
  Effect.gen(function* () {
    if (to !== undefined) {
      return { address: yield* parseFastAddress(to), ownAccount: false };
    }
    const accounts = yield* AccountStore;
    const config = yield* ClientConfig;
    const account = yield* accounts.resolveAccount(config.account);
    if (account.kind === 'multisig') {
      yield* ensureMultisigNetwork(account, config.network);
    }
    return { address: account.fastAddress, ownAccount: true };
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

      const amount = yield* normalizeRequestAmount(args.amount, token.decimals, token.symbol);
      const payee = yield* resolvePayee(args.to);

      const paymentRequest: PaymentRequest = {
        url: buildPaymentRequestUrl(payee.address, amount),
        address: payee.address,
        amount,
        token: token.symbol,
        network: config.network,
        createdAt,
      };

      if (qrFile !== undefined) {
        yield* writeQrSvg(qrFile, paymentRequest.url);
      }
      const terminalQr = args.qr ? trimTrailingBlankLines(yield* renderQr(paymentRequest.url, { type: 'terminal', small: true })) : undefined;

      yield* output.humanLine(`Payment request: ${amount} ${token.symbol} to ${payee.address} (${config.network}).`);
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
      if (payee.ownAccount) {
        const accountFlag = Option.match(config.account, { onNone: () => '', onSome: (name) => ` --account ${name}` });
        yield* output.humanLine(`Check that it arrived with: fast info balance --network ${config.network}${accountFlag}`);
      }

      yield* output.ok(qrFile === undefined ? paymentRequest : { ...paymentRequest, qrFile });
    }),
};
