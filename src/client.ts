/**
 * client.ts — fast() factory function
 *
 * The primary entry point for the Fast SDK. Returns a FastClient
 * with simple one-liner methods for agents.
 */

import path from 'node:path';
import { bech32m } from 'bech32';
import { FastError } from './errors.js';
import {
  generateEd25519Key,
  saveKeyfile,
  loadKeyfile,
  withKey,
  signEd25519,
  verifyEd25519,
} from './keys.js';
import { getKeysDir, setChainConfig } from './config.js';
import { FAST_CHAIN_CONFIGS, configKey, resolveKnownFastToken } from './defaults.js';
import { rpcCall } from './rpc.js';
import {
  TransactionBcs,
  hashTransaction,
  FAST_DECIMALS,
  SET_TOKEN_ID,
  EXPLORER_BASE,
  tokenIdEquals,
  hexToTokenId,
} from './bcs.js';
import { pubkeyToAddress, addressToPubkey } from './address.js';
import { toHex, fromHex } from './utils.js';
import type { FastClient, NetworkType } from './types.js';

const DEFAULT_TOKEN = 'SET';
const HEX_TOKEN_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

type FastAccountInfo = {
  balance?: string;
  token_balance?: Array<[number[], string]>;
  next_nonce?: number;
} | null;

type FastTokenMetadata = {
  token_name?: string;
  decimals?: number;
  total_supply?: string;
  admin?: number[];
  mints?: number[][];
};

type FastTokenInfoResponse = {
  requested_token_metadata?: Array<[number[], FastTokenMetadata | null]>;
} | null;

function isNativeFastToken(token: string): boolean {
  const upper = token.toUpperCase();
  return upper === 'SET' || upper === 'FAST';
}

