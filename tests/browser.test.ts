import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  FastProvider,
  clearDefaultsCache,
} from '../src/browser.js';

function collectBrowserGraph(entryFile: string): string[] {
  const visited = new Set<string>();

  function visit(filePath: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const source = fs.readFileSync(filePath, 'utf8');
    const importRegex = /from ['"](\.[^'"]+)['"]/g;
    for (const match of source.matchAll(importRegex)) {
      const specifier = match[1];
      const resolved = path.resolve(path.dirname(filePath), specifier);
      const candidateTs = resolved.replace(/\.js$/, '.ts');
      if (fs.existsSync(candidateTs)) {
        visit(candidateTs);
      }
    }
  }

  visit(entryFile);
  return [...visited];
}

afterEach(() => {
  clearDefaultsCache();
});

describe('browser entrypoint', () => {
  it('stays free of node: imports and Buffer in the reachable source graph', () => {
    const files = collectBrowserGraph(path.resolve(process.cwd(), 'src/browser.ts'));
    assert.ok(files.length > 0);
    for (const filePath of files) {
      const source = fs.readFileSync(filePath, 'utf8');
      assert.equal(source.includes('node:'), false, `Unexpected node import in ${filePath}`);
      assert.equal(source.includes('Buffer'), false, `Unexpected Buffer usage in ${filePath}`);
    }
  });

  it('loads provider config from constructor overrides in browser mode', async () => {
    const provider = new FastProvider({
      network: 'custom',
      networks: {
        custom: {
          rpc: 'https://custom.example.com/proxy',
          explorer: 'https://custom.example.com/explorer',
        },
      },
      tokens: {
        CUSTOM: {
          symbol: 'CUSTOM',
          tokenId: '0x1234',
          decimals: 4,
        },
      },
    });

    assert.equal(await provider.getExplorerUrl(), 'https://custom.example.com/explorer');
    const token = await provider.resolveKnownToken('custom');
    assert.deepEqual(token, {
      symbol: 'CUSTOM',
      tokenId: '0x1234',
      decimals: 4,
    });
  });
});
