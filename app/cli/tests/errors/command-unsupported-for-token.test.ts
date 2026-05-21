import { describe, expect, it } from "vitest";
import { CommandUnsupportedForTokenError } from "../../src/errors/transaction.js";

describe("CommandUnsupportedForTokenError", () => {
  it("includes command, token, and network in the message", () => {
    const err = new CommandUnsupportedForTokenError({
      command: "send --from-chain arbitrum",
      token: "fastUSD",
      network: "mainnet",
    });
    expect(err.message).toBe(
      "send --from-chain arbitrum is not supported for fastUSD on mainnet.",
    );
    expect(err.exitCode).toBe(2);
    expect(err.errorCode).toBe("COMMAND_UNSUPPORTED_FOR_TOKEN");
  });

  it("appends the suggestion when provided", () => {
    const err = new CommandUnsupportedForTokenError({
      command: "fund usdc crypto",
      token: "fastUSD",
      network: "mainnet",
      suggestion: "Try --token USDC.",
    });
    expect(err.message).toBe(
      "fund usdc crypto is not supported for fastUSD on mainnet. Try --token USDC.",
    );
  });
});
