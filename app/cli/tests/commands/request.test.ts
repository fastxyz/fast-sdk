import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from '@optique/core/parser';
import { Signer } from '@fastxyz/sdk';
import { bech32, bech32m } from 'bech32';
import { Duration, Effect, Exit, Fiber, Layer, Option, TestClock, TestContext } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parser, type RequestArgs } from '../../src/cli.js';
import { commands } from '../../src/commands/index.js';
import {
  buildPaymentRequestUrl,
  diagnoseRequestArgv,
  normalizeRequestAmount,
  PAYMENT_REQUEST_BASE_URL,
  parseFastAddress,
  request,
} from '../../src/commands/request.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output, OutputLive } from '../../src/services/output.js';
import { type AccountInfo, AccountStore } from '../../src/services/storage/account.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';
import { FastIdResolutionError, InvalidAddressError, InvalidAmountError } from '../../src/errors/index.js';
import { FastIdResolver } from '../../src/services/api/fast-id.js';
import { FASTUSD_ID, hashOf, LEO, mainnet, mockExplorer, page, rawTransfer, transfersFor } from '../fixtures/explorer.js';

const seed = (value: number) => new Uint8Array(32).fill(value);
const fastAddressOf = (value: number) => new Signer(seed(value)).getFastAddress();

const singleAccount = async (): Promise<AccountInfo> => ({
  kind: 'single',
  name: 'agent',
  fastAddress: await fastAddressOf(1),
  evmAddress: '0x0000000000000000000000000000000000000000',
  isDefault: true,
  encrypted: false,
  createdAt: new Date(0).toISOString(),
});

const multisigAccount = async (network: string): Promise<AccountInfo> => {
  const fastAddress = await fastAddressOf(9);
  return {
    kind: 'multisig',
    name: 'treasury',
    fastAddress,
    multisigConfig: {
      version: 1,
      name: 'treasury',
      signers: [await fastAddressOf(1), await fastAddressOf(2)],
      quorum: 2,
      configNonce: '0',
      fastAddress,
      network,
    },
    isDefault: true,
    createdAt: new Date(0).toISOString(),
  };
};

interface Harness {
  lines: string[];
  results: unknown[];
  accountLookups: Array<Option.Option<string>>;
}

const clientConfig = (opts: { network?: string; json?: boolean; account?: string }) =>
  Layer.succeed(ClientConfig, {
    json: opts.json ?? true,
    debug: false,
    nonInteractive: true,
    network: opts.network ?? 'mainnet',
    account: Option.fromNullable(opts.account),
    password: Option.none(),
  });

const serviceLayers = (h: Harness, account: AccountInfo | undefined) =>
  Layer.mergeAll(
    Layer.succeed(AccountStore, {
      resolveAccount: (name: Option.Option<string>) => {
        if (account === undefined) return Effect.die('the active account must not be looked up');
        return Effect.sync(() => (h.accountLookups.push(name), account));
      },
    } as never),
    Layer.succeed(NetworkConfigService, {
      resolve: (name: string) => Effect.succeed(bundledNetworks[name]!),
    } as never),
  );

const setup = (opts: { network?: string; json?: boolean; account?: AccountInfo; accountName?: string } = {}) => {
  const h: Harness = { lines: [], results: [], accountLookups: [] };
  const layer = Layer.mergeAll(
    serviceLayers(h, opts.account),
    clientConfig({ network: opts.network, json: opts.json, account: opts.accountName }),
    Layer.succeed(Output, {
      humanLine: (line: string) => Effect.sync(() => void h.lines.push(line)),
      ok: (data: unknown) => Effect.sync(() => void h.results.push(data)),
      fail: () => Effect.void,
      humanTable: () => Effect.void,
      debug: () => Effect.void,
    }),
  );
  const run = (args: Partial<RequestArgs>) =>
    Effect.runPromiseExit(request.handler({ cmd: 'request', amount: '10', qr: false, ...args } as RequestArgs).pipe(Effect.provide(layer)));
  return { h, run };
};

