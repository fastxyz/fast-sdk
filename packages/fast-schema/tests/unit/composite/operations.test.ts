import { describe, expect, it } from "vitest";
import {
  BurnFromRpc,
  ClaimTypeFromRpc,
  ExternalClaimFromRpc,
  MintFromRpc,
  OperationFromRpc,
  StateInitializationFromRpc,
  StateResetFromRpc,
  StateUpdateFromRpc,
  TokenCreationFromRpc,
  TokenManagementFromRpc,
  TokenTransferFromRpc,
  ValidatorConfigFromRpc,
} from "../../../src/palette/rpc.ts";
import { decodeSync, encodeSync, numArray32, numArray64 } from "../helpers.ts";

const ADDR = numArray32(1);
const TOKEN_ID = numArray32(0x11);
const STATE_KEY = numArray32(0x22);
const STATE_VAL = numArray32(0xaa);
const SIG = numArray64(0xcc);

describe("TokenTransferFromRpc", () => {
  const wire = {
    token_id: TOKEN_ID,
    recipient: ADDR,
    amount: "3e8",
    user_data: null,
  };

  it("decodes snake_case RPC to camelCase", () => {
    const result = decodeSync(TokenTransferFromRpc, wire);
    expect(result.tokenId).toBeInstanceOf(Uint8Array);
    expect(result.recipient).toBeInstanceOf(Uint8Array);
    expect(result.amount).toBe(1000n);
    expect(result.userData).toBeNull();
  });

  it("round-trips", () => {
    const decoded = decodeSync(TokenTransferFromRpc, wire);
    const encoded = encodeSync(TokenTransferFromRpc, decoded);
    expect(encoded).toEqual(wire);
  });
});

describe("TokenCreationFromRpc", () => {
  it("decodes with mints array", () => {
    const wire = {
      token_name: "TestToken",
      decimals: 8,
      initial_amount: "186a0",
      mints: [ADDR],
      user_data: null,
    };
    const result = decodeSync(TokenCreationFromRpc, wire);
    expect(result.tokenName).toBe("TestToken");
    expect(result.decimals).toBe(8);
    expect(result.initialAmount).toBe(100000n);
    expect(result.mints).toHaveLength(1);
  });
});

describe("TokenManagementFromRpc", () => {
  it("decodes with AddressChange mints", () => {
    const wire = {
      token_id: TOKEN_ID,
      update_id: 1,
      new_admin: null,
      mints: [["Add", ADDR]],
      user_data: null,
    };
    const result = decodeSync(TokenManagementFromRpc, wire);
    expect(result.tokenId).toBeInstanceOf(Uint8Array);
    expect(result.updateId).toBe(1n);
    expect(result.newAdmin).toBeNull();
    expect(result.mints).toHaveLength(1);
  });
});

describe("MintFromRpc", () => {
  it("decodes", () => {
    const wire = { token_id: TOKEN_ID, recipient: ADDR, amount: "1f4" };
    const result = decodeSync(MintFromRpc, wire);
    expect(result.amount).toBe(500n);
  });
});

describe("BurnFromRpc", () => {
  it("decodes", () => {
    const wire = { token_id: TOKEN_ID, amount: "64" };
    const result = decodeSync(BurnFromRpc, wire);
    expect(result.amount).toBe(100n);
  });

  it("round-trips", () => {
    const wire = { token_id: TOKEN_ID, amount: "64" };
    const decoded = decodeSync(BurnFromRpc, wire);
    const encoded = encodeSync(BurnFromRpc, decoded);
    expect(encoded).toEqual(wire);
  });
});

describe("State operations", () => {
  it("StateInitializationFromRpc", () => {
    const wire = { key: STATE_KEY, initial_state: STATE_VAL };
    const result = decodeSync(StateInitializationFromRpc, wire);
    expect(result.key).toBeInstanceOf(Uint8Array);
    expect(result.initialState).toBeInstanceOf(Uint8Array);
  });

  it("StateUpdateFromRpc", () => {
    const wire = {
      key: STATE_KEY,
      previous_state: STATE_VAL,
      next_state: numArray32(0xbb),
      compute_claim_tx_hash: numArray32(0xcc),
      compute_claim_tx_timestamp: 1000000,
    };
    const result = decodeSync(StateUpdateFromRpc, wire);
    expect(result.key).toBeInstanceOf(Uint8Array);
    expect(result.computeClaimTxTimestamp).toBe(1000000n);
  });

  it("StateResetFromRpc", () => {
    const wire = { key: STATE_KEY, reset_state: STATE_VAL };
    const result = decodeSync(StateResetFromRpc, wire);
    expect(result.resetState).toBeInstanceOf(Uint8Array);
  });
});

describe("ExternalClaimFromRpc", () => {
  it("decodes nested claim body + signatures", () => {
    const wire = {
      claim: {
        verifier_committee: [ADDR],
        verifier_quorum: 1,
        claim_data: [1, 2, 3],
      },
      signatures: [{ verifier_addr: ADDR, sig: SIG }],
    };
    const result = decodeSync(ExternalClaimFromRpc, wire);
    expect(result.claim.verifierCommittee).toHaveLength(1);
    expect(result.claim.verifierQuorum).toBe(1n);
    expect(result.signatures).toHaveLength(1);
  });
});

describe("ValidatorConfigFromRpc", () => {
  it("decodes", () => {
    const wire = { address: ADDR, host: "localhost", rpc_port: 8080 };
    const result = decodeSync(ValidatorConfigFromRpc, wire);
    expect(result.host).toBe("localhost");
    expect(result.rpcPort).toBe(8080);
  });
});

describe("OperationFromRpc (TypedVariant)", () => {
  it("decodes keyed Burn variant", () => {
    const wire = { Burn: { token_id: TOKEN_ID, amount: "64" } };
    const result = decodeSync(OperationFromRpc, wire);
    expect(result.type).toBe("Burn");
    expect((result as { value: { amount: bigint } }).value.amount).toBe(100n);
  });

  it("decodes LeaveCommittee unit variant", () => {
    const result = decodeSync(OperationFromRpc, "LeaveCommittee");
    expect(result).toEqual({ type: "LeaveCommittee" });
  });

  it("encodes LeaveCommittee back to string", () => {
    const decoded = decodeSync(OperationFromRpc, "LeaveCommittee");
    const encoded = encodeSync(OperationFromRpc, decoded);
    expect(encoded).toBe("LeaveCommittee");
  });
});

describe("ClaimTypeFromRpc", () => {
  it("decodes single Burn claim", () => {
    const wire = { Burn: { token_id: TOKEN_ID, amount: "64" } };
    const result = decodeSync(ClaimTypeFromRpc, wire);
    expect(result.type).toBe("Burn");
  });

  it("decodes Batch claim", () => {
    const wire = {
      Batch: [
        { Burn: { token_id: TOKEN_ID, amount: "64" } },
        "LeaveCommittee",
      ],
    };
    const result = decodeSync(ClaimTypeFromRpc, wire);
    expect(result.type).toBe("Batch");

    // @ts-expect-error - value is unknown at this level
    const batch = (result as { value: unknown[] }).value;
    expect(batch).toHaveLength(2);
  });
});
