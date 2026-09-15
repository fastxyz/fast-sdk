/**
 * Explicit generator for the allset/intent/v1 fixtures shared with cross-sign.
 *
 * Tests import VECTORS and REJECTS but never run this file's write block.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toFastAddress } from '@fastxyz/sdk';
import { encodeAbiParameters, type Address, type Hex } from 'viem';
import { fastAddressToBytes32 } from '../src/address.js';
import { encodeIntentClaimV1, INTENT_V1_SCHEMA, type IntentClaimV1 } from '../src/intent-v1.js';

const BRIDGE = '0x8677edaa374b7a47ff0093947aabe4acbb2d4538';
const USDC = '0x3600000000000000000000000000000000000000';
const RECEIVER = '0xa5f5e16d993478809abbd82cb0cd80e88c992560';
const FAST_RECEIVER = 'fast17lqf2st89vqwm9yrgv2nhzx0mznqe0uukglkcl55lmecsgq9247qej58nf';
const SHORT_FAST_RECEIVER = toFastAddress(new Uint8Array(31).fill(7));
const NONZERO_PADDING_FAST_RECEIVER = 'fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpa4p6au';
const CALLDATA =
  '0xa9059cbb000000000000000000000000a5f5e16d993478809abbd82cb0cd80e88c99256000000000000000000000000000000000000000000000000000000000000f4240' as const;
const transactionId = (byte: string): Hex => `0x${byte.repeat(32)}` as Hex;

const withdraw: IntentClaimV1 = {
  schema: INTENT_V1_SCHEMA,
  kind: 'withdraw',
  chain: 'eip155:5042',
  bridge: BRIDGE,
  transferTx: transactionId('11'),
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

export const VECTORS: Record<string, IntentClaimV1> = {
  withdraw,
  'withdraw-display': {
    ...withdraw,
    display: { amount: 1000000n, tokenSymbol: 'USDC', tokenDecimals: 6 },
  },
  batch: {
    ...withdraw,
    kind: 'batch',
    transferTx: transactionId('22'),
    intents: [
      {
        action: 'execute',
        target: USDC,
        calldata: CALLDATA,
        value: 0n,
      },
      {
        action: 'deposit_back',
        token: USDC,
        fastReceiver: FAST_RECEIVER,
        value: 0n,
      },
    ],
  },
  'deposit-back': {
    ...withdraw,
    kind: 'deposit_back',
    transferTx: transactionId('44'),
    intents: [
      {
        action: 'deposit_back',
        token: USDC,
        fastReceiver: FAST_RECEIVER,
        value: 0n,
      },
    ],
  },
  revoke: {
    ...withdraw,
    kind: 'revoke',
    intents: [{ action: 'revoke', value: 0n }],
  },
  'execute-value': {
    ...withdraw,
    kind: 'execute',
    transferTx: transactionId('33'),
    intents: [{ action: 'execute', target: USDC, calldata: '0x', value: 1000n }],
  },
  'deadline-u64-max': {
    ...withdraw,
    deadline: 18446744073709551615n,
  },
  'symbol-16-bytes': {
    ...withdraw,
    display: {
      amount: 1n,
      tokenSymbol: 'é'.repeat(8),
      tokenDecimals: 6,
    },
  },
};

export const REJECTS: Record<string, string> = {
  'deadline-overflow': 'deadline',
  'symbol-too-long': 'token_symbol',
  'fast-bad-checksum': 'fast_receiver',
  'fast-wrong-length': 'fast_receiver',
  'fast-uppercase': 'fast_receiver',
  'fast-nonzero-padding': 'fast_receiver',
  'revoke-nonzero': 'value',
  'revoke-in-batch': 'revoke',
  'kind-mismatch': 'kind',
  'non-canonical-whitespace': 'canonical',
  'unknown-key': 'unknown key',
  'zero-intents': 'intents',
};

const INTENT_CLAIM_ABI_PARAMS = [
  {
    type: 'tuple',
    components: [
      { name: 'transferFastTxId', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
      {
        name: 'intents',
        type: 'tuple[]',
        components: [
          { name: 'action', type: 'uint8' },
          { name: 'payload', type: 'bytes' },
          { name: 'value', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

function abiOf(claim: IntentClaimV1): Hex {
  const intents = claim.intents.map((intent) => {
    switch (intent.action) {
      case 'transfer':
        return {
          action: 1,
          payload: encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [intent.token as Address, intent.receiver as Address]),
          value: intent.value,
        };
      case 'execute':
        return {
          action: 0,
          payload: encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [intent.target as Address, intent.calldata]),
          value: intent.value,
        };
      case 'deposit_back':
        return {
          action: 2,
          payload: encodeAbiParameters(
            [{ type: 'address' }, { type: 'bytes32' }],
            [intent.token as Address, fastAddressToBytes32(intent.fastReceiver)],
          ),
          value: intent.value,
        };
      case 'revoke':
        return { action: 3, payload: '0x' as const, value: intent.value };
    }
  });

  return encodeAbiParameters(INTENT_CLAIM_ABI_PARAMS, [
    {
      transferFastTxId: claim.transferTx,
      deadline: claim.deadline,
      intents,
    },
  ]);
}

const textDecoder = new TextDecoder();
const text = (claim: IntentClaimV1): string => textDecoder.decode(encodeIntentClaimV1(claim));
const withdrawText = text(withdraw);
const revokeText = text(VECTORS.revoke);
const batchText = text(VECTORS.batch);
const depositBackText = text(VECTORS['deposit-back']);
const symbolText = text(VECTORS['symbol-16-bytes']);
const revokeInBatchText = revokeText
  .replace('"kind": "revoke"', '"kind": "batch"')
  .replace(
    '      "value": "0"\n    }\n  ]',
    '      "value": "0"\n    },\n    {\n      "action": "revoke",\n      "value": "0"\n    }\n  ]',
  );

const REJECT_BODIES: Record<string, string> = {
  'deadline-overflow': withdrawText.replace('"1789071600"', '"18446744073709551616"'),
  'symbol-too-long': symbolText.replace('"éééééééé"', '"ééééééééé"'),
  'fast-bad-checksum': batchText.replace(FAST_RECEIVER, FAST_RECEIVER.slice(0, -1) + 'g'),
  'fast-wrong-length': depositBackText.replace(FAST_RECEIVER, SHORT_FAST_RECEIVER),
  'fast-uppercase': depositBackText.replace(FAST_RECEIVER, FAST_RECEIVER.toUpperCase()),
  'fast-nonzero-padding': depositBackText.replace(FAST_RECEIVER, NONZERO_PADDING_FAST_RECEIVER),
  'revoke-nonzero': revokeText.replace('"value": "0"', '"value": "1"'),
  'revoke-in-batch': revokeInBatchText,
  'kind-mismatch': revokeText.replace('"kind": "revoke"', '"kind": "withdraw"'),
  'non-canonical-whitespace': withdrawText.replace(/\n */g, ''),
  'unknown-key': withdrawText.replace('"schema": "allset/intent/v1",', '"schema": "allset/intent/v1",\n  "memo": "x",'),
  'zero-intents': withdrawText.replace(/"intents": \[[\s\S]*\]/, '"intents": []'),
};

const acceptBodies = new Set(Object.values(VECTORS).map(text));
for (const [name, body] of Object.entries(REJECT_BODIES)) {
  if (acceptBodies.has(body)) {
    throw new Error(`reject fixture ${name} equals an accept fixture; mutation did not apply`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const directory = fileURLToPath(new URL('../tests/vectors/intent_v1/', import.meta.url));
  mkdirSync(`${directory}reject`, { recursive: true });

  for (const [name, claim] of Object.entries(VECTORS)) {
    writeFileSync(`${directory}${name}.json`, encodeIntentClaimV1(claim));
    writeFileSync(`${directory}${name}.abi.hex`, `${abiOf(claim)}\n`);
  }
  for (const [name, body] of Object.entries(REJECT_BODIES)) {
    writeFileSync(`${directory}reject/${name}.json`, body);
  }

  console.log(`wrote ${Object.keys(VECTORS).length} accept and ${Object.keys(REJECT_BODIES).length} reject fixtures to ${directory}`);
}
