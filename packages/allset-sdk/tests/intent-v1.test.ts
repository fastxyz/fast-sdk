import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toFastAddress } from '@fastxyz/sdk';
import Ajv2020 from 'ajv/dist/2020.js';
import { test } from 'vitest';
import { canonicalJson } from '../src/canonical-json.ts';
import { encodeIntentClaim } from '../src/claims.ts';
import { buildDepositBackIntent, buildExecuteIntent, buildRevokeIntent, buildTransferIntent, IntentAction } from '../src/intents.ts';
import {
  buildClaimBytes,
  decodeIntentClaimV1,
  encodeIntentClaimV1,
  finishIntentClaimV1,
  INTENT_V1_SCHEMA,
  intentClaimV1ToAbi,
  intentsToV1,
  prepareIntentClaimV1,
  readTransferUserDataTag,
  transferUserDataTag,
  type IntentClaimV1,
} from '../src/intent-v1.ts';
import { bytes32ToFastAddress, fastAddressToBytes32 } from '../src/address.ts';
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
const SHORT_FAST_RECEIVER = toFastAddress(new Uint8Array(31).fill(7));

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
  for (const deadline of [0.5, NaN, '01']) {
    assert.throws(
      () => encodeIntentClaimV1({ ...withdraw, deadline: deadline as unknown as bigint }),
      /deadline.*bigint/,
      String(deadline),
    );
  }
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
  assert.equal((fastAddressToBytes32(FAST_RECEIVER).length - 2) / 2, 32);
  assert.throws(() => fastAddressToBytes32(SHORT_FAST_RECEIVER), /32 bytes/);
  assert.doesNotThrow(() =>
    encodeIntentClaimV1({
      ...withdraw,
      kind: 'deposit_back',
      intents: [{ action: 'deposit_back', token: USDC, fastReceiver: FAST_RECEIVER, value: 0n }],
    }),
  );
  assert.throws(
    () =>
      encodeIntentClaimV1({
        ...withdraw,
        kind: 'deposit_back',
        intents: [{ action: 'deposit_back', token: USDC, fastReceiver: SHORT_FAST_RECEIVER, value: 0n }],
      }),
    /32 bytes/,
  );
  assert.throws(
    () =>
      encodeIntentClaimV1({
        ...withdraw,
        kind: 'deposit_back',
        intents: [{ action: 'deposit_back', token: USDC, fastReceiver: FAST_RECEIVER.toUpperCase(), value: 0n }],
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
  const revoke = { action: 'revoke' as const, value: 0n };
  assert.doesNotThrow(() => encodeIntentClaimV1({ ...withdraw, kind: 'revoke', intents: [revoke] }));
  for (const intents of [[revoke, withdraw.intents[0]], [withdraw.intents[0], revoke], [revoke, revoke]]) {
    assert.throws(() => encodeIntentClaimV1({ ...withdraw, kind: 'batch', intents }), /revoke/);
  }
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

const NOW = () => 1789068000_000;
const PREP = { chainId: 5042, bridgeContract: BRIDGE, deadlineSeconds: 3600, now: NOW } as const;

test('bytes32ToFastAddress inverts fastAddressToBytes32', () => {
  assert.equal(bytes32ToFastAddress(fastAddressToBytes32(FAST_RECEIVER)), FAST_RECEIVER);
});

test('bytes32ToFastAddress rejects non-32-byte values', () => {
  assert.throws(
    () => bytes32ToFastAddress(('0x' + '11'.repeat(31)) as `0x${string}`),
    /32 bytes/,
  );
  assert.throws(
    () => bytes32ToFastAddress(('0x' + '11'.repeat(33)) as `0x${string}`),
    /32 bytes/,
  );
});

test('intentsToV1 lifts legacy intents, preserves value, and rejects non-canonical or malformed ones', () => {
  const lifted = intentsToV1([
    buildTransferIntent(USDC, RECEIVER),
    { ...buildExecuteIntent(USDC, '0x'), value: 1000n },
    buildDepositBackIntent(USDC, FAST_RECEIVER),
    buildRevokeIntent(),
  ]);
  assert.deepEqual(lifted, [
    { action: 'transfer', token: USDC, receiver: RECEIVER.toLowerCase(), value: 0n },
    { action: 'execute', target: USDC, calldata: '0x', value: 1000n },
    { action: 'deposit_back', token: USDC, fastReceiver: FAST_RECEIVER, value: 0n },
    { action: 'revoke', value: 0n },
  ]);
  assert.throws(() => intentsToV1([{ ...buildRevokeIntent(), value: 1n }]), /revoke/);
  assert.throws(() => intentsToV1([{ ...buildRevokeIntent(), payload: '0x00' }]), /revoke/);
  const padded = buildTransferIntent(USDC, RECEIVER);
  assert.throws(() => intentsToV1([{ ...padded, payload: `${padded.payload}00` }]), /canonical/);
  assert.throws(() => intentsToV1([{ action: 9 as IntentAction, payload: '0x', value: 0n }]), /action/);
});

test('buildClaimBytes defaults to legacy and produces v1 only when asked', () => {
  const intents = [buildTransferIntent(USDC, RECEIVER)];
  const legacy = buildClaimBytes({
    transferFastTxId: TX,
    deadline: 1789071600n,
    intents,
    chainId: 5042,
    bridgeContract: BRIDGE,
  });
  assert.equal(legacy.encoding, 'legacy');
  assert.equal(legacy.userData, null);
  assert.equal(`0x${Buffer.from(legacy.claimData).toString('hex')}`, encodeIntentClaim({ transferFastTxId: TX, deadline: 1789071600n, intents }));

  const v1 = buildClaimBytes({
    transferFastTxId: TX,
    deadline: 1789071600n,
    intents,
    chainId: 5042,
    bridgeContract: BRIDGE,
    claimEncoding: 'v1',
  });
  assert.equal(v1.encoding, 'v1');
  assert.equal(decode(v1.claimData).slice(0, 32), '{\n  "schema": "allset/intent/v1"');
  assert.equal(decode(v1.userData!).replace(/\0+$/, ''), 'allset/transfer/v1:5042');
  assert.deepEqual(v1.claimData, encodeIntentClaimV1(withdraw));
  assert.throws(
    () => buildClaimBytes({ transferFastTxId: TX, deadline: 1789071600n, intents, chainId: 5042, claimEncoding: 'v1' }),
    /bridgeContract/,
  );
  assert.throws(
    () => buildClaimBytes({ transferFastTxId: TX, deadline: 1789071600n, intents, claimEncoding: 'v2' as 'v1' }),
    /claimEncoding/,
  );
  assert.throws(
    () => buildClaimBytes({ transferFastTxId: TX, deadline: 1789071600n, intents, claimEncoding: null as unknown as 'v1' }),
    /claimEncoding/,
  );
});

test('prepareIntentClaimV1 validates every input, including the deadline, before any effect', () => {
  const intents = [buildTransferIntent(USDC, RECEIVER)];
  assert.throws(() => prepareIntentClaimV1({ intents, ...PREP, bridgeContract: undefined }), /bridgeContract/);
  assert.throws(() => prepareIntentClaimV1({ intents, ...PREP, bridgeContract: '0x1234' }), /bridge/);
  assert.throws(
    () => prepareIntentClaimV1({ intents, ...PREP, display: { amount: 1n, tokenSymbol: 'é'.repeat(9), tokenDecimals: 6 } }),
    /token_symbol/,
  );
  assert.throws(
    () => prepareIntentClaimV1({ intents: [{ ...intents[0]!, value: 0.5 as unknown as bigint }], ...PREP }),
    /value.*bigint/,
  );
  assert.throws(() => prepareIntentClaimV1({ intents: [{ ...buildRevokeIntent(), value: 1n }], ...PREP }), /revoke/);
  for (const bad of [0.5, 0, -1, Infinity, NaN, 1e30, 2 ** 53]) {
    assert.throws(() => prepareIntentClaimV1({ intents, ...PREP, deadlineSeconds: bad }), /deadlineSeconds/, String(bad));
  }
  const prepared = prepareIntentClaimV1({ intents, ...PREP });
  assert.equal(prepared.deadline, 1789071600n);
  assert.equal(decode(prepared.userData).replace(/\0+$/, ''), 'allset/transfer/v1:5042');
  const bytes = finishIntentClaimV1(prepared, TX);
  assert.deepEqual(bytes, encodeIntentClaimV1(withdraw));
  assert.equal(bytes.length, prepared.byteLength);
});

test('prepareIntentClaimV1 rejects malformed display metadata instead of coercing it', () => {
  const intents = [buildTransferIntent(USDC, RECEIVER)];
  const malformedSymbol = { amount: 1n, tokenSymbol: undefined, tokenDecimals: 6 } as unknown as IntentClaimV1['display'];

  assert.throws(() => prepareIntentClaimV1({ intents, ...PREP, display: malformedSymbol }), /token_symbol/);
  assert.throws(
    () => prepareIntentClaimV1({ intents, ...PREP, display: { amount: 1n, tokenSymbol: 'USDC', tokenDecimals: null } as never }),
    /token_decimals/,
  );
});

test('prepare size check is exact and rejects the next byte beyond the cap', () => {
  const prepWith = (n: number) => prepareIntentClaimV1({ intents: [buildExecuteIntent(USDC, `0x${'00'.repeat(n)}`)], ...PREP });
  let n = 1700;
  for (;;) {
    try {
      prepWith(n + 1);
      n += 1;
    } catch (error) {
      assert.match((error as Error).message, /4096/);
      break;
    }
  }
  const atCap = prepWith(n);
  assert.ok(atCap.byteLength <= 4096 && atCap.byteLength >= 4095);
  assert.equal(finishIntentClaimV1(atCap, TX).length, atCap.byteLength);
  assert.throws(() => prepWith(n + 1), /4096/);
});

test('prepared claim is an owned, frozen snapshot and finish changes only transfer_tx', () => {
  const display = { amount: 1n, tokenSymbol: 'USDC', tokenDecimals: 6 };
  const callerIntent = buildTransferIntent(USDC, RECEIVER);
  const prepared = prepareIntentClaimV1({ intents: [callerIntent], ...PREP, display });
  const before = finishIntentClaimV1(prepared, TX);
  callerIntent.payload = '0x';
  callerIntent.value = 99n;
  display.tokenSymbol = 'é'.repeat(9);
  display.tokenDecimals = 99;
  display.amount = 0n;
  assert.deepEqual(finishIntentClaimV1(prepared, TX), before);
  assert.ok(decode(before).includes('"token_symbol": "USDC"'));
  assert.ok(
    Object.isFrozen(prepared) &&
      Object.isFrozen(prepared.claim) &&
      Object.isFrozen(prepared.claim.intents) &&
      Object.isFrozen(prepared.claim.intents[0]) &&
      Object.isFrozen(prepared.claim.display),
  );
  assert.throws(() => {
    (prepared.claim as { kind: string }).kind = 'revoke';
  }, TypeError);
  assert.equal(prepared.userData.length, 32);

  const otherTx = `0x${'22'.repeat(32)}` as `0x${string}`;
  const other = decode(finishIntentClaimV1(prepared, otherTx));
  assert.equal(other, decode(before).replace(TX, otherTx));
});

test('prepareIntentClaimV1 succeeds on a plain valid withdraw without freezing typed arrays', () => {
  const prepared = prepareIntentClaimV1({ intents: [buildTransferIntent(USDC, RECEIVER)], ...PREP });
  assert.ok(prepared.byteLength > 0);
  assert.deepEqual(finishIntentClaimV1(prepared, TX), encodeIntentClaimV1(withdraw));
});

test('the published JSON Schema accepts every accept fixture and rejects structural rejects', () => {
  const schema = JSON.parse(
    readFileSync(fileURLToPath(new URL('../schemas/allset-intent-v1.json', import.meta.url)), 'utf8'),
  );
  const validate = new Ajv2020({ strict: true }).compile(schema);
  for (const name of Object.keys(VECTORS)) {
    assert.ok(validate(JSON.parse(readFileSync(`${VECTOR_DIRECTORY}${name}.json`, 'utf8'))), name);
  }
  for (const name of ['unknown-key', 'zero-intents', 'revoke-in-batch']) {
    assert.ok(!validate(JSON.parse(readFileSync(`${VECTOR_DIRECTORY}reject/${name}.json`, 'utf8'))), name);
  }
});

test('the distributed package resolves the published JSON Schema subpath', () => {
  const schemaUrl = import.meta.resolve('@fastxyz/allset-sdk/schemas/allset-intent-v1.json');
  const schema = JSON.parse(readFileSync(fileURLToPath(schemaUrl), 'utf8'));
  assert.equal(schema.$id, 'https://allset.fast.xyz/schemas/allset-intent-v1.json');
});
