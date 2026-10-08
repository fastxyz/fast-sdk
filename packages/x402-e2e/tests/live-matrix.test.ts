/** Real mainnet money. Never loaded by the ordinary test configuration. */
import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { FastProvider, Signer, fromHex, toFastAddress, toHex } from '@fastxyz/sdk';
import { serializeVersionedTransactionDomain } from '@fastxyz/schema';
import { mainnet } from '@fastxyz/sdk/networks';
import { x402Pay as currentClient } from '@fastxyz/x402-client';
import { x402Pay as publishedClient } from '@fastxyz/x402-client-v1';
import { paymentMiddleware as currentServer } from '@fastxyz/x402-server';
import { paymentMiddleware as publishedServer } from '@fastxyz/x402-server-v1';
import { createFacilitatorServer } from '@fastxyz/x402-facilitator';
import { createPublicClient, erc20Abi, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { readLiveConfig, requireMatrixGate } from '../src/live-config.js';

const config = readLiveConfig(process.env);
let completed = 0;
// A gate invocation must fail even when the matrix suite would otherwise skip.
if (process.env.X402_MATRIX_GATE === '1' && !config) requireMatrixGate(process.env, completed);
const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const pairs = [
  ['1.0', '1.0', publishedClient, publishedServer],
  ['1.0', '1.1', publishedClient, currentServer],
  ['1.1', '1.0', currentClient, publishedServer],
  ['1.1', '1.1', currentClient, currentServer],
] as const;

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Missing loopback address'));
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
    server.on('error', reject);
  });
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe.skipIf(!config).sequential('published 1.0 × candidate 1.1 live compatibility', () => {
  afterAll(() => requireMatrixGate(process.env, completed));
  // Networks and pairs deliberately sequential: no competing Fast payer nonces.
  for (const network of ['fast-mainnet', 'base'] as const) {
    for (const [clientVersion, serverVersion, pay, middleware] of pairs) {
      it(`${network}: client ${clientVersion} / server ${serverVersion}`, async () => {
        const cfg = config!;
        const isFast = network === 'fast-mainnet';
        const provider = new FastProvider(mainnet);
        const fastPayerPub = await new Signer(cfg.fastPayerKey).getPublicKey();
        const fastRecipientPub = await new Signer(cfg.fastRecipientKey).getPublicKey();
        const payer = privateKeyToAccount(cfg.evmPayerKey);
        const recipient = privateKeyToAccount(cfg.evmRecipientKey);
        const facilitator = privateKeyToAccount(cfg.evmFacilitatorKey);
        expect(toFastAddress(fastRecipientPub)).not.toBe(toFastAddress(fastPayerPub));
        expect(recipient.address.toLowerCase()).not.toBe(payer.address.toLowerCase());
        expect(facilitator.address.toLowerCase()).not.toBe(payer.address.toLowerCase());
        const evm = createPublicClient({ chain: base, transport: http(cfg.evmRpcUrl, { retryCount: 0 }) });
        // Verify the remote chain and a bounded, separately provisioned gas wallet BEFORE any payment.
        expect(await evm.getChainId()).toBe(8453);
        const gasBalance = await evm.getBalance({ address: facilitator.address });
        expect(gasBalance).toBeGreaterThan(0n);
        expect(gasBalance).toBeLessThanOrEqual(cfg.maxFacilitatorEthWei);
        expect(await evm.readContract({ address: usdc, abi: erc20Abi, functionName: 'decimals' })).toBe(6);
        const asset = isFast ? mainnet.defaultToken.tokenId : usdc;
        const payTo = isFast ? toFastAddress(fastRecipientPub) : recipient.address;
        const fastBalance = async () => {
          const account = await provider.getAccountInfo({ address: fastRecipientPub, tokenBalancesFilter: [fromHex(asset)] });
          return account.tokenBalance.find(([id]) => toHex(id).replace(/^0x/, '') === asset.replace(/^0x/, ''))?.[1] ?? 0n;
        };
        const balance = () =>
          isFast ? fastBalance() : evm.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [recipient.address] });
        if (isFast) {
          const metadata = await provider.getTokenInfo({ tokenIds: [fromHex(asset)] });
          expect(metadata.requestedTokenMetadata[0]?.[1]?.decimals).toBe(6);
        }
        // Pin Base reads to an explicit block; latest may lag a mined receipt.
        const beforeBlock = isFast ? undefined : await evm.getBlockNumber({ cacheTime: 0 });
        const before = isFast ? await balance() : await evm.readContract({
          address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [recipient.address], blockNumber: beforeBlock,
        });
        const nonce = isFast ? (await provider.getAccountInfo({ address: fastPayerPub })).nextNonce : null;
        const app = express();
        app.use(express.json());
        app.use(
          createFacilitatorServer({
            debug: false,
            // Compatibility gate trusts the pinned official mainnet RPC, not a
            // separately provisioned committee. The mandatory certificate/hash
            // and balance checks below must succeed before this case is counted.
            fastNetworks: { 'fast-mainnet': { rpcUrl: cfg.fastRpcUrl, committeePublicKeys: [] } },
            evmPrivateKey: cfg.evmFacilitatorKey,
            evmChains: { base: { chain: base, rpcUrl: cfg.evmRpcUrl, usdcAddress: usdc, usdcName: 'USD Coin', usdcVersion: '2' } },
          }),
        );
        const fac = await listen(app);
        let content: Awaited<ReturnType<typeof listen>> | undefined;
        try {
          const paidHeaders: Array<{ legacy?: string; signature?: string }> = [];
          const contentApp = express();
          contentApp.use((req, _res, next) => {
            const legacy = req.get('X-PAYMENT');
            const signature = req.get('PAYMENT-SIGNATURE');
            if (legacy || signature) paidHeaders.push({ legacy, signature });
            next();
          });
          contentApp.use(
            middleware(
              { fast: payTo, evm: payTo },
              {
                'GET /premium': { price: '$0.001', network, networkConfig: { asset, decimals: 6, ...(isFast ? {} : { extra: { name: 'USD Coin', version: '2' } }) } },
              },
              { url: fac.url },
              { debug: false },
            ),
          );
          contentApp.get('/premium', (_req, res) => {
            // Published 1.0 EVM clients read settlement hashes from content,
            // not receipt headers. Echo the real middleware receipt, never a
            // made-up hash, so their reported hash can be confirmed on-chain.
            const receiptHeader = res.getHeader('X-PAYMENT-RESPONSE');
            const receipt = receiptHeader ? JSON.parse(Buffer.from(String(receiptHeader), 'base64').toString()) : undefined;
            res.json({ message: 'paid matrix content', ...(isFast ? {} : { txHash: receipt?.txHash }) });
          });
          content = await listen(contentApp);
          const url = `${content.url}/premium`;
          const unpaid = await fetch(url);
          expect(unpaid.status).toBe(402);
          const legacy = (await unpaid.json()) as { accepts: Array<{ network: string; maxAmountRequired: string; asset: string; payTo: string }> };
          expect(legacy.accepts[0]).toMatchObject({ network, maxAmountRequired: '1000', asset, payTo });
          const required = unpaid.headers.get('PAYMENT-REQUIRED');
          if (serverVersion === '1.1') {
            expect(required).toBeTruthy();
            expect(JSON.parse(Buffer.from(required!, 'base64').toString()).x402Version).toBe(2);
          } else expect(required).toBeNull();
          const wallet = isFast
            ? {
                type: 'fast' as const,
                privateKey: cfg.fastPayerKey,
                publicKey: toHex(fastPayerPub),
                address: toFastAddress(fastPayerPub),
                rpcUrl: cfg.fastRpcUrl,
              }
            : { type: 'evm' as const, privateKey: cfg.evmPayerKey, address: payer.address };
          // Exactly one call, no bridge configuration, no harness retries.
          const result = await pay({
            url,
            wallet,
            verbose: false,
            evmNetworks: {
              base: { chainId: 8453, rpcUrl: cfg.evmRpcUrl, usdcAddress: usdc, usdcName: 'USD Coin', usdcVersion: '2' },
            },
          });
          expect(result.success).toBe(true);
          expect(result.statusCode).toBe(200);
          expect(result.body).toMatchObject({ message: 'paid matrix content' });
          if (!isFast) expect(result.body).toMatchObject({ txHash: result.payment?.txHash });
          expect(result.payment).toMatchObject({ network, recipient: payTo, asset, amount: isFast ? '1000' : '0.001' });
          expect(result.payment!.txHash).toMatch(/^(?:0x)?[a-fA-F0-9]{64}$/);
          expect(paidHeaders).toHaveLength(1);
          if (clientVersion === '1.1' && serverVersion === '1.1') {
            expect(paidHeaders[0].signature).toBeTruthy();
            expect(paidHeaders[0].legacy).toBeUndefined();
          } else {
            expect(paidHeaders[0].legacy).toBeTruthy();
            expect(paidHeaders[0].signature).toBeUndefined();
          }
          if (isFast) {
            const certificates = await provider.getTransactionCertificates({ address: fastPayerPub, fromNonce: nonce!, limit: 1 });
            expect(certificates).toHaveLength(1);
            expect(certificates[0].signatures.length).toBeGreaterThanOrEqual(3);
            // The independently fetched certificate must be the one sent in the actual paid header.
            const sent = JSON.parse(Buffer.from(paidHeaders[0].signature ?? paidHeaders[0].legacy!, 'base64').toString());
            const transaction = certificates[0].envelope.transaction;
            expect(toHex(transaction.value.sender)).toBe(toHex(fastPayerPub));
            expect(transaction.value.nonce).toBe(nonce);
            expect(String(transaction.value.nonce)).toBe(String(sent.payload.transactionCertificate.envelope.transaction.value.nonce));
            const independentlyConfirmedHash = keccak256(serializeVersionedTransactionDomain(transaction));
            expect(result.payment!.txHash.replace(/^0x/, '')).toBe(independentlyConfirmedHash.replace(/^0x/, ''));
            expect((await balance()) - before).toBe(1000n);
          } else {
            const receipt = await evm.waitForTransactionReceipt({ hash: result.payment!.txHash as `0x${string}`, timeout: 60_000 });
            expect(receipt.status).toBe('success');
            const after = await evm.readContract({
              address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [recipient.address], blockNumber: receipt.blockNumber,
            });
            expect(after - before).toBe(1000n);
          }
          console.info(JSON.stringify({ network, clientVersion, serverVersion, amountRaw: '1000',
            recipient: payTo, txHash: result.payment!.txHash, fastNonce: nonce?.toString(), confirmed: true }));
          completed++;
        } finally {
          if (content) await close(content.server);
          await close(fac.server);
        }
      });
    }
  }
});