function tokenIdToHex(tokenId: number[] | Uint8Array): string {
  return Buffer.from(new Uint8Array(tokenId)).toString('hex').toLowerCase();
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

/**
 * Create a Fast chain client.
 *
 * @example
 * ```ts
 * const f = fast({ network: 'testnet' });
 * await f.setup();
 * await f.balance();
 * await f.send({ to: 'fast1...', amount: '1.0' });
 * ```
 */
export function fast(opts?: { network?: NetworkType }): FastClient {
  const network: NetworkType = opts?.network ?? 'testnet';
  const defaults = FAST_CHAIN_CONFIGS[network];
  const rpcUrl = defaults.rpc;

  let _address: string | null = null;
  let _keyfilePath: string | null = null;

  function ensureSetup(): void {
    if (!_address || !_keyfilePath) {
      throw new FastError('CHAIN_NOT_CONFIGURED', 'Call setup() before using other methods', {
        note: "const f = fast({ network: 'testnet' });\nawait f.setup();",
      });
    }
  }

  async function fetchAccountInfo(pubkey: Uint8Array): Promise<FastAccountInfo> {
    return (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
      address: pubkey,
      token_balances_filter: [],
      state_key_filter: null,
      certificate_by_nonce: null,
    })) as FastAccountInfo;
  }

  function buildTokenBalanceMap(accountInfo: FastAccountInfo): Map<string, string> {
    const map = new Map<string, string>();
    for (const [tokenId, balance] of accountInfo?.token_balance ?? []) {
      map.set(tokenIdToHex(tokenId), stripHexPrefix(balance));
    }
    return map;
  }

  async function fetchTokenMetadata(tokenIds: Uint8Array[]): Promise<Map<string, FastTokenMetadata>> {
    const uniq = new Map<string, Uint8Array>();
    for (const tokenId of tokenIds) {
      const key = tokenIdToHex(tokenId);
      if (!uniq.has(key)) {
        uniq.set(key, tokenId);
      }
    }
    if (uniq.size === 0) {
      return new Map();
    }

    const result = (await rpcCall(rpcUrl, 'proxy_getTokenInfo', {
      token_ids: [...uniq.values()],
    })) as FastTokenInfoResponse;

    const metadata = new Map<string, FastTokenMetadata>();
    for (const [tokenId, meta] of result?.requested_token_metadata ?? []) {
      if (!meta) {
        continue;
      }
      metadata.set(tokenIdToHex(tokenId), meta);
    }
    return metadata;
  }

  async function resolveNamedToken(
    accountInfo: FastAccountInfo,
    token: string,
  ): Promise<{ tokenId: Uint8Array; decimals: number; symbol: string; rawBalance: string } | null> {
    const upper = token.toUpperCase();
    const balances = buildTokenBalanceMap(accountInfo);
    const tokenIds = (accountInfo?.token_balance ?? []).map(([tokenId]) => new Uint8Array(tokenId));

    const metadata = await fetchTokenMetadata(tokenIds);
    for (const tokenId of tokenIds) {
      const key = tokenIdToHex(tokenId);
      const meta = metadata.get(key);
      if (!meta?.token_name || meta.token_name.toUpperCase() !== upper) {
        continue;
      }
      return {
        tokenId,
        decimals: meta.decimals ?? FAST_DECIMALS,
        symbol: meta.token_name,
        rawBalance: balances.get(key) ?? '0',
      };
    }

    const known = resolveKnownFastToken(token);
    if (known) {
      return {
        tokenId: hexToTokenId(known.tokenId),
        decimals: known.decimals,
        symbol: known.symbol,
        rawBalance: '0',
      };
    }

    return null;
  }

  const client: FastClient = {
    get address(): string | null {
      return _address;
    },

    async setup(): Promise<{ address: string }> {
      const keysDir = getKeysDir();
      _keyfilePath = path.join(keysDir, 'fast.json');

      try {
        const existing = await loadKeyfile(_keyfilePath);
        _address = pubkeyToAddress(existing.publicKey);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('ENOENT')) {
          throw error;
        }
        const keypair = await generateEd25519Key();
        await saveKeyfile(_keyfilePath, keypair);
        _address = pubkeyToAddress(keypair.publicKey);
      }

      const key = configKey(network);
      await setChainConfig(key, {
        rpc: rpcUrl,
        keyfile: _keyfilePath,
        network,
        defaultToken: DEFAULT_TOKEN,
      });

      return { address: _address };
    },

    async balance(opts?: { token?: string }): Promise<{ amount: string; token: string }> {
      ensureSetup();
      const tok = opts?.token ?? DEFAULT_TOKEN;

      let pubkey: Uint8Array;
      try {
        pubkey = addressToPubkey(_address!);
      } catch {
        return { amount: '0', token: tok };
      }

      const result = await fetchAccountInfo(pubkey);

      if (!result) return { amount: '0', token: tok };

      // Native SET balance
      if (isNativeFastToken(tok)) {
        const hexBalance = result.balance ?? '0';
        return { amount: fromHex(hexBalance, FAST_DECIMALS), token: tok.toUpperCase() };
      }

      // Non-native token by raw token ID
      if (HEX_TOKEN_PATTERN.test(tok)) {
        const tokenIdBytes = hexToTokenId(tok);
        const entry = result.token_balance?.find(([tid]) => tokenIdEquals(tid, tokenIdBytes));
        if (!entry) return { amount: '0', token: tok };
        const [, bal] = entry;
        const rawBalance = bal.startsWith('0x') || bal.startsWith('0X') ? bal.slice(2) : bal;
        const tokenKey = tokenIdToHex(tokenIdBytes);
        const metadata = await fetchTokenMetadata([tokenIdBytes]);
        const decimals = metadata.get(tokenKey)?.decimals ?? FAST_DECIMALS;
        return { amount: fromHex(rawBalance, decimals), token: tok };
      }

      const resolved = await resolveNamedToken(result, tok);
      if (resolved) {
        return {
          amount: fromHex(resolved.rawBalance, resolved.decimals),
          token: resolved.symbol,
        };
      }

      throw new FastError('TOKEN_NOT_FOUND', `Token '${tok}' not found on Fast chain`, {
        note: 'Use a held token symbol like "SETUSDC" or pass the hex token ID directly:\n  await f.balance({ token: "0x..." })',
      });
    },

    async send(params: {
      to: string;
      amount: string;
      token?: string;
    }): Promise<{ txHash: string; explorerUrl: string }> {
      ensureSetup();

      // Resolve token ID and decimals
      let tokenId: Uint8Array = SET_TOKEN_ID;
      let decimals = FAST_DECIMALS;

      if (params.token && !isNativeFastToken(params.token)) {
        const accountInfo = await fetchAccountInfo(addressToPubkey(_address!));

        if (HEX_TOKEN_PATTERN.test(params.token)) {
          tokenId = hexToTokenId(params.token);
          const metadata = await fetchTokenMetadata([tokenId]);
          decimals = metadata.get(tokenIdToHex(tokenId))?.decimals ?? FAST_DECIMALS;
        } else {
          const resolved = await resolveNamedToken(accountInfo, params.token);
          if (!resolved) {
            throw new FastError('TOKEN_NOT_FOUND', `Token '${params.token}' not found on Fast chain`, {
              note: 'Use a held token symbol like "SETUSDC" or pass the hex token ID directly:\n  await f.send({ to: "fast1...", amount: "1", token: "0x..." })',
            });
          }
          tokenId = resolved.tokenId;
          decimals = resolved.decimals;
        }
      }

      const hexAmount = toHex(params.amount, decimals);

      try {
        const result = await client.submit({
          recipient: params.to,
          claim: {
            TokenTransfer: {
              token_id: tokenId,
              amount: hexAmount,
              user_data: null,
            },
          },
        });
        return {
          txHash: result.txHash,
          explorerUrl: `${EXPLORER_BASE}/${result.txHash}`,
        };
      } catch (err: unknown) {
        if (err instanceof FastError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('InsufficientFunding') || msg.includes('insufficient')) {
          throw new FastError('INSUFFICIENT_BALANCE', msg, {
            note: 'Fund your Fast wallet with SET or SETUSDC, then retry.',
          });
        }
        throw new FastError('TX_FAILED', msg, {
          note: 'Wait 5 seconds, then retry the send.',
        });
      }
    },

    async submit(params: {
      recipient: string;
      claim: Record<string, unknown>;
    }): Promise<{ txHash: string; certificate: unknown }> {
      ensureSetup();
      const senderPubkey = addressToPubkey(_address!);
      const recipientPubkey = addressToPubkey(params.recipient);

      try {
        return await withKey<{ txHash: string; certificate: unknown }>(
          _keyfilePath!,
          async (keypair) => {
            const accountInfo = (await fetchAccountInfo(senderPubkey)) as { next_nonce?: number } | null;

            const nonce = accountInfo?.next_nonce ?? 0;

            const transaction = {
              sender: senderPubkey,
              recipient: recipientPubkey,
              nonce,
              timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
              claim: params.claim as Parameters<typeof TransactionBcs.serialize>[0]['claim'],
              archival: false,
            };

            const msgHead = new TextEncoder().encode('Transaction::');
            const msgBody = TransactionBcs.serialize(transaction).toBytes();
            const msg = new Uint8Array(msgHead.length + msgBody.length);
            msg.set(msgHead, 0);
            msg.set(msgBody, msgHead.length);

            const signature = await signEd25519(msg, keypair.privateKey);
            const txHash = hashTransaction(transaction);

            const submitResult = await rpcCall(rpcUrl, 'proxy_submitTransaction', {
              transaction,
              signature: { Signature: signature },
            });

            const certificate = (submitResult as { Success?: unknown })?.Success ?? submitResult;

            return { txHash, certificate };
          },
        );
      } catch (err: unknown) {
        if (err instanceof FastError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('InsufficientFunding') || msg.includes('insufficient')) {
          throw new FastError('INSUFFICIENT_BALANCE', msg, {
            note: 'Fund your Fast wallet with SET or SETUSDC, then retry.',
          });
        }
        throw new FastError('TX_FAILED', msg, {
          note: 'Wait 5 seconds, then retry.',
        });
      }
    },

    async evmSign(params: {
      certificate: unknown;
    }): Promise<{ transaction: number[]; signature: string }> {
      const result = await rpcCall(rpcUrl, 'proxy_evmSignCertificate', {
        certificate: params.certificate,
      });
      const typed = result as { transaction?: number[]; signature?: string } | null;
      if (!typed?.transaction || !typed?.signature) {
        throw new FastError('TX_FAILED', 'proxy_evmSignCertificate returned invalid response', {
          note: 'The FastSet proxy failed to cross-sign the certificate.',
        });
      }
      return { transaction: typed.transaction, signature: typed.signature };
    },

    async sign(params: {
      message: string | Uint8Array;
    }): Promise<{ signature: string; address: string }> {
      ensureSetup();
      return await withKey(_keyfilePath!, async (kp) => {
        const pubkeyBytes = Buffer.from(kp.publicKey, 'hex');
        const words = bech32m.toWords(pubkeyBytes);
        const addr = bech32m.encode('fast', words);

        const msgBytes = typeof params.message === 'string'
          ? new TextEncoder().encode(params.message)
          : params.message;

        const sigBytes = await signEd25519(msgBytes, kp.privateKey);
        const signature = Buffer.from(sigBytes).toString('hex');

        return { signature, address: addr };
      });
    },

    async verify(params: {
      message: string | Uint8Array;
      signature: string;
      address: string;
    }): Promise<{ valid: boolean }> {
      try {
        const decoded = bech32m.decode(params.address, 90);
        const pubkeyBytes = bech32m.fromWords(decoded.words);
        const publicKeyHex = Buffer.from(new Uint8Array(pubkeyBytes)).toString('hex');
        const sigBytes = Buffer.from(params.signature, 'hex');
        const msgBytes = typeof params.message === 'string'
          ? new TextEncoder().encode(params.message)
          : params.message;
        const valid = await verifyEd25519(sigBytes, msgBytes, publicKeyHex);
        return { valid };
      } catch {
        return { valid: false };
      }
    },

    async tokens(): Promise<Array<{
      symbol: string;
      address: string;
      balance: string;
      decimals: number;
    }>> {
      ensureSetup();
      let pubkey: Uint8Array;
      try {
        pubkey = addressToPubkey(_address!);
      } catch {
        return [];
      }

      const result = (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
        address: pubkey,
        token_balances_filter: [],
        state_key_filter: null,
        certificate_by_nonce: null,
      })) as {
        balance?: string;
        token_balance?: Array<[number[], string]>;
      } | null;

      if (!result) return [];

      const tokens: Array<{ symbol: string; address: string; balance: string; decimals: number }> = [];

      // Native SET
      const nativeHex = result.balance ?? '0';
      tokens.push({
        symbol: DEFAULT_TOKEN,
        address: `0x${Buffer.from(SET_TOKEN_ID).toString('hex')}`,
        balance: fromHex(nativeHex, FAST_DECIMALS),
        decimals: FAST_DECIMALS,
      });

      // Custom tokens
      const customTokenIds: Uint8Array[] = [];
      const balanceMap = new Map<string, string>();
      if (result.token_balance && result.token_balance.length > 0) {
        for (const [tid, bal] of result.token_balance) {
          const tidBytes = new Uint8Array(tid);
          const tidHex = `0x${Buffer.from(tidBytes).toString('hex')}`;
          const rawBal = bal.startsWith('0x') || bal.startsWith('0X') ? bal.slice(2) : bal;
          balanceMap.set(tidHex, rawBal);
          customTokenIds.push(tidBytes);
        }
      }

      if (customTokenIds.length > 0) {
        try {
          const metaResult = (await rpcCall(rpcUrl, 'proxy_getTokenInfo', {
            token_ids: customTokenIds,
          })) as {
            requested_token_metadata?: Array<[number[], {
              token_name: string;
              decimals: number;
              total_supply: string;
              admin: number[];
              mints: number[][];
              update_id: number;
            } | null]>;
          } | null;

          if (metaResult?.requested_token_metadata) {
            for (const [tid, meta] of metaResult.requested_token_metadata) {
              const tidHex = `0x${Buffer.from(new Uint8Array(tid)).toString('hex')}`;
              const rawBal = balanceMap.get(tidHex) ?? '0';
              const dec = meta?.decimals ?? FAST_DECIMALS;
              tokens.push({
                symbol: meta?.token_name ?? tidHex,
                address: tidHex,
                balance: fromHex(rawBal, dec),
                decimals: dec,
              });
            }
          }
        } catch {
          for (const [tidHex, rawBal] of balanceMap) {
            tokens.push({
              symbol: tidHex,
              address: tidHex,
              balance: fromHex(rawBal, FAST_DECIMALS),
              decimals: FAST_DECIMALS,
            });
          }
        }
      }

      return tokens;
    },

    async tokenInfo(params: { token: string }): Promise<{
      name: string;
      symbol: string;
      address: string;
      decimals: number;
      totalSupply?: string;
      admin?: string;
      minters?: string[];
    }> {
      const tok = params.token;
      const upper = tok.toUpperCase();

      // Native SET token — RPC returns null for it, so handle locally
      const isSet = isNativeFastToken(tok)
        || (HEX_TOKEN_PATTERN.test(tok) && tokenIdEquals(hexToTokenId(tok), SET_TOKEN_ID));
      if (isSet) {
        return {
          name: 'SET',
          symbol: 'SET',
          address: `0x${Buffer.from(SET_TOKEN_ID).toString('hex')}`,
          decimals: FAST_DECIMALS,
        };
      }

      let tokenIdBytes: Uint8Array;
      if (HEX_TOKEN_PATTERN.test(tok)) {
        tokenIdBytes = hexToTokenId(tok);
      } else {
        const known = resolveKnownFastToken(tok);
        if (known) {
          tokenIdBytes = hexToTokenId(known.tokenId);
        } else {
          ensureSetup();
          const accountInfo = await fetchAccountInfo(addressToPubkey(_address!));
          const resolved = await resolveNamedToken(accountInfo, upper);
          if (!resolved) {
            throw new FastError('TOKEN_NOT_FOUND', `Token "${tok}" not found on Fast chain`, {
              note: 'Call setup() first for symbol lookup, or provide a valid hex token ID.\n  Example: await f.tokenInfo({ token: "0x1e74..." })',
            });
          }
          tokenIdBytes = resolved.tokenId;
        }
      }

      // Query on-chain metadata
      const result = (await rpcCall(rpcUrl, 'proxy_getTokenInfo', {
        token_ids: [tokenIdBytes],
      })) as FastTokenInfoResponse;

      const entry = result?.requested_token_metadata?.[0];
      if (!entry?.[1]) {
        throw new FastError('TOKEN_NOT_FOUND', `Token "${tok}" not found on Fast chain`, {
          note: 'Provide a held token symbol like "SETUSDC", or a valid hex token ID.\n  Example: await f.tokenInfo({ token: "0x1e74..." })',
        });
      }

      const [tokenIdRaw, meta] = entry;
      const tidHex = `0x${Buffer.from(new Uint8Array(tokenIdRaw)).toString('hex')}`;
      const name = meta.token_name ?? tok;
      const decimals = meta.decimals ?? FAST_DECIMALS;
      const admin = meta.admin
        ? `0x${Buffer.from(new Uint8Array(meta.admin)).toString('hex')}`
        : undefined;
      const minters = meta.mints?.map((m) => `0x${Buffer.from(new Uint8Array(m)).toString('hex')}`);

      return {
        name,
        symbol: name,
        address: tidHex,
        decimals,
        ...(meta.total_supply ? { totalSupply: meta.total_supply } : {}),
        ...(admin ? { admin } : {}),
        ...(minters ? { minters } : {}),
      };
    },

    async exportKeys(): Promise<{ publicKey: string; address: string }> {
      ensureSetup();
      const keypair = await loadKeyfile(_keyfilePath!);
      return {
        publicKey: keypair.publicKey,
        address: _address!,
      };
    },
  };

  return client;
}
