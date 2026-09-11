import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { canonicalJson } from '../src/canonical-json.ts';
import { encodeIntentClaim } from '../src/claims.ts';
import { buildDepositBackIntent, buildExecuteIntent, buildRevokeIntent, buildTransferIntent } from '../src/intents.ts';
import {
  decodeIntentClaimV1,
  encodeIntentClaimV1,
  INTENT_V1_SCHEMA,
  intentClaimV1ToAbi,
  readTransferUserDataTag,
  transferUserDataTag,
  type IntentClaimV1,
} from '../src/intent-v1.ts';
import { REJECTS, VECTORS } from '../scripts/write-intent-v1-vectors.ts';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test('canonicalJson writes fixed key order, two-space indentation, and no trailing newline', () => {
  const bytes = canonicalJson({ b: 'x', a: ['1', { c: '2' }] }, ['a', 'b'], { a: { '*': ['c'] } });

  assert.equal(decode(bytes), '{\n  "a": [\n    "1",\n    {\n      "c": "2"\n    }\n  ],\n  "b": "x"\n}');
});

test('canonicalJson rejects leaves that are not strings, arrays, or objects', () => {
  assert.throws(() => canonicalJson({ a: 1 as unknown as string }, ['a'], {}), /string/);
  assert.throws(() => canonicalJson({ a: null as unknown as string }, ['a'], {}), /string/);
});

test('canonicalJson escapes only JSON-required characters and keeps literal UTF-8', () => {
  const bytes = canonicalJson({ a: 'fast/xyz "q" é' }, ['a'], {});

  assert.equal(decode(bytes), '{\n  "a": "fast/xyz \\"q\\" é"\n}');
});

const BRIDGE = '0x8677EdAA374b7A47ff0093947AABE4aCbB2D4538';
const USDC = '0x3600000000000000000000000000000000000000';
const RECEIVER = '0xa5f5E16D993478809ABbD82Cb0Cd80E88C992560';
const TX = `0x${'11'.repeat(32)}` as `0x${string}`;
const FAST_RECEIVER = 'fast17lqf2st89vqwm9yrgv2nhzx0mznqe0uukglkcl55lmecsgq9247qej58nf';

const withdraw: IntentClaimV1 = {
  schema: INTENT_V1_SCHEMA,
  kind: 'withdraw',
  chain: 'eip155:5042',
  bridge: BRIDGE,
  transferTx: TX,
  deadline: 1789071600n,
  intents: [
    {
      action: 'transfer',
      token: USDC,
      receiver: RECEIVER,
      value: 0n,
    },
  ],
};

test('encodeIntentClaimV1 produces the frozen withdraw bytes', () => {
  const expected =
    '{\n  "schema": "allset/intent/v1",\n  "kind": "withdraw",\n  "chain": "eip155:5042",\n  "bridge": "0x8677edaa374b7a47ff0093947aabe4acbb2d4538",\n  "transfer_tx": "0x1111111111111111111111111111111111111111111111111111111111111111",\n  "deadline": "1789071600",\n  "intents": [\n    {\n      "action": "transfer",\n      "token": "0x3600000000000000000000000000000000000000",\n      "receiver": "0xa5f5e16d993478809abbd82cb0cd80e88c992560",\n      "value": "0"\n    }\n  ]\n}';

  assert.equal(decode(encodeIntentClaimV1(withdraw)), expected);
});

test('decodeIntentClaimV1 round-trips and rejects non-canonical or unrelated bytes', () => {
  const bytes = encodeIntentClaimV1(withdraw);
  assert.deepEqual(decodeIntentClaimV1(bytes), {
    ...withdraw,
    bridge: BRIDGE.toLowerCase(),
    intents: [
      {
        ...withdraw.intents[0],
        token: USDC,
        receiver: RECEIVER.toLowerCase(),
      },
    ],
  });

  assert.throws(() => decodeIntentClaimV1(new TextEncoder().encode(decode(bytes).replace(/\n */g, ''))), /canonical/);
  assert.throws(() => decodeIntentClaimV1(new TextEncoder().encode(decode(bytes) + '\n')), /canonical/);
  assert.throws(() => decodeIntentClaimV1(new TextEncoder().encode(decode(bytes).replace('"kind": "withdraw"', '"kind": "revoke"'))), /kind/);
  assert.throws(() => decodeIntentClaimV1(new TextEncoder().encode('{"schema":"fastid/claim/v2"}')), /unrelated/);
});

test('intentClaimV1ToAbi matches the legacy ABI for every action shape', () => {
  assert.equal(
    intentClaimV1ToAbi(withdraw),
    encodeIntentClaim({
      transferFastTxId: TX,
      deadline: withdraw.deadline,
      intents: [buildTransferIntent(USDC, RECEIVER)],
    }),
  );

  const batch: IntentClaimV1 = {
    ...withdraw,
    kind: 'batch',
    transferTx: `0x${'22'.repeat(32)}` as `0x${string}`,
    intents: [
      {
        action: 'execute',
        target: USDC,
        calldata: '0x',
        value: 0n,
      },
      {
        action: 'deposit_back',
        token: USDC,
        fastReceiver: FAST_RECEIVER,
        value: 0n,
      },
    ],
  };
  assert.equal(
    intentClaimV1ToAbi(batch),
    encodeIntentClaim({
      transferFastTxId: batch.transferTx,
      deadline: batch.deadline,
      intents: [buildExecuteIntent(USDC, '0x'), buildDepositBackIntent(USDC, FAST_RECEIVER)],
    }),
  );

  const revoke: IntentClaimV1 = {
    ...withdraw,
    kind: 'revoke',
    intents: [{ action: 'revoke', value: 0n }],
  };
  assert.equal(
    intentClaimV1ToAbi(revoke),
    encodeIntentClaim({
      transferFastTxId: TX,
      deadline: revoke.deadline,
      intents: [buildRevokeIntent()],
    }),
  );
});

