import { toFastAddress } from '@fastxyz/sdk';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liveWithdrawalDependencies, type WithdrawalRoute } from '../../src/services/multisig-withdrawal.js';

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getBlockNumber: vi.fn(),
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  getLogs: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));
vi.mock('viem', async (original) => ({ ...(await original<typeof import('viem')>()), createPublicClient: () => rpc }));
const route: WithdrawalRoute = {
  networkId: 'fast:testnet',
  sender: toFastAddress(new Uint8Array(32).fill(2)),
  chainId: 421614,
  amount: '1000000',
  fastBridgeAddress: toFastAddress(new Uint8Array(32).fill(1)),
  tokenFastTokenId: `0x${'02'.repeat(32)}`,
  tokenEvmAddress: `0x${'03'.repeat(20)}`,
  receiver: `0x${'04'.repeat(20)}`,
  bridgeContract: `0x${'05'.repeat(20)}`,
  evmRpcUrl: 'https://rpc.example',
  relayerUrl: 'https://relay.example',
  crossSignUrl: 'https://cross.example',
};
const deps = () => liveWithdrawalDependencies(route, {} as never);
const proxy = `0x${'06'.repeat(20)}` as const;
const other = `0x${'07'.repeat(20)}` as const;
const transferId = `0x${'33'.repeat(32)}` as const;
const metadata = {
  transactionHash: `0x${'11'.repeat(32)}` as const,
  blockHash: `0x${'22'.repeat(32)}` as const,
  blockNumber: 4010n,
  removed: false,
};
const withdrawAbi = parseAbi([
  'event Withdraw(uint256 indexed operationId, bytes32 indexed transferFastTxId, address indexed paymentToken, uint256 amount, uint256 chainId)',
]);
const sweepAbi = parseAbi(['event IntentDynamicallyTransferred(address tokenAddress, address recipient, uint256 amount)']);
function withdraw(index = 0, id: `0x${string}` = transferId) {
  const args = {
    operationId: BigInt(index),
    transferFastTxId: id,
    paymentToken: route.tokenEvmAddress as `0x${string}`,
    amount: 1000000n,
    chainId: 421614n,
  };
  return {
    ...metadata,
    address: route.bridgeContract,
    logIndex: index,
    args,
    topics: encodeEventTopics({ abi: withdrawAbi, eventName: 'Withdraw', args }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [args.amount, args.chainId]),
  };
}
function payment(index: number, to = route.receiver, from: string = proxy, amount = 1000000n) {
  return {
    ...metadata,
    address: route.tokenEvmAddress,
    logIndex: index,
    topics: encodeEventTopics({
      abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
      eventName: 'Transfer',
      args: { from: from as `0x${string}`, to: to as `0x${string}` },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  };
}
function sweep(index: number, to = route.receiver, amount = 1000000n, address: string = proxy) {
  return {
    ...metadata,
    address,
    logIndex: index,
    topics: encodeEventTopics({ abi: sweepAbi, eventName: 'IntentDynamicallyTransferred' }),
    data: encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      [route.tokenEvmAddress as `0x${string}`, to as `0x${string}`, amount],
    ),
  };
}
async function settle(logs: unknown[], status = 'success', anchor = withdraw()) {
  rpc.getLogs.mockResolvedValue([anchor]);
  rpc.getTransactionReceipt.mockResolvedValue({ ...metadata, status, logs });
  return deps().settlement(transferId, 4010n);
}
beforeEach(() => {
  vi.resetAllMocks();
  rpc.getChainId.mockResolvedValue(route.chainId);
  rpc.getBlockNumber.mockResolvedValue(4010n);
  rpc.getLogs.mockResolvedValue([]);
  rpc.readContract.mockImplementation(
    async ({ functionName }) =>
      ({
        fastSetAddress: `0x${'01'.repeat(32)}`,
        tokensMapping: route.tokenEvmAddress,
        paused: false,
        mintableBridgeTokens: false,
        balanceOf: 2000000n,
        intentExecutorProxy: proxy,
      })[functionName as string],
  );
});
describe('withdrawal destination checks (read-only)', () => {
  it('checks chain, bridge binding, token mapping, pause state and liquidity before payment', async () => {
    expect(await deps().getEvmBlock()).toBe(4010n);
    expect(rpc.readContract).toHaveBeenCalledTimes(5);
    rpc.readContract.mockResolvedValueOnce(`0x${'00'.repeat(32)}`);
    await expect(deps().getEvmBlock()).rejects.toThrow('bridge Fast address');
  });
  it('fails closed for wrong RPC chain or insufficient liquidity', async () => {
    rpc.getChainId.mockResolvedValueOnce(1);
    await expect(deps().getEvmBlock()).rejects.toThrow('chain mismatch');
    const original = rpc.readContract.getMockImplementation()!;
    rpc.readContract.mockImplementation(async (args) => (args.functionName === 'balanceOf' ? 0n : original(args)));
    await expect(deps().getEvmBlock()).rejects.toThrow('liquidity');
  });
  it('bounds historical log queries and never invents settlement', async () => {
    expect(await deps().settlement(`0x${'11'.repeat(32)}`, 10n)).toBe(false);
    expect(rpc.getLogs.mock.calls.map(([args]) => [args.fromBlock, args.toBlock])).toEqual([
      [10n, 2009n],
      [2010n, 4009n],
      [4010n, 4010n],
    ]);
  });
  it('accepts the matching execution and its residual-balance sweep', async () => {
    expect(await settle([withdraw(), payment(1), sweep(2)])).toBe(true);
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'intentExecutorProxy', blockNumber: 4010n }));
    expect(await settle([withdraw(), payment(1, route.receiver, proxy, 1000001n), sweep(2, route.receiver, 1000001n)])).toBe(true);
  });
  it('rejects unsuccessful or absent receipt evidence', async () => {
    expect(await settle([])).toBe(false);
    expect(await settle([withdraw(), payment(1), sweep(2)], 'reverted')).toBe(false);
  });
  it('does not attribute an unrelated payment in the same receipt to this withdrawal', async () => {
    expect(
      await settle([
        withdraw(),
        payment(1, proxy, route.bridgeContract),
        payment(2, other),
        sweep(3, other),
        payment(4, route.receiver, other),
      ]),
    ).toBe(false);
  });
  it('does not attribute a second withdrawal payment from the SAME proxy to the original ID', async () => {
    expect(
      await settle([
        withdraw(),
        payment(1, proxy, route.bridgeContract),
        payment(2, other),
        sweep(3, other),
        withdraw(4, `0x${'44'.repeat(32)}`),
        payment(5),
        sweep(6),
      ]),
    ).toBe(false);
  });
  it('accepts a matching first withdrawal even when another follows in the receipt', async () => {
    expect(await settle([withdraw(), payment(1), sweep(2), withdraw(3, `0x${'44'.repeat(32)}`), payment(4, other), sweep(5, other)])).toBe(
      true,
    );
  });
  it('anchors a matching later withdrawal independently of the preceding execution', async () => {
    expect(
      await settle(
        [withdraw(0, `0x${'44'.repeat(32)}`), payment(1, other), sweep(2, other), withdraw(3), payment(4), sweep(5)],
        'success',
        withdraw(3),
      ),
    ).toBe(true);
  });
  it('stops at the next bridge event even without a preceding executor marker', async () => {
    expect(await settle([withdraw(), withdraw(1, `0x${'44'.repeat(32)}`), payment(2), sweep(3)])).toBe(false);
  });
  it('fails closed for missing executor event, wrong emitter or wrong transfer sender', async () => {
    expect(await settle([withdraw(), payment(1)])).toBe(false);
    expect(await settle([withdraw(), payment(1), sweep(2, route.receiver, 1000000n, other)])).toBe(false);
    expect(await settle([withdraw(), payment(1, route.receiver, other), sweep(2)])).toBe(false);
  });
  it('fails closed for an execution/payment amount mismatch or ambiguous ordering', async () => {
    expect(await settle([withdraw(), payment(1), sweep(2, route.receiver, 1000001n)])).toBe(false);
    expect(await settle([withdraw(), sweep(2), payment(1)])).toBe(false);
    expect(await settle([withdraw(), payment(1), sweep(1)])).toBe(false);
  });
});
