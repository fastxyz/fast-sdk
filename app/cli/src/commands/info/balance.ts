import type { Command } from '../index.js';
import { getEvmErc20Balance } from '@fastxyz/allset-sdk';
import { bech32m } from 'bech32';
import { Effect } from 'effect';
import type { InfoBalanceArgs } from '../../cli.js';
import { FastRpc } from '../../services/api/fast.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { ensureMultisigNetwork } from '../../services/signer-resolver.js';
import { AccountStore } from '../../services/storage/account.js';
import { NetworkConfigService } from '../../services/storage/network.js';

const fromFastAddress = (address: string): Uint8Array => {
  const { prefix, words } = bech32m.decode(address);
  if (prefix !== 'fast') throw new Error(`Expected "fast" prefix, got "${prefix}"`);
  return new Uint8Array(bech32m.fromWords(words));
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const formatAmount = (amount: bigint, decimals: number): string => {
  const s = amount.toString();
  if (decimals === 0) return s;
  const padded = s.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, -decimals) || '0';
  const fracPart = padded.slice(-decimals).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

export const infoBalance: Command<InfoBalanceArgs> = {
  cmd: 'info-balance',
  handler: (args: InfoBalanceArgs) =>
    Effect.gen(function* () {
      const rpc = yield* FastRpc;
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* ClientConfig;
      const netService = yield* NetworkConfigService;
      const networkConfig = yield* netService.resolve(config.network);

      const account = yield* accounts.resolveAccount(config.account);
      if (account.kind === 'multisig') {
        yield* ensureMultisigNetwork(account, config.network);
      }
      const fastAddress = account.fastAddress;
      const evmAddress = account.kind === 'single' ? account.evmAddress : null;
      const senderBytes = fromFastAddress(fastAddress);

      // Fetch all Fast token balances
      const accountInfo = yield* rpc.getAccountInfo({
        address: senderBytes,
        tokenBalancesFilter: [],
        stateKeyFilter: null,
        certificateByNonce: null,
      } as never);

      // Build tokenId hex → Fast balance map
      const fastBalanceMap = new Map<string, bigint>();
      if (accountInfo && typeof accountInfo === 'object' && 'tokenBalance' in accountInfo) {
        const tokenBalances = (accountInfo as { tokenBalance: Array<[Uint8Array, bigint]> }).tokenBalance;
        for (const [tokenIdBytes, amount] of tokenBalances) {
          fastBalanceMap.set(bytesToHex(tokenIdBytes), amount);
        }
      }

      yield* output.humanLine(`Balances for ${account.name}`);
      yield* output.humanLine(`  Fast address: ${fastAddress}`);
      if (evmAddress !== null) {
        yield* output.humanLine(`  EVM address:  ${evmAddress}`);
      }
      yield* output.humanLine('');

      // Deduplicate tokens by fastTokenId, collecting their chain appearances
      type ChainEntry = { chainName: string; evmRpcUrl: string; evmAddress: string };
      type UniqueToken = {
        name: string;
        fastTokenId: string;
        decimals: number;
        chains: ChainEntry[];
      };
      const uniqueTokens: UniqueToken[] = [];

      const matchesFilter = (name: string, tokenId: string) => {
        if (!args.token) return true;
        const f = args.token.toLowerCase().replace(/^0x/, '');
        const idHex = tokenId.replace(/^0x/, '').toLowerCase();
        return name.toLowerCase() === args.token.toLowerCase() || idHex.includes(f);
      };

      const addToken = (name: string, fastTokenId: string, decimals: number, chainEntry?: ChainEntry) => {
        if (!matchesFilter(name, fastTokenId)) return;
        const idKey = fastTokenId.toLowerCase();
        const existing = uniqueTokens.find((t) => t.fastTokenId.toLowerCase() === idKey);
        if (existing) {
          if (chainEntry) existing.chains.push(chainEntry);
          return;
        }
        uniqueTokens.push({
          name,
          fastTokenId,
          decimals,
          chains: chainEntry ? [chainEntry] : [],
        });
      };

      if (networkConfig.defaultToken) {
        addToken(networkConfig.defaultToken.symbol, networkConfig.defaultToken.tokenId, networkConfig.defaultToken.decimals);
      }

      if (networkConfig.allSet) {
        for (const [chainName, chainConfig] of Object.entries(networkConfig.allSet.chains)) {
          for (const [tokenName, token] of Object.entries(chainConfig.tokens)) {
            addToken(tokenName, token.fastTokenId, token.decimals, {
              chainName,
              evmRpcUrl: chainConfig.evmRpcUrl,
              evmAddress: token.evmAddress,
            });
          }
        }
      } else {
        yield* output.humanLine('No bridge chains configured for this network.');
      }

      if (evmAddress === null) {
        yield* output.humanLine('Multisig wallet — EVM chain balances are not available.');
      }

      type NetworkRow = { network: string; balance: string };
      type TokenOutput = { token: string; networks: NetworkRow[] };
      const balancesOutput: TokenOutput[] = [];

      for (const token of uniqueTokens) {
        const { decimals } = token;
        const tokenIdHex = token.fastTokenId.replace(/^0x/, '').toLowerCase();
        const fastRaw = fastBalanceMap.get(tokenIdHex) ?? 0n;

        const rows: NetworkRow[] = [{ network: 'Fast', balance: formatAmount(fastRaw, decimals) }];

        if (evmAddress !== null) {
          for (const chain of token.chains) {
            const evmRaw = yield* Effect.promise(() =>
              getEvmErc20Balance(chain.evmRpcUrl, chain.evmAddress, evmAddress).catch(() => null as bigint | null),
            );
            rows.push({
              network: chain.chainName,
              balance: evmRaw !== null ? formatAmount(evmRaw, decimals) : '-',
            });
          }
        }

        yield* output.humanTable(
          ['NETWORK', `${token.name} BALANCE`],
          rows.map((r) => [r.network, r.balance]),
        );
        yield* output.humanLine('');

        balancesOutput.push({ token: token.name, networks: rows });
      }

      yield* output.ok({ address: fastAddress, evmAddress, balances: balancesOutput });
    }),
};