test('ABI mapping preserves value for every action and requires zero for revoke', () => {
  const execute: IntentClaimV1 = {
    ...withdraw,
    kind: 'execute',
    intents: [{ action: 'execute', target: USDC, calldata: '0x', value: 1000n }],
  };
  assert.equal(
    intentClaimV1ToAbi(execute),
    encodeIntentClaim({
      transferFastTxId: TX,
      deadline: execute.deadline,
      intents: [{ ...buildExecuteIntent(USDC, '0x'), value: 1000n }],
    }),
  );

  const transfer: IntentClaimV1 = {
    ...withdraw,
    intents: [{ ...withdraw.intents[0], value: 7n }],
  };
  assert.equal(
    intentClaimV1ToAbi(transfer),
    encodeIntentClaim({
      transferFastTxId: TX,
      deadline: transfer.deadline,
      intents: [{ ...buildTransferIntent(USDC, RECEIVER), value: 7n }],
    }),
  );
  assert.notEqual(intentClaimV1ToAbi(transfer), intentClaimV1ToAbi(withdraw));
  assert.throws(
    () =>
      encodeIntentClaimV1({
        ...withdraw,
        kind: 'revoke',
        intents: [{ action: 'revoke', value: 1n }],
      }),
    /value/,
  );
});

test('validation enforces the shared domains and derives batch for two or more intents', () => {
  assert.doesNotThrow(() => encodeIntentClaimV1({ ...withdraw, deadline: 2n ** 64n - 1n }));
  assert.throws(() => encodeIntentClaimV1({ ...withdraw, deadline: 2n ** 64n }), /deadline/);
  assert.doesNotThrow(() =>
    encodeIntentClaimV1({
      ...withdraw,
      display: {
        amount: 1n,
        tokenSymbol: 'é'.repeat(8),
        tokenDecimals: 99,
      },
    }),
  );
  assert.throws(
    () =>
      encodeIntentClaimV1({
        ...withdraw,
        display: {
          amount: 1n,
          tokenSymbol: 'é'.repeat(9),
          tokenDecimals: 6,
        },
      }),
    /token_symbol/,
  );
  const badChecksum = FAST_RECEIVER.slice(0, -1) + (FAST_RECEIVER.endsWith('f') ? 'g' : 'f');
  assert.throws(
    () =>
      encodeIntentClaimV1({
        ...withdraw,
        kind: 'deposit_back',
        intents: [
          {
            action: 'deposit_back',
            token: USDC,
            fastReceiver: badChecksum,
            value: 0n,
          },
        ],
      }),
    /fast_receiver/,
  );
  assert.throws(() => encodeIntentClaimV1({ ...withdraw, intents: [] }), /intents/);
  assert.throws(
    () =>
      encodeIntentClaimV1({
        ...withdraw,
        kind: 'withdraw',
        intents: [withdraw.intents[0], withdraw.intents[0]],
      }),
    /kind/,
  );
  assert.doesNotThrow(() =>
    encodeIntentClaimV1({
      ...withdraw,
      kind: 'batch',
      intents: [withdraw.intents[0], withdraw.intents[0]],
    }),
  );
  assert.doesNotThrow(() => encodeIntentClaimV1({ ...withdraw, chain: 'eip155:9999999999999' }));
  assert.throws(() => encodeIntentClaimV1({ ...withdraw, chain: 'eip155:10000000000000' }), /chain/);
});

test('transfer user_data tag is 32 ASCII bytes, NUL padded, and round-trips', () => {
  const tag = transferUserDataTag(5042);
  assert.equal(tag.length, 32);
  assert.equal(decode(tag).replace(/\0+$/, ''), 'allset/transfer/v1:5042');
  assert.equal(readTransferUserDataTag(tag), 5042);
  assert.equal(readTransferUserDataTag(new Uint8Array(32)), null);
  assert.throws(() => transferUserDataTag(-1), /chain id/);
  assert.throws(() => transferUserDataTag(10 ** 13), /chain id/);
});

const VECTOR_DIRECTORY = fileURLToPath(new URL('./vectors/intent_v1/', import.meta.url));

test('accept fixtures match canonical JSON and independent ABI files', () => {
  for (const [name, claim] of Object.entries(VECTORS)) {
    const jsonFile = new Uint8Array(readFileSync(`${VECTOR_DIRECTORY}${name}.json`));
    const abiFile = readFileSync(`${VECTOR_DIRECTORY}${name}.abi.hex`, 'utf8').trim();

    assert.deepEqual(encodeIntentClaimV1(claim), jsonFile, `${name}.json drifted`);
    assert.equal(intentClaimV1ToAbi(claim), abiFile, `${name}.abi.hex drifted`);
    assert.deepEqual(decodeIntentClaimV1(jsonFile), decodeIntentClaimV1(encodeIntentClaimV1(claim)));
  }
});

test('reject fixtures fail for their documented reason', () => {
  for (const [name, expected] of Object.entries(REJECTS)) {
    const bytes = new Uint8Array(readFileSync(`${VECTOR_DIRECTORY}reject/${name}.json`));
    assert.throws(() => decodeIntentClaimV1(bytes), new RegExp(expected), `${name} must be rejected with "${expected}"`);
  }
});