/** Run the handler against the real Output service, capturing what reaches stdout and stderr. */
const runWithRealOutput = async (json: boolean, account: AccountInfo, args: Partial<RequestArgs>) => {
  const h: Harness = { lines: [], results: [], accountLookups: [] };
  const config = clientConfig({ json });
  const layer = Layer.mergeAll(serviceLayers(h, account), config, OutputLive.pipe(Layer.provide(config)));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (stdout.push(String(chunk)), true));
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (stderr.push(String(chunk)), true));
  try {
    const exit = await Effect.runPromiseExit(
      request.handler({ cmd: 'request', amount: '10', qr: false, ...args } as RequestArgs).pipe(Effect.provide(layer)),
    );
    return { exit, stdout: stdout.join(''), stderr: stderr.join('') };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
};

const failureOf = (exit: Exit.Exit<void, unknown>) => {
  if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected a typed failure');
  return exit.cause.error as { errorCode: string; message: string };
};

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'fast-request-'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildPaymentRequestUrl', () => {
  it('points the Fast app Send screen at the recipient and amount', () => {
    expect(PAYMENT_REQUEST_BASE_URL).toBe('https://app.fast.xyz/send');
    expect(buildPaymentRequestUrl('fast1abc', '10')).toBe('https://app.fast.xyz/send?to=fast1abc&amount=10');
    expect(buildPaymentRequestUrl('fast1abc', '0.000001')).toBe('https://app.fast.xyz/send?to=fast1abc&amount=0.000001');
  });

  it('URL-encodes both parameters', () => {
    const url = buildPaymentRequestUrl('fast1a&b=c d', '1#2');
    expect(url).toBe('https://app.fast.xyz/send?to=fast1a%26b%3Dc+d&amount=1%232');
    const params = new URL(url).searchParams;
    expect(params.get('to')).toBe('fast1a&b=c d');
    expect(params.get('amount')).toBe('1#2');
  });
});

describe('normalizeRequestAmount', () => {
  const normalize = (raw: string) => Effect.runSync(Effect.either(normalizeRequestAmount(raw, 6, 'fastUSD')));

  it.each([
    ['10', '10'],
    ['10.5', '10.5'],
    ['10.50', '10.5'],
    ['010', '10'],
    ['0.5', '0.5'],
    ['.5', '0.5'],
    ['1.000000', '1'],
    ['1.0000000', '1'],
    ['0.000001', '0.000001'],
    [' 2.25 ', '2.25'],
    ['123456789012345678901234567890', '123456789012345678901234567890'],
  ])('accepts %j as %j', (raw, expected) => {
    const result = normalize(raw);
    if (result._tag !== 'Right') throw new Error(`expected "${raw}" to be accepted: ${result.left.message}`);
    expect(result.right).toBe(expected);
  });

  it.each([
    ['0', /greater than zero/],
    ['0.0', /greater than zero/],
    ['000', /greater than zero/],
    ['-1', /greater than zero/],
    ['-0.5', /greater than zero/],
    ['1.1234567', /too many decimal places for fastUSD \(max 6\)/],
    ['0.0000001', /too many decimal places/],
    ['abc', /Invalid amount "abc"/],
    ['1e3', /Invalid amount/],
    ['1,5', /Invalid amount/],
    ['10.', /Invalid amount/],
    ['.', /Invalid amount/],
    ['', /Invalid amount/],
    ['$10', /Invalid amount/],
    ['Infinity', /Invalid amount/],
  ])('rejects %j', (raw, message) => {
    const result = normalize(raw);
    if (result._tag !== 'Left') throw new Error(`expected "${raw}" to be rejected`);
    expect(result.left.errorCode).toBe('INVALID_AMOUNT');
    expect(result.left.message).toMatch(message);
  });
});

