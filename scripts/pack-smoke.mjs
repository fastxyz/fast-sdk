import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const workspaceDir = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fast-sdk-pack-smoke-'));
const npmEnv = {
  ...process.env,
  NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? path.join(workspaceDir, '.npm-cache'),
};

let tarballPath = '';

try {
  const packJson = execFileSync(npmCmd, ['pack', '--json'], {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: npmEnv,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const packResult = JSON.parse(packJson);
  const tarballName = Array.isArray(packResult) ? packResult[0]?.filename : null;
  if (!tarballName) {
    throw new Error('npm pack --json did not return a tarball filename');
  }

  tarballPath = path.join(workspaceDir, tarballName);
  writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'fast-sdk-pack-smoke',
      private: true,
      type: 'module',
    }, null, 2),
    'utf8',
  );

  execFileSync(npmCmd, ['install', tarballPath], {
    cwd: tempDir,
    env: npmEnv,
    stdio: 'inherit',
  });

  const installedManifestPath = path.join(tempDir, 'node_modules', '@fastxyz', 'sdk', 'package.json');
  const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'));
  if (installedManifest.name !== '@fastxyz/sdk') {
    throw new Error(`Unexpected installed package name: ${installedManifest.name}`);
  }

  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      'const root = await import("@fastxyz/sdk"); const browser = await import("@fastxyz/sdk/browser"); const core = await import("@fastxyz/sdk/core"); if (typeof root.FastProvider !== "function") throw new Error("FastProvider export missing"); if (typeof root.FastWallet !== "function") throw new Error("FastWallet export missing"); if (typeof root.FastError !== "function") throw new Error("FastError export missing"); if ("FastBrowserWallet" in root) throw new Error("Root entrypoint should not expose FastBrowserWallet"); if (!(root.FAST_TOKEN_ID instanceof Uint8Array)) throw new Error("Root FAST_TOKEN_ID export missing"); if (typeof root.hashTransaction !== "function") throw new Error("Root hashTransaction export missing"); if (typeof root.encodeFastAddress !== "function") throw new Error("Root encodeFastAddress export missing"); if (typeof root.fastAddressToBytes !== "function") throw new Error("Root fastAddressToBytes export missing"); if (typeof root.decodeFastAddress !== "function") throw new Error("Root decodeFastAddress export missing"); if ("getCertificateHash" in root) throw new Error("Root entrypoint should stay Node-oriented and not expose browser helper extras"); if (typeof browser.FastProvider !== "function") throw new Error("Browser FastProvider export missing"); if ("FastWallet" in browser) throw new Error("Browser entrypoint should stay low-level"); if (!(browser.FAST_TOKEN_ID instanceof Uint8Array)) throw new Error("Browser FAST_TOKEN_ID export missing"); if (typeof browser.encodeFastAddress !== "function") throw new Error("Browser encodeFastAddress export missing"); if (typeof browser.fastAddressToBytes !== "function") throw new Error("Browser fastAddressToBytes export missing"); if (typeof browser.decodeFastAddress !== "function") throw new Error("Browser decodeFastAddress export missing"); if (typeof browser.getCertificateHash !== "function") throw new Error("Browser getCertificateHash export missing"); if (typeof core.encodeFastAddress !== "function") throw new Error("Core encodeFastAddress export missing"); if (typeof core.getCertificateHash !== "function") throw new Error("Core getCertificateHash export missing"); if ("FastProvider" in core) throw new Error("Core entrypoint should not expose FastProvider"); if ("FastWallet" in core) throw new Error("Core entrypoint should not expose FastWallet");',
    ],
    {
      cwd: tempDir,
      stdio: 'inherit',
    },
  );
} finally {
  if (tarballPath) {
    unlinkSync(tarballPath);
  }
  rmSync(tempDir, { recursive: true, force: true });
}
