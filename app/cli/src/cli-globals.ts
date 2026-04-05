import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NETWORKS_FILE = join(homedir(), '.fast', 'networks.json');

const readDefaultNetwork = (): string => {
  try {
    const content = readFileSync(NETWORKS_FILE, 'utf-8');
    const data = JSON.parse(content);
    return typeof data.default === 'string' ? data.default : 'testnet';
  } catch {
    return 'testnet';
  }
};

/**
 * Global flags that are spread into every leaf command's `args`.
 * Citty doesn't inherit args from parent commands, so we duplicate these
 * on each leaf to keep a single source of truth.
 */
export const globalArgs = {
  json: {
    type: 'boolean',
    description: 'Emit machine-parseable JSON to stdout',
    default: false,
  },
  debug: {
    type: 'boolean',
    description: 'Enable verbose logging to stderr',
    default: false,
  },
  'non-interactive': {
    type: 'boolean',
    description: 'Auto-confirm dangerous operations; fail when input is missing',
    default: false,
  },
  network: {
    type: 'string',
    description: 'Override the network for this command',
    default: readDefaultNetwork(),
  },
  account: {
    type: 'string',
    description: 'Use the named account for signing operations',
  },
  password: {
    type: 'string',
    description: 'Keystore password for decrypting the account key',
  },
} as const;

/** Shape of `args` after citty parses globalArgs. */
export interface GlobalArgsParsed {
  json: boolean;
  debug: boolean;
  'non-interactive': boolean;
  network: string;
  account?: string;
  password?: string;
}