describe('parseFastAddress', () => {
  const parseAddress = (raw: string) => Effect.runSync(Effect.either(parseFastAddress(raw)));

  it('accepts a bech32m fast address with a 32-byte payload', async () => {
    const address = await fastAddressOf(3);
    for (const input of [address, address.toUpperCase(), ` ${address} `]) {
      const result = parseAddress(input);
      if (result._tag !== 'Right') throw new Error(`expected "${input}" to be accepted`);
      expect(result.right).toBe(address);
    }
  });

  it.each([
    ['truncated', 'fast1abc'],
    ['EVM address', '0x1234567890123456789012345678901234567890'],
    ['Fast ID name', 'alice.smith'],
    ['wrong prefix', bech32m.encode('tfast', bech32m.toWords(seed(4)))],
    ['wrong payload length', bech32m.encode('fast', bech32m.toWords(new Uint8Array(20)))],
    ['bech32 (not bech32m) checksum', bech32.encode('fast', bech32.toWords(seed(4)))],
  ])('rejects a %s', (_label, raw) => {
    const result = parseAddress(raw);
    if (result._tag !== 'Left') throw new Error(`expected "${raw}" to be rejected`);
    expect(result.left.errorCode).toBe('INVALID_ADDRESS');
  });

  it('names both accepted forms in the error', () => {
    const result = parseAddress('alice');
    if (result._tag !== 'Left') throw new Error('expected a failure');
    expect(result.left.message).toContain('Expected a Fast address (fast1…) or a Fast ID name such as alice.smith.');
  });
});

