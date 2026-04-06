import type { Account, Chain } from "viem";
import {
  createEvmExecutor as sdkCreateEvmExecutor,
  createEvmWallet as sdkCreateEvmWallet,
  executeDeposit as sdkExecuteDeposit,
  executeWithdraw as sdkExecuteWithdraw,
  getEvmErc20Balance as sdkGetEvmErc20Balance,
  getEvmNativeBalance as sdkGetEvmNativeBalance,
  type BridgeResult,
  type EvmClients,
  type ExecuteDepositParams,
  type ExecuteWithdrawParams,
} from "@fastxyz/allset-sdk";
import { Context, Effect, Layer } from "effect";
import { TransactionFailedError } from "../../errors/index.js";

type DepositEffect = Effect.Effect<BridgeResult, TransactionFailedError>;
type WithdrawEffect = Effect.Effect<BridgeResult, TransactionFailedError>;
type BalanceEffect = Effect.Effect<bigint, TransactionFailedError>;

export interface AllSetShape {
  readonly createWallet: (privateKey: string) => ReturnType<typeof sdkCreateEvmWallet>;
  readonly createExecutor: (
    account: Account,
    rpcUrl: string,
    chainOrId: Chain | number,
  ) => EvmClients;
  readonly deposit: (params: ExecuteDepositParams) => DepositEffect;
  readonly withdraw: (params: ExecuteWithdrawParams) => WithdrawEffect;
  readonly erc20Balance: (
    rpcUrl: string,
    tokenAddress: string,
    ownerAddress: string,
  ) => BalanceEffect;
  readonly nativeBalance: (rpcUrl: string, address: string) => BalanceEffect;
}

export class AllSet extends Context.Tag("AllSet")<AllSet, AllSetShape>() {}

const mapBridgeError = (operation: string) => (cause: unknown) =>
  new TransactionFailedError({
    message: cause instanceof Error ? cause.message : `${operation} failed`,
    cause,
  });

export const AllSetLive = Layer.succeed(AllSet, {
  createWallet: (privateKey) => sdkCreateEvmWallet(privateKey),
  createExecutor: (account, rpcUrl, chainOrId) =>
    sdkCreateEvmExecutor(account, rpcUrl, chainOrId),

  deposit: (params) =>
    Effect.tryPromise({
      try: () => sdkExecuteDeposit(params),
      catch: mapBridgeError("Bridge deposit"),
    }),

  withdraw: (params) =>
    Effect.tryPromise({
      try: () => sdkExecuteWithdraw(params),
      catch: mapBridgeError("Bridge withdrawal"),
    }),

  erc20Balance: (rpcUrl, tokenAddress, ownerAddress) =>
    Effect.tryPromise({
      try: () => sdkGetEvmErc20Balance(rpcUrl, tokenAddress, ownerAddress),
      catch: mapBridgeError("ERC-20 balance query"),
    }),

  nativeBalance: (rpcUrl, address) =>
    Effect.tryPromise({
      try: () => sdkGetEvmNativeBalance(rpcUrl, address),
      catch: mapBridgeError("Native balance query"),
    }),
});
