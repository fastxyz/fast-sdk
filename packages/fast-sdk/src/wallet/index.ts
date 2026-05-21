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
 * const { signature } = await client.sign({
 *   bytes: Array.from(bytes),
 *   metadata: { name: "My Dapp", origin: window.location.origin },
 * });
 * ```
 */
export { FastWalletClient } from "./client";
export type {
  ConnectArgs,
  FastWalletClientOptions,
  MessageEventLike,
  PopupWindowLike,
  SignArgs,
  WindowLike,
} from "./client";
export { encodeTxForWalletSigning } from "./encode-tx";
export { FastWalletError } from "./errors";
export {
  parseConnectRequestEnvelope,
  parseResultMsg,
  parseSignRequestEnvelope,
} from "./schema";
export type {
  ConnectRequestEnvelope,
  ConnectResult,
  DappMetadata,
  ErrorCode,
  ResultMsg,
  SignRequestEnvelope,
  SignResult,
} from "./types";
export { KeyHandoverAgent } from "./key-handover/agent";
export type { DecryptResult, KeyHandoverAgentOptions } from "./key-handover/agent";
export { parseAuthRequest, sealHandover } from "./key-handover/wallet";
export type { ParsedAuthRequest } from "./key-handover/wallet";
export { ERROR as KEY_HANDOVER_ERROR } from "./key-handover/errors";
export type { ErrorCode as KeyHandoverErrorCode } from "./key-handover/errors";