describe('fast request', () => {
  it('defaults --to to the active account and returns the documented JSON shape', async () => {
    const account = await singleAccount();
    const { h, run } = setup({ account });
    const before = Date.now();
    const exit = await run({ amount: '10.50' });
    const after = Date.now();

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(h.accountLookups).toEqual([Option.none()]);
    expect(h.results).toHaveLength(1);
    const data = h.results[0] as Record<string, string>;
    expect(Object.keys(data).sort()).toEqual(['address', 'amount', 'createdAt', 'network', 'token', 'url']);
    expect(data).toMatchObject({
      url: `https://app.fast.xyz/send?to=${account.fastAddress}&amount=10.5`,
      address: account.fastAddress,
      amount: '10.5',
      token: 'fastUSD',
      network: 'mainnet',
    });
    expect(new Date(data.createdAt!).toISOString()).toBe(data.createdAt);
    expect(Date.parse(data.createdAt!)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(data.createdAt!)).toBeLessThanOrEqual(after);
  });

  it('uses the --account override to pick the default payee', async () => {
    const account = await singleAccount();
    const { h, run } = setup({ account, accountName: 'agent', json: false });
    expect(Exit.isSuccess(await run({}))).toBe(true);
    expect(h.accountLookups).toEqual([Option.some('agent')]);
    expect(h.lines).toContain('Check that it arrived with: fast info balance --network mainnet --account agent');
  });

  it('prints the link and a verification hint in human mode', async () => {
    const account = await singleAccount();
    const { h, run } = setup({ account, json: false });
    expect(Exit.isSuccess(await run({ amount: '25' }))).toBe(true);
    const url = `https://app.fast.xyz/send?to=${account.fastAddress}&amount=25`;
    expect(h.lines).toContain(`  ${url}`);
    expect(h.lines.join('\n')).toContain('Share this link with the payer');
    expect(h.lines.join('\n')).toContain('Nothing has been paid yet');
    expect(h.lines).toContain('Check that it arrived with: fast info balance --network mainnet');
  });

  it('uses an explicit --to without touching local accounts', async () => {
    const payee = await fastAddressOf(5);
    const { h, run } = setup({ account: undefined, json: false });
    const exit = await run({ to: payee, amount: '3' });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((h.results[0] as { address: string; url: string }).address).toBe(payee);
    expect((h.results[0] as { url: string }).url).toBe(`https://app.fast.xyz/send?to=${payee}&amount=3`);
    // The balance hint only makes sense for the caller's own account.
    expect(h.lines.some((line) => line.includes('fast info balance'))).toBe(false);
  });

  it('rejects an invalid explicit --to with INVALID_ADDRESS', async () => {
    const { h, run } = setup({ account: undefined });
    const error = failureOf(await run({ to: 'fast1notreal' }));
    expect(error.errorCode).toBe('INVALID_ADDRESS');
    expect(h.results).toEqual([]);
  });

  it.each([
    ['0', /greater than zero/],
    ['-5', /greater than zero/],
    ['1.1234567', /too many decimal places for fastUSD \(max 6\)/],
    ['ten', /Invalid amount "ten"/],
  ])('rejects amount %j with INVALID_AMOUNT', async (amount, message) => {
    const { h, run } = setup({ account: await singleAccount() });
    const error = failureOf(await run({ amount }));
    expect(error.errorCode).toBe('INVALID_AMOUNT');
    expect(error.message).toMatch(message);
    expect(h.results).toEqual([]);
  });

  it.each(['testnet', 'devnet'])('rejects the %s network with INVALID_USAGE', async (network) => {
    const { h, run } = setup({ account: await singleAccount(), network });
    const error = failureOf(await run({}));
    expect(error.errorCode).toBe('INVALID_USAGE');
    expect(error.message).toContain('--network mainnet');
    expect(error.message).toContain(`Current network: ${network}`);
    expect(h.accountLookups).toEqual([]);
    expect(h.results).toEqual([]);
  });

  it("defaults --to to a mainnet multisig wallet's address", async () => {
    const account = await multisigAccount('mainnet');
    const { h, run } = setup({ account });
    expect(Exit.isSuccess(await run({}))).toBe(true);
    expect((h.results[0] as { address: string }).address).toBe(account.fastAddress);
  });

  it('rejects a default multisig wallet that belongs to another network', async () => {
    const { h, run } = setup({ account: await multisigAccount('testnet') });
    const error = failureOf(await run({}));
    expect(error.errorCode).toBe('WALLET_NETWORK_MISMATCH');
    expect(h.results).toEqual([]);
  });

  it('--qr-file writes an SVG QR code and reports its absolute path', async () => {
    const file = path.join(tempDir(), 'request.svg');
    const { h, run } = setup({ account: await singleAccount() });
    // A relative path is resolved against the working directory.
    expect(Exit.isSuccess(await run({ qrFile: path.relative(process.cwd(), file) }))).toBe(true);

    const data = h.results[0] as { qrFile: string };
    expect(data.qrFile).toBe(file);
    const svg = readFileSync(file, 'utf8');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg).toMatch(/<path [^>]*d="M[^"]+"\/>/);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('--qr-file overwrites an existing file and mentions it in human mode', async () => {
    const file = path.join(tempDir(), 'request.svg');
    const { h, run } = setup({ account: await singleAccount(), json: false });
    expect(Exit.isSuccess(await run({ qrFile: file }))).toBe(true);
    expect(Exit.isSuccess(await run({ qrFile: file, amount: '11' }))).toBe(true);
    expect(h.lines).toContain(`QR code (SVG) written to ${file}`);
  });

  it('--qr-file rejects a non-.svg path before writing anything', async () => {
    const file = path.join(tempDir(), 'request.png');
    const { h, run } = setup({ account: await singleAccount() });
    const error = failureOf(await run({ qrFile: file }));
    expect(error.errorCode).toBe('INVALID_USAGE');
    expect(existsSync(file)).toBe(false);
    expect(h.results).toEqual([]);
  });

  it('--qr-file reports FILE_IO_ERROR when the file cannot be written', async () => {
    const file = path.join(tempDir(), 'missing-dir', 'request.svg');
    const { h, run } = setup({ account: await singleAccount() });
    const error = failureOf(await run({ qrFile: file }));
    expect(error.errorCode).toBe('FILE_IO_ERROR');
    expect(h.results).toEqual([]);
  });

  it('--qr keeps stdout a single JSON document in --json mode (the QR goes to stderr)', async () => {
    const account = await singleAccount();
    const { exit, stdout, stderr } = await runWithRealOutput(true, account, { qr: true });
    expect(Exit.isSuccess(exit)).toBe(true);
    const parsed = JSON.parse(stdout) as { ok: boolean; data: Record<string, string> };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.url).toBe(`https://app.fast.xyz/send?to=${account.fastAddress}&amount=10`);
    expect(stdout).not.toMatch(/[▀▄█]/);
    expect(stderr).toMatch(/[▀▄█]/);
  });

  it('--qr prints a terminal QR code on stdout in human mode', async () => {
    const account = await singleAccount();
    const { exit, stdout, stderr } = await runWithRealOutput(false, account, { qr: true });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(stdout).toContain(`https://app.fast.xyz/send?to=${account.fastAddress}&amount=10`);
    expect(stdout).toMatch(/[▀▄█]/);
    expect(stderr).toBe('');
  });
});

