import assert from 'node:assert/strict';
import {
  buildIntentClaimBytes,
  buildTransferIntent,
  evmSign,
  extractClaimId,
  relayExecute,
  type RelayParams,
  type RelayResult,
} from '@fastxyz/allset-sdk';
import { TransactionEnvelopeFromRest, type NetworkId, type OperationInputParams, type TransactionEnvelope } from '@fastxyz/schema';
import { fromFastAddress, toHex, type FastProvider, type MultiSigSigner } from '@fastxyz/sdk';
import { Effect, Schema } from 'effect';
import { createPublicClient, http, parseAbiItem, parseAbi, decodeEventLog } from 'viem';
import { prepareSubmissionRecovery, successCertificateMatches } from './tx-pipeline.js';
import { transactionOperations } from './transaction-summary.js';

export interface WithdrawalRoute {
  networkId: NetworkId;
  sender: string;
  chainId: number;
  amount: string;
  fastBridgeAddress: string;
  tokenFastTokenId: string;
  tokenEvmAddress: string;
  receiver: string;
  bridgeContract: string;
  evmRpcUrl: string;
  crossSignUrl: string;
  relayerUrl: string;
}
interface StoredTransaction {
  nonce: string;
  txHash: string;
  envelope: unknown;
}
export interface WithdrawalJournal {
  version: 1;
  route: WithdrawalRoute;
  evmStartBlock: string;
  transfer?: StoredTransaction;
  intent?: StoredTransaction;
  deadline?: string;
  relay?: 'attempting' | 'accepted' | 'rejected';
  completed?: boolean;
}
export interface WithdrawalStore {
  read(): unknown;
  write(value: WithdrawalJournal): void;
}
export interface WithdrawalDependencies {
  provider: Pick<FastProvider, 'getAccountInfo' | 'getPendingMultisigTransactions' | 'getTransactionCertificates' | 'submitTransaction'>;
  crossSign(certificate: unknown, url: string): ReturnType<typeof evmSign>;
  relay(params: RelayParams): Promise<RelayResult>;
  simulate(params: RelayParams): Promise<void>;
  getEvmBlock(): Promise<bigint>;
  settlement(transferId: string, fromBlock: bigint): Promise<boolean>;
  now(): number;
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? toHex(v) : v));
const hash = (value: string): string => value.toLowerCase().replace(/^0x/, '');
const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'));
const txId = (value: string): `0x${string}` => `0x${hash(value)}`;

