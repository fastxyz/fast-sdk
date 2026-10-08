import { testnet } from '@fastxyz/sdk/networks';

export function requireMatrixGate(env: NodeJS.ProcessEnv, completed: number): void {
  if (env.X402_LIVE_MATRIX !== '1') throw new Error('X402_LIVE_MATRIX=1 is required for the release gate');
  if (completed !== 8) throw new Error('The release gate requires all eight successful live payments');
}

export function readLiveConfig(env: NodeJS.ProcessEnv) {
  if (env.X402_LIVE_MATRIX !== '1') return null;
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for the live matrix`);
    return value;
  };
  const key = (name: string): `0x${string}` => {
    const value = required(name).replace(/^0x/, '');
    if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte private key`);
    return `0x${value}`;
  };
  const fastRpcUrl = required('FAST_TEST_RPC_URL');
  if (fastRpcUrl !== testnet.url) throw new Error('FAST_TEST_RPC_URL must match the SDK pinned testnet URL');
  const baseRpcUrl = required('BASE_SEPOLIA_RPC_URL');
  if (new URL(baseRpcUrl).protocol !== 'https:') throw new Error('Base Sepolia RPC must use HTTPS');
  const committeePublicKeys = required('FAST_TEST_COMMITTEE_PUBLIC_KEYS')
    .split(',')
    .map((v) => v.trim());
  if (committeePublicKeys.some((v) => !/^(?:0x)?[a-fA-F0-9]{64}$/.test(v)))
    throw new Error('Trusted committee keys must be nonempty 32-byte hex keys');
  const gasBudget = required('X402_MAX_FACILITATOR_ETH_WEI');
  if (!/^\d+$/.test(gasBudget) || BigInt(gasBudget) === 0n) throw new Error('Facilitator gas budget must be positive wei');
  if (required('X402_CONTROLLED_RECIPIENTS') !== '1') throw new Error('Confirm operator-controlled recipients with X402_CONTROLLED_RECIPIENTS=1');
  const config = {
    fastRpcUrl,
    baseRpcUrl,
    committeePublicKeys,
    maxFacilitatorEthWei: BigInt(gasBudget),
    fastPayerKey: key('FAST_TEST_SIGNER_PRIVATE_KEY'),
    fastRecipientKey: key('FAST_TEST_RECIPIENT_PRIVATE_KEY'),
    evmPayerKey: key('BASE_SEPOLIA_PAYER_PRIVATE_KEY'),
    evmRecipientKey: key('BASE_SEPOLIA_RECIPIENT_PRIVATE_KEY'),
    evmFacilitatorKey: key('BASE_SEPOLIA_FACILITATOR_PRIVATE_KEY'),
  };
  if (
    config.fastPayerKey.toLowerCase() === config.fastRecipientKey.toLowerCase() ||
    new Set([config.evmPayerKey, config.evmRecipientKey, config.evmFacilitatorKey].map((v) => v.toLowerCase())).size !== 3
  ) {
    throw new Error('Payer, recipient and facilitator wallets must be distinct');
  }
  return config;
}