describe('fast request registration', () => {
  it('parses `request <amount>` with its options', async () => {
    const payee = await fastAddressOf(6);
    const result = parse(parser, ['request', '10', '--to', payee, '--qr', '--qr-file', 'out.svg', '--network', 'mainnet']);
    if (!result.success) throw new Error('expected the request command to parse');
    expect(result.value).toMatchObject({ cmd: 'request', amount: '10', to: payee, qr: true, qrFile: 'out.svg', network: 'mainnet' });
  });

  it('defaults --qr to false and leaves --to and --qr-file unset', () => {
    const result = parse(parser, ['request', '5']);
    if (!result.success) throw new Error('expected the request command to parse');
    expect(result.value).toMatchObject({ cmd: 'request', amount: '5', qr: false });
    expect((result.value as { to?: string }).to).toBeUndefined();
    expect((result.value as { qrFile?: string }).qrFile).toBeUndefined();
  });

  it('is dispatched to the request handler', () => {
    expect(commands.find((c) => c.cmd === 'request')).toBe(request);
  });
});

describe('diagnoseRequestArgv (command lines the parser rejects)', () => {
  it('reports a negative whole amount, which the parser reads as an unknown option, as INVALID_AMOUNT', () => {
    // (`-0.5` does parse as <amount>, and the handler rejects it with the same message.)
    for (const argv of [
      ['request', '-5', '--json'],
      ['--network', 'mainnet', 'request', '-12'],
    ]) {
      expect(parse(parser, argv).success).toBe(false);
      const problem = diagnoseRequestArgv(argv);
      expect(problem).toBeInstanceOf(InvalidAmountError);
      expect(problem).toMatchObject({
        errorCode: 'INVALID_AMOUNT',
        message: `Amount must be greater than zero (got "${argv.find((a) => /^-\.?\d/.test(a))}").`,
      });
    }
  });

  it('skips global and request option values, so they are neither the command, the amount, nor a negative amount', () => {
    // `--timeout -3` and `--to -5` are option values the parser consumes, not a negative <amount>.
    for (const argv of [
      ['--network', 'mainnet', 'request'],
      ['--account', 'agent', '--password', 'pw', 'request', '--json'],
      ['request', '--to', 'alice.smith', '--qr-file', 'out.svg'],
      ['request', '--timeout', '-3', '--wait'],
      ['request', '--to', '-5'],
    ]) {
      expect(parse(parser, argv).success).toBe(false);
      expect(diagnoseRequestArgv(argv)).toBe('Missing required argument: <amount>');
    }
  });

  it('leaves the parser message alone when the amount is there', () => {
    expect(diagnoseRequestArgv(['--network', 'mainnet', 'request', '5', '--bogus'])).toBeUndefined();
  });

  it('does not mistake a negative token after an unknown option for the request amount', () => {
    for (const argv of [
      ['request', '--bogus', '-5'],
      ['request', '--bogus=1', '-5'],
      ['request', '-5', '--bogus'],
      ['request', '-x', '-5'],
    ]) {
      expect(parse(parser, argv).success).toBe(false);
      expect(diagnoseRequestArgv(argv)).toBeUndefined();
    }
  });
});

