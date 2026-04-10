import { describe, expect, it, vi } from "vitest";
import {
  FastSnapClient,
  type Eip1193Provider,
} from "../../src/browser";
import { fromHex } from "../../src/index";

describe("FastSnapClient", () => {
  it("installs and connects through an EIP-1193 provider", async () => {
    const request = vi
      .fn<NonNullable<Eip1193Provider["request"]>>()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        connected: true,
        accounts: [
          {
            address: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx3y2z9",
            publicKey:
              "1111111111111111111111111111111111111111111111111111111111111111",
          },
        ],
      });
    const provider: Eip1193Provider = { request };
    const client = new FastSnapClient({
      snapId: "local:http://localhost:8081",
      provider,
    });

    const result = await client.connect();

    expect(request).toHaveBeenNthCalledWith(1, {
      method: "wallet_requestSnaps",
      params: { "local:http://localhost:8081": {} },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: "wallet_invokeSnap",
      params: {
        snapId: "local:http://localhost:8081",
        request: { method: "fast_connect", params: undefined },
      },
    });
    expect(result.connected).toBe(true);
    expect(result.accounts).toHaveLength(1);
  });

  it("delegates message and transaction signing through the snap signer", async () => {
    const request = vi
      .fn<NonNullable<Eip1193Provider["request"]>>()
      .mockResolvedValueOnce([
        {
          address: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx3y2z9",
          publicKey:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ])
      .mockResolvedValueOnce({
        address: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx3y2z9",
        signature:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      })
      .mockResolvedValueOnce({
        address: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx3y2z9",
        signature:
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        transaction: {
          type: "Release20260319",
          value: {
            networkId: "fast:testnet",
            sender: new Uint8Array(32).fill(1),
            nonce: 1n,
            timestampNanos: 1n,
            claim: { type: "LeaveCommittee" },
            archival: false,
            feeToken: null,
          },
        },
      });
    const client = new FastSnapClient({
      snapId: "local:http://localhost:8081",
      provider: { request },
    });
    const signer = client.getSigner(
      "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx3y2z9",
    );

    const publicKey = await signer.getPublicKey();
    const messageSignature = await signer.signMessage(
      new TextEncoder().encode("hello snap"),
    );
    const txSignature = await signer.signTransaction({
      type: "Release20260319",
      value: {
        networkId: "fast:testnet",
        sender: new Uint8Array(32).fill(1),
        nonce: 1n,
        timestampNanos: 1n,
        claim: { type: "LeaveCommittee" },
        archival: false,
        feeToken: null,
      },
    });

    expect(publicKey).toEqual(fromHex("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(messageSignature).toBeInstanceOf(Uint8Array);
    expect(messageSignature).toHaveLength(64);
    expect(txSignature).toBeInstanceOf(Uint8Array);
    expect(txSignature).toHaveLength(64);
    expect(request).toHaveBeenNthCalledWith(1, {
      method: "wallet_invokeSnap",
      params: {
        snapId: "local:http://localhost:8081",
        request: { method: "fast_getAccounts", params: undefined },
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: "wallet_invokeSnap",
      params: {
        snapId: "local:http://localhost:8081",
        request: {
          method: "fast_signMessage",
          params: {
            address: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx3y2z9",
            message: "0x68656c6c6f20736e6170",
            encoding: "hex",
          },
        },
      },
    });
    expect(request).toHaveBeenNthCalledWith(3, {
      method: "wallet_invokeSnap",
      params: {
        snapId: "local:http://localhost:8081",
        request: {
          method: "fast_signTransaction",
          params: {
            address: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx3y2z9",
            transaction: {
              type: "Release20260319",
              value: {
                networkId: "fast:testnet",
                sender: new Uint8Array(32).fill(1),
                nonce: 1n,
                timestampNanos: 1n,
                claim: { type: "LeaveCommittee" },
                archival: false,
                feeToken: null,
              },
            },
          },
        },
      },
    });
  });
});
