/**
 * `@fastxyz/sdk/wallet` — popup-window wallet utilities for dapps.
 * Lets a dapp open a popup (hosted by fast-app) to complete signing,
 * without depending on a browser extension.
 *
 * @example
 * ```ts
 * import {
 *   FastWalletClient,
 *   FastWalletError,
 *   encodeTxForWalletSigning,
 * } from "@fastxyz/sdk/wallet";
 *
 * const client = new FastWalletClient();
 * const bytes = await encodeTxForWalletSigning(unsignedTx);
 * const { signature } = await client.sign({ bytes: Array.from(bytes) });
 * ```
 */
export { FastWalletClient } from "./client";
export type {
  FastWalletClientOptions,
  MessageEventLike,
  PopupWindowLike,
  SignArgs,
  WindowLike,
} from "./client";
export { encodeTxForWalletSigning } from "./encode-tx";
export { FastWalletError } from "./errors";
export { parseResultMsg, parseSignRequestEnvelope } from "./schema";
export type {
  DappMetadata,
  ErrorCode,
  ResultMsg,
  SignRequestEnvelope,
  SignResult,
} from "./types";
