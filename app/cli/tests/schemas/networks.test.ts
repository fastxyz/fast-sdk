import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { bundledNetworks } from "../../src/config/networks.js";
import { NetworkConfigSchema } from "../../src/schemas/networks.js";

describe("NetworkConfigSchema", () => {
  it("accepts a config with defaultToken", () => {
    const config = {
      url: "https://example",
      explorerUrl: "https://explorer",
      networkId: "fast:mainnet",
      defaultToken: {
        tokenId: "0xabc",
        symbol: "fastUSD",
        decimals: 6,
      },
    };
    const parsed = Schema.decodeUnknownSync(NetworkConfigSchema)(config);
    expect(parsed.defaultToken?.symbol).toBe("fastUSD");
    expect(parsed.defaultToken?.tokenId).toBe("0xabc");
    expect(parsed.defaultToken?.decimals).toBe(6);
  });

  it("accepts a config without defaultToken (optional field)", () => {
    const config = {
      url: "https://example",
      explorerUrl: "https://explorer",
      networkId: "fast:mainnet",
    };
    const parsed = Schema.decodeUnknownSync(NetworkConfigSchema)(config);
    expect(parsed.defaultToken).toBeUndefined();
  });
});

describe("bundledNetworks", () => {
  it("bundles Polygon mainnet USDC with the production bridge and relayer", () => {
    const polygon = bundledNetworks.mainnet!.allSet!.chains.polygon!;
    expect(polygon.chainId).toBe(137);
    expect(polygon.bridgeContract).toBe("0x8677EdAA374b7A47ff0093947AABE4aCbB2D4538");
    expect(polygon.fastBridgeAddress).toBe("fast1elfwrg5zevdvzm2ccm2js3wvm98sy8t99jwp9c82cermdmpfxfgqkg53th");
    expect(polygon.relayerUrl).toBe("https://allset.fast.xyz/polygon/relayer");
    expect(polygon.evmRpcUrl).toBe("https://allset.fast.xyz/chain/rpc/polygon");
    expect(polygon.evmExplorerUrl).toBe("https://polygonscan.com");
    expect(`${polygon.evmExplorerUrl}/tx/0xabc`).toBe("https://polygonscan.com/tx/0xabc");
    expect(polygon.gasToken).toEqual({ symbol: "POL" });
    expect(polygon.tokens.USDC).toEqual({
      evmAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      fastTokenId: "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
      decimals: 6,
    });
    expect(bundledNetworks.testnet!.allSet!.chains.polygon).toBeUndefined();
  });

  it("mainnet.arc pays gas in USDC and declares the USDC ERC-20 as the gas token", () => {
    const arc = bundledNetworks.mainnet!.allSet!.chains.arc!;
    expect(arc.chainId).toBe(5042);
    expect(arc.gasToken).toEqual({
      symbol: "USDC",
      erc20Address: "0x3600000000000000000000000000000000000000",
    });
    expect(arc.tokens.USDC!.evmAddress.toLowerCase()).toBe(arc.gasToken!.erc20Address!.toLowerCase());
    expect(arc.evmRpcUrl).toBe("https://allset.fast.xyz/chain/rpc/arc");
  });

  it("no bundled evmRpcUrl embeds a provider key", () => {
    for (const net of Object.values(bundledNetworks)) {
      for (const chain of Object.values(net.allSet?.chains ?? {})) {
        expect(chain.evmRpcUrl).toMatch(/^https:\/\/(testnet\.)?allset\.fast\.xyz\/chain\/rpc\/[a-z-]+$/);
      }
    }
  });

  it("mainnet.defaultToken matches the SDK fastUSD", () => {
    const mainnet = bundledNetworks.mainnet;
    expect(mainnet.defaultToken?.symbol).toBe("fastUSD");
    expect(mainnet.defaultToken?.decimals).toBe(6);
    expect(mainnet.defaultToken?.tokenId).toMatch(/^0xc655a123/);
  });

  it("testnet.defaultToken matches the SDK testUSDC", () => {
    const testnet = bundledNetworks.testnet;
    expect(testnet.defaultToken?.symbol).toBe("testUSDC");
    expect(testnet.defaultToken?.decimals).toBe(6);
    expect(testnet.defaultToken?.tokenId).toMatch(/^0xd73a0679/);
  });
});
