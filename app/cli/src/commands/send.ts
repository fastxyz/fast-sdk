import { Args, Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"
import { Signer, TransactionBuilder } from "@fastxyz/fast-sdk"
import { AccountStore } from "../services/account-store.js"
import { PasswordService } from "../services/password-service.js"
import { FastRpc } from "../services/fast-rpc.js"
import { Output } from "../services/output.js"
import { CliConfig } from "../services/cli-config.js"
import { HistoryStore } from "../services/history-store.js"
import { NetworkConfigService } from "../services/network-config.js"
import {
  InvalidAddressError,
  InvalidAmountError,
  UserCancelledError,
  TransactionFailedError,
} from "../errors/index.js"
import { HistoryEntry } from "../schemas/history.js"

const addressArg = Args.text({ name: "address" }).pipe(
  Args.withDescription("Recipient address (fast1... for Fast)"),
)

const amountArg = Args.text({ name: "amount" }).pipe(
  Args.withDescription("Human-readable amount (e.g., 10.5)"),
)

const tokenOption = Options.text("token").pipe(
  Options.withDefault("USDC"),
  Options.withDescription("Token to send"),
)

const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`

export const sendCommand = Command.make(
  "send",
  { address: addressArg, amount: amountArg, token: tokenOption },
  (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore
      const passwordService = yield* PasswordService
      const rpc = yield* FastRpc
      const output = yield* Output
      const config = yield* CliConfig
      const historyStore = yield* HistoryStore
      const networkConfig = yield* NetworkConfigService

      // Validate address — Fast-to-Fast only
      if (!args.address.startsWith("fast1")) {
        return yield* Effect.fail(
          new InvalidAddressError({
            message: `EVM address requires --to-chain. Did you mean: fast send ${args.address} ${args.amount} --to-chain <chain>?`,
          }),
        )
      }

      // Parse amount
      const amountFloat = Number.parseFloat(args.amount)
      if (Number.isNaN(amountFloat) || amountFloat <= 0) {
        return yield* Effect.fail(
          new InvalidAmountError({ message: "Amount must be a positive number" }),
        )
      }

      // Default to 6 decimals for USDC
      const decimals = 6
      const decimalParts = args.amount.split(".")
      if (decimalParts.length > 1 && decimalParts[1]!.length > decimals) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `Amount has too many decimal places for ${args.token} (max ${decimals})`,
          }),
        )
      }

      const amountRaw = BigInt(Math.round(amountFloat * 10 ** decimals))

      // Resolve account and password
      const accountInfo = yield* accounts.resolveAccount(config.account)
      const pwd = yield* passwordService.resolve()
      const { seed } = yield* accounts.export_(accountInfo.name, pwd)

      // Resolve network
      const network = yield* networkConfig.resolve(config.network).pipe(
        Effect.mapError((e) => new TransactionFailedError({ message: e.message, cause: e })),
      )

      // Interactive confirmation
      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Send ${args.amount} ${args.token}`)
        yield* output.humanLine(`  From:  ${accountInfo.name} (${accountInfo.fastAddress})`)
        yield* output.humanLine(`  To:    ${args.address}`)
        yield* output.humanLine(`  Route: Fast → Fast`)
        yield* output.humanLine(`  Token: ${args.token}`)
        yield* output.humanLine("")
        const confirmed = yield* output.confirm("Confirm?")
        if (!confirmed) {
          return yield* Effect.fail(new UserCancelledError())
        }
      }

      // Build and sign transaction
      const signer = new Signer(seed)

      // Get account nonce
      const { bech32m } = require("bech32") as typeof import("bech32")
      const senderBytes = new Uint8Array(
        bech32m.fromWords(bech32m.decode(accountInfo.fastAddress).words),
      )
      const rpcAccountInfo = yield* rpc.getAccountInfo({ sender: senderBytes })
      const nonce = (rpcAccountInfo as any)?.nextNonce ?? 0n

      // Decode recipient address to bytes
      const recipientBytes = new Uint8Array(
        bech32m.fromWords(bech32m.decode(args.address).words),
      )

      // TODO: Resolve token ID properly. For now, use a placeholder for USDC.
      const tokenId = new Uint8Array(32) // placeholder — needs real token resolution

      const builder = new TransactionBuilder({
        networkId: network.networkId as any,
        signer,
        nonce,
      })

      const envelope = yield* Effect.tryPromise({
        try: () =>
          builder
            .addTokenTransfer({
              tokenId,
              recipient: recipientBytes,
              amount: amountRaw,
              userData: null,
            })
            .sign(),
        catch: (cause) =>
          new TransactionFailedError({ message: "Failed to build transaction", cause }),
      })

      // Submit
      const result = yield* rpc.submitTransaction(envelope)

      const txHash = bytesToHex(
        typeof result === "object" && result !== null && "hash" in result
          ? (result as any).hash
          : new Uint8Array(32),
      )
      const explorerUrl = `${network.explorerUrl}/tx/${txHash}`

      // Record in local history
      yield* historyStore.record(
        new HistoryEntry({
          hash: txHash,
          type: "transfer",
          from: accountInfo.fastAddress,
          to: args.address,
          amount: amountRaw.toString(),
          formatted: args.amount,
          tokenName: args.token,
          tokenId: bytesToHex(tokenId),
          network: config.network,
          status: "confirmed",
          timestamp: new Date().toISOString(),
          explorerUrl,
        }),
      )

      yield* output.humanLine(`Sent ${args.amount} ${args.token} to ${args.address}`)
      yield* output.humanLine(`  Transaction: ${txHash}`)
      yield* output.humanLine(`  Explorer:    ${explorerUrl}`)
      yield* output.success({
        txHash,
        from: accountInfo.fastAddress,
        to: args.address,
        amount: amountRaw.toString(),
        formatted: args.amount,
        tokenName: args.token,
        route: "fast",
        explorerUrl,
        estimatedTime: null,
      })
    }),
).pipe(Command.withDescription("Send tokens between Fast addresses"))
