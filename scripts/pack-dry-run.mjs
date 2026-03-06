import { execFileSync } from 'node:child_process';
import path from 'node:path';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const workspaceDir = process.cwd();

execFileSync(npmCmd, ['pack', '--dry-run'], {
  cwd: workspaceDir,
  env: {
    ...process.env,
    NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? path.join(workspaceDir, '.npm-cache'),
  },
  stdio: 'inherit',
});