/** One coordinator advances one paid operation. Existing attempts are reconciled, never reissued. */
export async function runMultisigWithdrawal(
  route: WithdrawalRoute,
  signer: MultiSigSigner,
  store: WithdrawalStore,
  deps: WithdrawalDependencies,
): Promise<{ status: string; txHash?: string; transferTxHash?: string }> {
  route = structuredClone(route);
  assert.equal(await signer.getFastAddress(), route.sender, 'withdrawal sender does not match multisig');
  assert.match(route.amount, /^[1-9][0-9]*$/, 'withdrawal amount must be positive base units');
  assert.match(route.tokenFastTokenId, /^0x[0-9a-fA-F]{64}$/);
  for (const field of [route.receiver, route.tokenEvmAddress, route.bridgeContract]) assert.match(field, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(BigInt(route.receiver), 0n, 'withdrawal recipient must not be zero');
  fromFastAddress(route.fastBridgeAddress);
  const transferOperation: OperationInputParams = {
    type: 'TokenTransfer',
    value: {
      tokenId: bytes(route.tokenFastTokenId),
      recipient: fromFastAddress(route.fastBridgeAddress),
      amount: BigInt(route.amount),
      userData: null,
    },
  };
  // Validate ABI input before the transfer, not after the payment.
  const intents = [buildTransferIntent(route.tokenEvmAddress, route.receiver)];
  buildIntentClaimBytes({ transferFastTxId: `0x${'00'.repeat(32)}`, deadline: 1n, intents });
  const loaded = store.read();
  const journal = (loaded ?? { version: 1, route, evmStartBlock: String(await deps.getEvmBlock()) }) as WithdrawalJournal;
  assert.equal(journal.version, 1, 'unsupported withdrawal journal version');
  assert.equal(canonical(journal.route), canonical(route), 'withdrawal route differs from the original journal');
  assert.match(journal.evmStartBlock, /^(0|[1-9][0-9]*)$/, 'invalid withdrawal start block');
  for (const stage of ['transfer', 'intent'] as const) {
    if (Object.hasOwn(journal, stage)) {
      assert.ok(journal[stage] !== null && typeof journal[stage] === 'object' && !Array.isArray(journal[stage]), `invalid saved ${stage}`);
    }
  }
  assert.ok(journal.relay === undefined || ['attempting', 'accepted', 'rejected'].includes(journal.relay), 'invalid relay state');
  assert.ok(journal.completed === undefined || typeof journal.completed === 'boolean', 'invalid terminal state');
  assert.ok(!journal.intent || journal.transfer, 'intent without transfer');
  assert.ok(!journal.relay || journal.intent, 'relay without intent');
  assert.ok(!journal.completed || journal.transfer, 'terminal journal without transfer');

  const intentOperation = (): OperationInputParams => {
    assert.ok(journal.transfer && journal.deadline, 'missing transfer/deadline for intent');
    assert.match(journal.deadline, /^[1-9][0-9]*$/);
    return {
      type: 'ExternalClaim',
      value: {
        claim: {
          verifierCommittee: [],
          verifierQuorum: 0n,
          claimData: buildIntentClaimBytes({
            transferFastTxId: txId(journal.transfer.txHash),
            deadline: BigInt(journal.deadline),
            intents,
          }),
        },
        signatures: [],
      },
    };
  };
  const validate = async (stored: StoredTransaction, operation: OperationInputParams) => {
    assert.match(stored.nonce, /^(0|[1-9][0-9]*)$/, 'invalid saved nonce');
    const e = Schema.decodeUnknownSync(TransactionEnvelopeFromRest)(stored.envelope);
    const identity = await Effect.runPromise(prepareSubmissionRecovery(e));
    assert.equal(hash(identity.txHash), hash(stored.txHash), 'saved transaction identity mismatch');
    assert.equal(e.transaction.value.networkId, route.networkId, 'saved network mismatch');
    assert.equal(toHex(e.transaction.value.sender), toHex(fromFastAddress(route.sender)), 'saved sender mismatch');
    assert.equal(String(e.transaction.value.nonce), stored.nonce, 'saved nonce mismatch');
    assert.equal(canonical(transactionOperations(e.transaction)), canonical([operation]), 'saved withdrawal operation mismatch');
    assert.equal(e.signature.type, 'MultiSig', 'saved envelope must be multisig');
    if (e.signature.type === 'MultiSig') {
      const config = signer.config;
      assert.equal(
        canonical(e.signature.value.config),
        canonical({ authorizedSigners: config.authorized_signers, quorum: config.quorum, nonce: config.nonce }),
        'saved multisig config mismatch',
      );
    }
    return e;
  };
  if (journal.transfer) await validate(journal.transfer, transferOperation);
  if (journal.intent) await validate(journal.intent, intentOperation());
  if (loaded === null || loaded === undefined) store.write(journal);

  const result = (status: string, stored?: StoredTransaction) => ({
    status,
    txHash: stored?.txHash,
    transferTxHash: journal.transfer?.txHash,
  });
  const reconcile = async (stored: StoredTransaction): Promise<{ certificate?: unknown; pending: boolean }> => {
    const certificates = await deps.provider.getTransactionCertificates({
      address: route.sender,
      fromNonce: BigInt(stored.nonce),
      limit: 1,
    });
    const certificate = certificates.find((c) => String(c.envelope.transaction.value.nonce) === stored.nonce);
    if (certificate) {
      assert.ok(
        await successCertificateMatches({ type: 'Success', value: certificate }, stored.txHash, route.networkId),
        'conflicting withdrawal certificate',
      );
      return { certificate, pending: false };
    }
    const proposals = await deps.provider.getPendingMultisigTransactions({ address: route.sender });
    let pending = false;
    for (const e of proposals.filter((e) => String(e.transaction.value.nonce) === stored.nonce)) {
      const identity = await Effect.runPromise(prepareSubmissionRecovery(e));
      assert.equal(hash(identity.txHash), hash(stored.txHash), 'conflicting withdrawal proposal at saved nonce');
      pending = true;
    }
    return { pending };
  };
  const propose = async (stage: 'transfer' | 'intent', operation: OperationInputParams) => {
    const info = await deps.provider.getAccountInfo({ address: route.sender, tokenBalancesFilter: null, stateKeyFilter: null });
    assert.equal(info.pendingConfirmation, null, 'wallet has a pending confirmation');
    if (stage === 'transfer') {
      const balance = info.tokenBalance.find(([id]) => hash(toHex(id)) === hash(route.tokenFastTokenId))?.[1] ?? 0n;
      assert.ok(balance >= BigInt(route.amount), 'insufficient Fast token balance');
      await deps.getEvmBlock(); // Recheck preflight even when a prepared journal already exists.
    }
    const proposals = await deps.provider.getPendingMultisigTransactions({ address: route.sender });
    assert.ok(
      !proposals.some((e) => e.transaction.value.nonce === info.nextNonce),
      'wallet already has a pending proposal; do not replace it',
    );
    const envelope = await signer.signTransaction({ networkId: route.networkId, nonce: info.nextNonce, operations: [operation] });
    const identity = await Effect.runPromise(prepareSubmissionRecovery(envelope));
    journal[stage] = { nonce: String(info.nextNonce), txHash: identity.txHash, envelope: identity.recoveryEnvelope };
    store.write(journal); // Attempt exists durably before the first external effect.
    const response = await deps.provider.submitTransaction(envelope);
    if (response.type === 'Success')
      assert.ok(await successCertificateMatches(response, identity.txHash, route.networkId), 'conflicting submission certificate');
    else
      assert.ok(
        response.type === 'IncompleteMultiSig' || response.type === 'IncompleteVerifierSigs',
        `unexpected submission result: ${response.type}`,
      );
    return result(response.type === 'IncompleteMultiSig' ? `awaiting-${stage}-signatures` : `${stage}-uncertain`, journal[stage]);
  };
  if (!journal.transfer) return propose('transfer', transferOperation);
  if (await deps.settlement(txId(journal.transfer.txHash), BigInt(journal.evmStartBlock))) {
    journal.completed = true;
    store.write(journal);
    return result('completed');
  }
  if (journal.completed) return result('settlement-unavailable'); // Never reopen a terminal journal.
  const transfer = await reconcile(journal.transfer);
  if (!transfer.certificate) return result(transfer.pending ? 'awaiting-transfer-signatures' : 'transfer-uncertain', journal.transfer);
  if (!journal.intent) {
    journal.deadline = String(Math.floor(deps.now()) + 86400);
    return propose('intent', intentOperation());
  }
  if (!journal.relay)
    assert.ok(
      BigInt(journal.deadline!) > BigInt(Math.floor(deps.now())),
      'withdrawal intent expired; recover this transfer manually, never send another payment',
    );
  const intent = await reconcile(journal.intent);
  if (!intent.certificate) return result(intent.pending ? 'awaiting-intent-signatures' : 'intent-uncertain', journal.intent);
  if (journal.relay) return result(journal.relay === 'accepted' ? 'awaiting-settlement' : 'relay-uncertain');
  const transferProof = await deps.crossSign(transfer.certificate, route.crossSignUrl);
  const intentProof = await deps.crossSign(intent.certificate, route.crossSignUrl);
  for (const [proof, stored] of [
    [transferProof, journal.transfer],
    [intentProof, journal.intent],
  ] as const) {
    assert.ok(
      proof.transaction.length >= 64 && proof.transaction.every((x) => Number.isInteger(x) && x >= 0 && x <= 255),
      'invalid cross-sign bytes',
    );
    assert.equal(hash(extractClaimId(proof.transaction)), hash(stored.txHash), 'cross-sign identity mismatch');
  }
  const relayParams: RelayParams = {
    relayerUrl: route.relayerUrl,
    encodedTransferClaim: transferProof.transaction,
    transferProof: transferProof.signature,
    transferFastTxId: txId(journal.transfer.txHash),
    fastsetAddress: route.sender,
    externalAddress: route.receiver,
    encodedIntentClaim: intentProof.transaction,
    intentProof: intentProof.signature,
    intentFastTxId: txId(journal.intent.txHash),
    intentClaimId: txId(journal.intent.txHash),
    externalTokenAddress: route.tokenEvmAddress,
  };
  await deps.simulate(relayParams);
  journal.relay = 'attempting';
  store.write(journal);
  const relay = await deps.relay(relayParams);
  if (relay.success) journal.relay = 'accepted';
  else if (relay.outcome === 'rejected') journal.relay = 'rejected';
  store.write(journal);
  return result(relay.success ? 'awaiting-settlement' : 'relay-uncertain');
}

export function liveWithdrawalDependencies(route: WithdrawalRoute, provider: FastProvider): WithdrawalDependencies {
  const evm = createPublicClient({ transport: http(route.evmRpcUrl, { retryCount: 0, timeout: 20000 }) });
  const withdrawal = parseAbiItem(
    'event Withdraw(uint256 indexed operationId, bytes32 indexed transferFastTxId, address indexed paymentToken, uint256 amount, uint256 chainId)',
  );
  const bridgeAbi = parseAbi([
    'function fastSetAddress() view returns (bytes32)',
    'function tokensMapping(bytes32) view returns (address)',
    'function mintableBridgeTokens(address) view returns (bool)',
    'function paused() view returns (bool)',
    'function intentExecutorProxy() view returns (address)',
    'function transferAndExecute(bytes encodedTransferClaim, bytes transferProof, bytes encodedIntentClaim, bytes intentProof)',
  ]);
  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);
  const executorAbi = parseAbi([
    'event IntentDynamicallyTransferred(address tokenAddress, address recipient, uint256 amount)',
    'event IntentExecuted(address targetAddress, bytes callData, uint256 amount, bytes result)',
    'event IntentDynamicallyDeposited(address tokenAddress, bytes32 receiver, uint256 amount)',
  ]);
  const bridge = route.bridgeContract as `0x${string}`;
  const token = route.tokenEvmAddress as `0x${string}`;
  const checkChain = async () => assert.equal(await evm.getChainId(), route.chainId, 'EVM RPC chain mismatch');
  return {
    provider,
    crossSign: evmSign,
    relay: relayExecute,
    now: () => Math.floor(Date.now() / 1000),
    getEvmBlock: async () => {
      await checkChain();
      const [target, mappedToken, paused, mintable] = await Promise.all([
        evm.readContract({ address: bridge, abi: bridgeAbi, functionName: 'fastSetAddress' }),
        evm.readContract({
          address: bridge,
          abi: bridgeAbi,
          functionName: 'tokensMapping',
          args: [route.tokenFastTokenId as `0x${string}`],
        }),
        evm.readContract({ address: bridge, abi: bridgeAbi, functionName: 'paused' }),
        evm.readContract({ address: bridge, abi: bridgeAbi, functionName: 'mintableBridgeTokens', args: [token] }),
      ]);
      assert.equal(hash(target), hash(toHex(fromFastAddress(route.fastBridgeAddress))), 'bridge Fast address mismatch');
      assert.equal(mappedToken.toLowerCase(), token.toLowerCase(), 'bridge token mapping mismatch');
      assert.equal(paused, false, 'destination bridge is paused');
      if (!mintable)
        assert.ok(
          (await evm.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [bridge] })) >= BigInt(route.amount),
          'insufficient destination bridge liquidity',
        );
      return evm.getBlockNumber();
    },
    simulate: async (params) => {
      await checkChain();
      assert.ok(params.encodedIntentClaim && params.intentProof, 'missing intent proof');
      await evm.simulateContract({
        address: bridge,
        abi: bridgeAbi,
        functionName: 'transferAndExecute',
        args: [
          toHex(Uint8Array.from(params.encodedTransferClaim)) as `0x${string}`,
          params.transferProof as `0x${string}`,
          toHex(Uint8Array.from(params.encodedIntentClaim)) as `0x${string}`,
          params.intentProof as `0x${string}`,
        ],
      });
    },
    settlement: async (transferId, fromBlock) => {
      await checkChain();
      const head = await evm.getBlockNumber();
      // Bounded queries also work with providers that reject large eth_getLogs ranges.
      for (let start = fromBlock; start <= head; start += 2000n) {
        const end = start + 1999n < head ? start + 1999n : head;
        const logs = await evm.getLogs({
          address: bridge,
          event: withdrawal,
          args: { transferFastTxId: transferId as `0x${string}` },
          fromBlock: start,
          toBlock: end,
        });
        for (const log of logs) {
          if (
            log.args.paymentToken?.toLowerCase() !== route.tokenEvmAddress.toLowerCase() ||
            log.args.amount !== BigInt(route.amount) ||
            log.args.chainId !== BigInt(route.chainId)
          )
            continue;
          const receipt = await evm.getTransactionReceipt({ hash: log.transactionHash });
          if (
            receipt.status !== 'success' ||
            receipt.blockHash !== log.blockHash ||
            receipt.transactionHash !== log.transactionHash ||
            log.removed
          )
            continue;
          if (
            receipt.logs.some(
              (item, index) =>
                item.logIndex === null ||
                !Number.isSafeInteger(item.logIndex) ||
                item.logIndex < 0 ||
                (index > 0 && item.logIndex <= receipt.logs[index - 1]!.logIndex),
            )
          )
            continue;
          const anchor = receipt.logs.findIndex(
            (item) =>
              item.logIndex === log.logIndex &&
              item.address.toLowerCase() === bridge.toLowerCase() &&
              item.data === log.data &&
              item.topics.length === log.topics.length &&
              item.topics.every((topic, index) => topic === log.topics[index]),
          );
          if (anchor < 0) continue;
          const executor = await evm.readContract({
            address: bridge,
            abi: bridgeAbi,
            functionName: 'intentExecutorProxy',
            blockNumber: receipt.blockNumber,
          });
          const payments: typeof receipt.logs = [];
          // Bridge emits Withdraw before executing intents. Stop at the next bridge
          // event or the first executor action: another execution cannot supply proof.
          for (const item of receipt.logs.slice(anchor + 1)) {
            if (item.address.toLowerCase() === bridge.toLowerCase()) break;
            if (item.address.toLowerCase() === executor.toLowerCase()) {
              try {
                const action = decodeEventLog({ abi: executorAbi, data: item.data, topics: item.topics });
                if (
                  action.eventName !== 'IntentDynamicallyTransferred' ||
                  action.args.tokenAddress.toLowerCase() !== token.toLowerCase() ||
                  action.args.recipient.toLowerCase() !== route.receiver.toLowerCase() ||
                  action.args.amount < BigInt(route.amount)
                )
                  break;
                const paidRecipient = payments.some((payment) => {
                  if (payment.address.toLowerCase() !== token.toLowerCase()) return false;
                  try {
                    const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: payment.data, topics: payment.topics });
                    // DynamicTransfer sweeps proxy dust too; bind its exact amount.
                    return (
                      decoded.args.from.toLowerCase() === executor.toLowerCase() &&
                      decoded.args.to.toLowerCase() === route.receiver.toLowerCase() &&
                      decoded.args.value === action.args.amount
                    );
                  } catch {
                    return false;
                  }
                });
                if (paidRecipient) return true;
                break;
              } catch {
                continue;
              }
            }
            payments.push(item);
          }
        }
      }
      return false;
    },
  };
}
