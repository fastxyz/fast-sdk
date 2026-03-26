import { describe, it, expect } from 'vitest';
import { Signer } from '../src/signer';
import type { VersionedTransaction } from '../src/encoding/types';
import { hashTransaction } from '../src/encoding/schema';

const realTx: VersionedTransaction = {
  Release20260319: {
    network_id: 'fast:testnet',
    sender: new Uint8Array([
      203, 97, 56, 40, 195, 92, 250, 254, 94, 222, 122, 137, 223, 226,
      252, 193, 17, 167, 56, 85, 0, 102, 103, 1, 168, 151, 36, 181, 255,
      143, 186, 89,
    ]),
    nonce: 229397,
    timestamp_nanos: 1774324392422000000n,
    claim: {
      ExternalClaim: {
        claim: {
          verifier_committee: [],
          verifier_quorum: 0,
          claim_data: [
            123, 34, 116, 121, 112, 101, 34, 58, 32, 34, 114, 101, 119,
            97, 114, 100, 34, 44, 32, 34, 97, 109, 111, 117, 110, 116,
            34, 58, 32, 49, 48, 48, 48, 44, 32, 34, 114, 101, 97, 115,
            111, 110, 34, 58, 32, 34, 115, 116, 97, 107, 105, 110, 103,
            32, 114, 101, 119, 97, 114, 100, 115, 34, 125,
          ],
        },
        signatures: [],
      },
    },
    archival: false,
    fee_token: null,
  },
};

const realSignature = new Uint8Array([
  42, 254, 8, 179, 47, 164, 244, 183, 166, 27, 69, 4, 72, 217, 149, 58,
  17, 65, 251, 35, 19, 162, 145, 3, 241, 97, 198, 58, 73, 147, 12, 221,
  197, 64, 134, 63, 56, 221, 90, 79, 120, 131, 41, 77, 230, 131, 160, 188,
  44, 142, 51, 2, 37, 204, 85, 245, 241, 61, 243, 212, 96, 157, 137, 2,
]);

const signerAddress = 'fast1edsns2xrtna0uhk702yalchucyg6wwz4qpnxwqdgjujttlu0hfvsjlnlxm';

describe('Transaction (real data)', () => {
  it('computes the correct hash for a known ExternalClaim transaction', () => {
    expect(hashTransaction(realTx)).toBe(
      '0x1112e671849b9f5287852017a18c3315a0e498a040f70fbae1f163f6ebff3c09',
    );
  });

  it('verifies a known valid signature against the signer address', async () => {
    expect(await Signer.verifyTransaction(realSignature, realTx, signerAddress)).toBe(true);
  });

  it('rejects the signature for a different address', async () => {
    const wrongAddress = 'fast1edsns2xrtna0uhk702yalchucyg6wwz4qpnxwqdgjujttlu0hfvsjlnlxn';
    expect(await Signer.verifyTransaction(realSignature, realTx, wrongAddress)).toBe(false);
  });
});
