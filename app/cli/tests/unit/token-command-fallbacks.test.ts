import { describe, expect, it } from 'vitest';
import { TOKEN_COMMAND_FALLBACKS } from '../../src/token-command-fallbacks.js';

describe('token command fallback metadata', () => {
  it.each(Object.entries(TOKEN_COMMAND_FALLBACKS))('%s recognizes and documents --replace-pending', (_command, metadata) => {
    expect(metadata.options).toContain('--replace-pending');
    expect(metadata.usage).toContain('[--replace-pending]');
  });
});