describe('fast request --wait', () => {
  const REQUESTED_AT = Date.parse('2026-10-02T03:00:00Z');
  const TEN_FASTUSD = (10_000_000).toString(16);

  const runWait = async (args: Partial<RequestArgs>, opts: { explorer: ReturnType<typeof mockExplorer>; advance?: Duration.DurationInput }) => {
    const account = await singleAccount();
    const h: Harness = { lines: [], results: [], accountLookups: [] };
    const layer = Layer.mergeAll(
      serviceLayers(h, account),
      clientConfig({ json: true }),
      opts.explorer.layer,
      Layer.succeed(Output, {
        humanLine: (line: string) => Effect.sync(() => void h.lines.push(line)),
        ok: (data: unknown) => Effect.sync(() => void h.results.push(data)),
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      } as never),
    );
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(REQUESTED_AT);
        const fiber = yield* Effect.fork(
          request.handler({ cmd: 'request', amount: '10', qr: false, wait: true, ...args } as RequestArgs).pipe(Effect.provide(layer)),
        );
        if (opts.advance !== undefined) yield* TestClock.adjust(opts.advance);
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    return { exit, h, account };
  };

  const paymentTo = (address: string, n: number, iso: string, overrides: Record<string, unknown> = {}) =>
    transfersFor(
      address,
      [rawTransfer({ hash: hashOf(n), to: address, token_id: FASTUSD_ID, amount: TEN_FASTUSD, submission_timestamp: iso, ...overrides })],
      mainnet,
    )[0]!;

  it('prints the link, then returns it together with the matching payment', async () => {
    const payee = await fastAddressOf(1);
    const explorer = mockExplorer(() => Effect.succeed(page([paymentTo(payee, 1, '2026-10-02T03:00:04Z')])));

    const { exit, h } = await runWait({}, { explorer });

    expect(exit._tag).toBe('Success');
    expect(explorer.calls[0]).toMatchObject({ address: payee, side: 'to', order: 'desc' });
    const url = `https://app.fast.xyz/send?to=${payee}&amount=10`;
    expect(h.lines.some((line) => line.includes(url))).toBe(true);
    expect(h.results).toEqual([
      {
        url,
        address: payee,
        amount: '10',
        token: 'fastUSD',
        network: 'mainnet',
        createdAt: '2026-10-02T03:00:00.000Z',
        payment: {
          hash: hashOf(1),
          type: 'transfer',
          from: LEO,
          to: payee,
          amount: '10000000',
          formatted: '10',
          tokenName: 'fastUSD',
          tokenId: FASTUSD_ID,
          timestamp: '2026-10-02T03:00:04.000Z',
          explorerUrl: `https://explorer.fast.xyz/txs/${hashOf(1)}`,
        },
      },
    ]);
  });

  it('ignores payments from before the request and other amounts, and keeps polling', async () => {
    const payee = await fastAddressOf(1);
    const stale = paymentTo(payee, 1, '2026-10-02T02:59:59Z');
    const wrongAmount = paymentTo(payee, 2, '2026-10-02T03:00:01Z', { amount: (9_990_000).toString(16) });
    const good = paymentTo(payee, 3, '2026-10-02T03:00:02Z');
    const explorer = mockExplorer((_params, call) => Effect.succeed(page(call === 0 ? [wrongAmount, stale] : [good, wrongAmount, stale])));

    const { exit, h } = await runWait({}, { explorer, advance: Duration.seconds(2) });

    expect(exit._tag).toBe('Success');
    // Poll 1 sees only the stale and wrong-amount rows; poll 2 finds the payment and re-reads the window to confirm it.
    expect(explorer.calls.length).toBe(3);
    expect((h.results[0] as { payment: { hash: string } }).payment.hash).toBe(hashOf(3));
  });

  it('times out with PAYMENT_TIMEOUT and repeats the link and createdAt in the error', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([])));

    const { exit, h, account } = await runWait({ timeout: 30 }, { explorer, advance: Duration.seconds(30) });

    const error = failureOf(exit);
    expect(error.errorCode).toBe('PAYMENT_TIMEOUT');
    expect(error.message).toContain('within 30s');
    // createdAt is what `fast wait-for-payment --since` needs to keep waiting for this request.
    expect(error.message).toContain(`for the request https://app.fast.xyz/send?to=${account.fastAddress}&amount=10 created 2026-10-02T03:00:00.000Z`);
    expect(h.results).toEqual([]);
  });

  it('rejects --timeout without --wait, and a --timeout out of range, before building anything', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([])));

    const noWait = await runWait({ wait: false, timeout: 30 }, { explorer });
    const zero = await runWait({ timeout: 0 }, { explorer });
    // One second past what the runtime timers support: Effect would never fire the timeout.
    const tooLong = await runWait({ timeout: 2_147_484 }, { explorer });

    expect(failureOf(noWait.exit)).toMatchObject({ errorCode: 'INVALID_USAGE', message: '--timeout only applies with --wait.' });
    const range = '--timeout must be a whole number of seconds from 1 to 2147483 (about 24 days).';
    expect(failureOf(zero.exit)).toMatchObject({ errorCode: 'INVALID_USAGE', message: range });
    expect(failureOf(tooLong.exit)).toMatchObject({ errorCode: 'INVALID_USAGE', message: range });
    expect(explorer.calls).toEqual([]);
    expect([noWait, zero, tooLong].flatMap(({ h }) => h.results)).toEqual([]);
  });

  it('accepts the longest supported --timeout', async () => {
    const payee = await fastAddressOf(1);
    const explorer = mockExplorer(() => Effect.succeed(page([paymentTo(payee, 1, '2026-10-02T03:00:04Z')])));

    const { exit, h } = await runWait({ timeout: 2_147_483 }, { explorer });

    expect(exit._tag).toBe('Success');
    expect((h.results[0] as { payment: { hash: string } }).payment.hash).toBe(hashOf(1));
  });
});

