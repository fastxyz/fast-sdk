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
  it('requires successful matching Withdraw receipt AND payment to the requested recipient', async () => {
    const log = {
      args: { paymentToken: route.tokenEvmAddress, amount: 1000000n, chainId: 421614n },
      transactionHash: `0x${'11'.repeat(32)}`,
      blockHash: `0x${'22'.repeat(32)}`,
      removed: false,
    };
    rpc.getLogs.mockResolvedValue([log]);
    rpc.getTransactionReceipt.mockResolvedValue({ status: 'success', blockHash: log.blockHash, logs: [] });
    expect(await deps().settlement(`0x${'33'.repeat(32)}`, 4010n)).toBe(false);
    const transfer = {
      address: route.tokenEvmAddress,
      topics: encodeEventTopics({
        abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        eventName: 'Transfer',
        args: { from: route.bridgeContract as `0x${string}`, to: route.receiver as `0x${string}` },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [1000000n]),
    };
    rpc.getTransactionReceipt.mockResolvedValue({ status: 'success', blockHash: log.blockHash, logs: [transfer] });
    expect(await deps().settlement(`0x${'33'.repeat(32)}`, 4010n)).toBe(true);
    const withDust = { ...transfer, data: encodeAbiParameters([{ type: 'uint256' }], [1000001n]) };
    rpc.getTransactionReceipt.mockResolvedValue({ status: 'success', blockHash: log.blockHash, logs: [withDust] });
    expect(await deps().settlement(`0x${'33'.repeat(32)}`, 4010n)).toBe(true);
    rpc.getTransactionReceipt.mockResolvedValue({ status: 'reverted', blockHash: log.blockHash, logs: [transfer] });
    expect(await deps().settlement(`0x${'33'.repeat(32)}`, 4010n)).toBe(false);
  });
});
