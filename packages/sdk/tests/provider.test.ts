import { afterEach, describe, expect, it, vi } from 'vitest';
import { Address } from '../src/address';
import { type VersionedTransaction } from '../src/encoding/types';
import { FastError } from '../src/errors';
import { FastProvider } from '../src/provider';

const sampleTransaction: VersionedTransaction = {
    Release20260319: {
        network_id: 'fast:testnet',
        sender: new Array(32).fill(1),
        nonce: '1',
        timestamp_nanos: 10n,
        claim: {
            Burn: {
                token_id: new Array(32).fill(0),
                amount: '10',
            },
        },
        archival: false,
        fee_token: null,
    },
};

function mockRpcResult(result: unknown) {
    const fetchMock = vi.fn(async () => {
        return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function parseFirstRpcRequestBody<TParams extends Record<string, unknown> = Record<string, unknown>>(
    fetchMock: ReturnType<typeof vi.fn>,
): {
    method: string;
    params: TParams;
} {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = init?.body;

    if (typeof body !== 'string') {
        throw new Error('Expected fetch request body to be a JSON string');
    }

    return JSON.parse(body) as {
        method: string;
        params: TParams;
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('FastProvider', () => {
    it('normalizes raw signature input for proxy_submitTransaction', async () => {
        const rpcSafeTransaction = {
            Release20260319: {
                ...sampleTransaction.Release20260319,
                timestamp_nanos: '10',
            },
        };

        const certificate = {
            envelope: {
                transaction: rpcSafeTransaction,
                signature: { Signature: new Array(64).fill(2) },
            },
            signatures: [[new Array(32).fill(3), new Array(64).fill(4)]],
        };

        const fetchMock = mockRpcResult(certificate);
        const provider = new FastProvider({ rpcUrl: 'https://example.invalid/proxy' });

        const result = await provider.submitTransaction({
            transaction: sampleTransaction,
            signature: new Uint8Array(64).fill(9),
        });

        expect(result).toEqual({ Success: certificate });

        const body = parseFirstRpcRequestBody<{
            signature: { Signature: number[] };
            transaction: unknown;
        }>(fetchMock);
        expect(body.method).toBe('proxy_submitTransaction');
        expect(body.params.signature.Signature).toHaveLength(64);
        expect(body.params.signature.Signature[0]).toBe(9);
    });

    it('encodes address and filter fields for proxy_getAccountInfo', async () => {
        const accountInfo = {
            sender: new Array(32).fill(7),
            balance: '0',
            next_nonce: 1,
            requested_state: [],
            token_balance: [],
        };

        const fetchMock = mockRpcResult(accountInfo);
        const provider = new FastProvider({ rpcUrl: 'https://example.invalid/proxy' });
        const address = new Address(new Uint8Array(32).fill(7)).toString();

        await provider.getAccountInfo({
            address,
            tokenBalancesFilter: ['0x' + '11'.repeat(32)],
            stateKeyFilter: [new Uint8Array(32).fill(8)],
            certificateByNonce: { start: 0, limit: 10 },
        });

        const body = parseFirstRpcRequestBody<{
            address: number[];
            token_balances_filter: number[][];
            state_key_filter: number[][];
            certificate_by_nonce: { start: number; limit: number };
        }>(fetchMock);
        expect(body.method).toBe('proxy_getAccountInfo');
        expect(body.params.address).toHaveLength(32);
        expect(body.params.address[0]).toBe(7);
        expect(body.params.token_balances_filter[0]).toHaveLength(32);
        expect(body.params.state_key_filter[0]).toHaveLength(32);
        expect(body.params.certificate_by_nonce).toEqual({ start: 0, limit: 10 });
    });

    it('strips amount prefix for proxy_faucetDrip', async () => {
        const fetchMock = mockRpcResult(null);
        const provider = new FastProvider({ rpcUrl: 'https://example.invalid/proxy' });

        await provider.faucetDrip({
            recipient: new Address(new Uint8Array(32).fill(1)).toString(),
            amount: '0x10',
            tokenId: null,
        });

        const body = parseFirstRpcRequestBody<{
            amount: string;
            token_id: number[] | null;
        }>(fetchMock);
        expect(body.method).toBe('proxy_faucetDrip');
        expect(body.params.amount).toBe('10');
        expect(body.params.token_id).toBeNull();
    });

    it('validates getTransactionCertificates limit', async () => {
        const provider = new FastProvider({ rpcUrl: 'https://example.invalid/proxy' });

        await expect(
            provider.getTransactionCertificates(new Uint8Array(32).fill(1), 0, 201),
        ).rejects.toBeInstanceOf(FastError);
    });
});