describe('fast request --to <Fast ID>', () => {
  const runWithName = async (
    args: Partial<RequestArgs>,
    resolve: (name: string, network: string) => Effect.Effect<{ name: string; address: string }, unknown>,
    opts: { json?: boolean; network?: string } = {},
  ) => {
    const h: Harness = { lines: [], results: [], accountLookups: [] };
    const resolveCalls: Array<[string, string]> = [];
    const layer = Layer.mergeAll(
      serviceLayers(h, undefined),
      clientConfig({ json: opts.json, network: opts.network }),
      Layer.succeed(FastIdResolver, {
        resolve: (name: string, network: string) => {
          resolveCalls.push([name, network]);
          return resolve(name, network);
        },
      } as never),
      Layer.succeed(Output, {
        humanLine: (line: string) => Effect.sync(() => void h.lines.push(line)),
        ok: (data: unknown) => Effect.sync(() => void h.results.push(data)),
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      }),
    );
    const exit = await Effect.runPromiseExit(
      request.handler({ cmd: 'request', amount: '10', qr: false, ...args } as RequestArgs).pipe(Effect.provide(layer)),
    );
    return { exit, h, resolveCalls };
  };

  it('resolves the name on mainnet, keeps the name in the link and returns the bound address', async () => {
    const bound = await fastAddressOf(5);

    const { exit, h, resolveCalls } = await runWithName({ to: 'Alice.Smith' }, (name) => Effect.succeed({ name, address: bound }));

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(resolveCalls).toEqual([['alice.smith', 'fast:mainnet']]);
    expect(h.accountLookups).toEqual([]);
    expect(h.results).toEqual([
      expect.objectContaining({
        url: 'https://app.fast.xyz/send?to=alice.smith&amount=10',
        address: bound,
        toName: 'alice.smith',
        amount: '10',
      }),
    ]);
  });

  it('starts the payment window after Fast ID resolution, not when the command starts', async () => {
    const bound = await fastAddressOf(5);
    const h: Harness = { lines: [], results: [], accountLookups: [] };
    const beforeResolution = Date.parse('2026-10-02T03:00:00Z');
    const unrelated = transfersFor(
      bound,
      [
        rawTransfer({
          hash: hashOf(1),
          to: bound,
          token_id: FASTUSD_ID,
          amount: (10_000_000).toString(16),
          submission_timestamp: '2026-10-02T03:00:05Z',
        }),
      ],
      mainnet,
    )[0]!;
    const expected = transfersFor(
      bound,
      [
        rawTransfer({
          hash: hashOf(2),
          to: bound,
          token_id: FASTUSD_ID,
          amount: (10_000_000).toString(16),
          submission_timestamp: '2026-10-02T03:00:11Z',
        }),
      ],
      mainnet,
    )[0]!;
    const explorer = mockExplorer(() => Effect.succeed(page([expected, unrelated])));
    const layer = Layer.mergeAll(
      serviceLayers(h, undefined),
      clientConfig({ json: true }),
      explorer.layer,
      Layer.succeed(FastIdResolver, {
        resolve: () =>
          Effect.gen(function* () {
            yield* TestClock.adjust(Duration.seconds(10));
            return { name: 'alice.smith', address: bound };
          }),
      } as never),
      Layer.succeed(Output, {
        humanLine: (line: string) => Effect.sync(() => void h.lines.push(line)),
        ok: (data: unknown) => Effect.sync(() => void h.results.push(data)),
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      } as never),
    );

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(beforeResolution);
        return yield* Fiber.await(
          yield* Effect.fork(
            request.handler({ cmd: 'request', amount: '10', to: 'alice.smith', qr: false, wait: true } as RequestArgs).pipe(Effect.provide(layer)),
          ),
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(exit._tag).toBe('Success');
    expect(h.results).toEqual([
      expect.objectContaining({
        createdAt: '2026-10-02T03:00:10.000Z',
        payment: expect.objectContaining({ hash: hashOf(2) }),
      }),
    ]);
  });

  it('names both the Fast ID and the address in human output', async () => {
    const bound = await fastAddressOf(5);

    const { h } = await runWithName({ to: 'alice.smith' }, (name) => Effect.succeed({ name, address: bound }), { json: false });

    expect(h.lines).toContain(`Payment request: 10 fastUSD to alice.smith (${bound}) (mainnet).`);
    expect(h.lines).toContain('  https://app.fast.xyz/send?to=alice.smith&amount=10');
  });

  it('treats a valid name that starts like an address as a name', async () => {
    const bound = await fastAddressOf(5);

    const { resolveCalls } = await runWithName({ to: 'fast1alice.smith' }, (name) => Effect.succeed({ name, address: bound }));

    expect(resolveCalls).toEqual([['fast1alice.smith', 'fast:mainnet']]);
  });

  it('does not call the registry for a fast1 address', async () => {
    const address = await fastAddressOf(6);

    const { exit, h, resolveCalls } = await runWithName({ to: address }, () => Effect.die('must not resolve'));

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(resolveCalls).toEqual([]);
    expect(Object.keys(h.results[0] as object)).not.toContain('toName');
  });

  it('fails closed when the name is not registered or the registry cannot be read', async () => {
    const unregistered = await runWithName({ to: 'nobody.here' }, (name) =>
      Effect.fail(new InvalidAddressError({ message: `Fast ID "${name}" is not registered on fast:mainnet.` })),
    );
    const unreachable = await runWithName({ to: 'alice.smith' }, (name) =>
      Effect.fail(new FastIdResolutionError({ fastId: name, reason: 'request timed out' })),
    );

    expect(failureOf(unregistered.exit).errorCode).toBe('INVALID_ADDRESS');
    expect(failureOf(unreachable.exit).errorCode).toBe('FAST_ID_RESOLUTION_FAILED');
    expect(unregistered.h.results).toEqual([]);
    expect(unreachable.h.results).toEqual([]);
    expect(unreachable.h.lines).toEqual([]);
  });

  it('still rejects input that is neither an address nor a name', async () => {
    const { exit, resolveCalls } = await runWithName({ to: 'alice' }, () => Effect.die('must not resolve'));

    expect(failureOf(exit)).toMatchObject({ errorCode: 'INVALID_ADDRESS' });
    expect(resolveCalls).toEqual([]);
  });
});
