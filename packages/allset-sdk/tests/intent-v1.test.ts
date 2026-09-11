import assert from 'node:assert/strict';
import { test } from 'vitest';
import { canonicalJson } from '../src/canonical-json.ts';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test('canonicalJson writes fixed key order, two-space indentation, and no trailing newline', () => {
  const bytes = canonicalJson({ b: 'x', a: ['1', { c: '2' }] }, ['a', 'b'], { a: { '*': ['c'] } });

  assert.equal(decode(bytes), '{\n  "a": [\n    "1",\n    {\n      "c": "2"\n    }\n  ],\n  "b": "x"\n}');
});

test('canonicalJson rejects leaves that are not strings, arrays, or objects', () => {
  assert.throws(() => canonicalJson({ a: 1 as unknown as string }, ['a'], {}), /string/);
  assert.throws(() => canonicalJson({ a: null as unknown as string }, ['a'], {}), /string/);
});

test('canonicalJson escapes only JSON-required characters and keeps literal UTF-8', () => {
  const bytes = canonicalJson({ a: 'fast/xyz "q" é' }, ['a'], {});

  assert.equal(decode(bytes), '{\n  "a": "fast/xyz \\"q\\" é"\n}');
});
