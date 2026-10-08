import { Effect, Layer } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import { pay } from '../../src/commands/pay.js';
import type { PayArgs } from '../../src/cli.js';
import { X402Service } from '../../src/services/api/x402.js';
import { Output } from '../../src/services/output.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { AccountStore } from '../../src/services/storage/account.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { Prompt } from '../../src/services/prompt.js';

afterEach(() => vi.unstubAllGlobals());

const nativeV2 = {
  x402Version: 2,
  resource: { url: 'https://example.com/paid' },
  accepts: [{ scheme: 'exact', network: 'eip155:84532', amount: '1000', asset: '0xabc', payTo: '0xdef', maxTimeoutSeconds: 60 }],
};
const legacyV1 = {
  x402Version: 1,
  accepts: [{ scheme: 'exact', network: 'arbitrum-sepolia', maxAmountRequired: '1000', asset: '0xabc', payTo: '0xdef', maxTimeoutSeconds: 60 }],
};

it.each([
  { label: 'native v2', requirements: nativeV2, header: true },
  { label: 'legacy v1', requirements: legacyV1, header: false },
  {
    label: 'legacy v1 with extra v2 amount',
    requirements: { ...legacyV1, accepts: legacyV1.accepts.map((opt) => ({ ...opt, amount: '999' })) },
    header: false,
  },
  {
    label: 'native v2 with extra v1 amount',
    requirements: { ...nativeV2, accepts: nativeV2.accepts.map((opt) => ({ ...opt, maxAmountRequired: '999' })) },
    header: true,
  },
])('dry-run prints $label amounts and preserves JSON without paying', async ({ requirements, header }) => {
  const res = header
    ? new Response('not JSON', { status: 402, headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(requirements)).toString('base64') } })
    : new Response(JSON.stringify(requirements), { status: 402 });
  const fetch = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetch);
  const lines: string[] = [];
  const results: unknown[] = [];
  const layer = Layer.mergeAll(
    X402Service.Default,
    Layer.succeed(Output, {
      humanLine: (line: string) => Effect.sync(() => void lines.push(line)),
      ok: (data: unknown) => Effect.sync(() => void results.push(data)),
    } as never),
    Layer.succeed(ClientConfig, { network: 'mainnet' } as never),
    Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed({ url: 'https://example.com' }) } as never),
    Layer.succeed(AccountStore, {} as never),
    Layer.succeed(HistoryStore, {} as never),
    Layer.succeed(Prompt, {} as never),
  );
  await Effect.runPromise(
    pay.handler({ url: 'https://example.com/paid', method: 'GET', header: [], dryRun: true } as PayArgs).pipe(Effect.provide(layer)),
  );
  expect(lines).toContain('  Amount:  1000');
  expect(results).toEqual([{ statusCode: 402, paymentRequired: requirements, acceptedOptions: requirements.accepts }]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(res.bodyUsed).toBe(!header);
});
