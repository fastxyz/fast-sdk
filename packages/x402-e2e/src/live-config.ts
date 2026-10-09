import { mainnet } from '@fastxyz/sdk/networks';

export function requireMatrixGate(env: NodeJS.ProcessEnv, completed: number): void {
  if (env.X402_LIVE_MATRIX !== '1') throw new Error('X402_LIVE_MATRIX=1 is required for the release gate');
  if (completed !== 8) throw new Error('The release gate requires all eight successful live payments');
}

export function readLiveConfig(env: NodeJS.ProcessEnv) {
  if (env.X402_LIVE_MATRIX !== '1') return null;
  if (env.X402_MAINNET_SPENDING !== '1') throw new Error('X402_MAINNET_SPENDING=1 is required to authorize real mainnet spending');
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
  const fastRpcUrl = required('FAST_MAINNET_RPC_URL');
  if (fastRpcUrl !== mainnet.url) throw new Error('FAST_MAINNET_RPC_URL must match the SDK pinned mainnet URL');
  const evmRpcUrl = required('BASE_RPC_URL');
  if (new URL(evmRpcUrl).protocol !== 'https:') throw new Error('Base RPC must use HTTPS');
  const gasBudget = required('X402_MAX_FACILITATOR_ETH_WEI');
  if (!/^\d+$/.test(gasBudget) || BigInt(gasBudget) === 0n) throw new Error('Facilitator gas budget must be positive wei');
  if (required('X402_CONTROLLED_RECIPIENTS') !== '1') throw new Error('Confirm operator-controlled recipients with X402_CONTROLLED_RECIPIENTS=1');
  const config = {
    fastRpcUrl,
    evmRpcUrl,
    maxFacilitatorEthWei: BigInt(gasBudget),
    fastPayerKey: key('FAST_MAINNET_SIGNER_PRIVATE_KEY'),
    fastRecipientKey: key('FAST_MAINNET_RECIPIENT_PRIVATE_KEY'),
    evmPayerKey: key('BASE_PAYER_PRIVATE_KEY'),
    evmRecipientKey: key('BASE_RECIPIENT_PRIVATE_KEY'),
    evmFacilitatorKey: key('BASE_FACILITATOR_PRIVATE_KEY'),
  };
  if (
    config.fastPayerKey.toLowerCase() === config.fastRecipientKey.toLowerCase() ||
    config.evmPayerKey.toLowerCase() === config.evmRecipientKey.toLowerCase() ||
    config.evmPayerKey.toLowerCase() === config.evmFacilitatorKey.toLowerCase()
  ) {
    throw new Error('Payer must be distinct from recipient and facilitator');
  }
  return config;
}
