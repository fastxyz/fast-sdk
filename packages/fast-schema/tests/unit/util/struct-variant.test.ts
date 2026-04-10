import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { CamelCaseStruct } from '../../../src/util/struct.ts';
import { TypedVariant } from '../../../src/util/variant.ts';
import { decodeSync, encodeSync } from '../helpers.ts';

describe('CamelCaseStruct', () => {
  const TestStruct = CamelCaseStruct({
    token_id: Schema.String,
    recipient: Schema.String,
    user_data: Schema.Number,
  });

  it('decodes snake_case to camelCase', () => {
    const result = decodeSync(TestStruct, {
      token_id: 'abc',
      recipient: 'def',
      user_data: 42,
    });
    expect(result).toEqual({ tokenId: 'abc', recipient: 'def', userData: 42 });
  });

  it('encodes camelCase to snake_case', () => {
    const decoded = decodeSync(TestStruct, {
      token_id: 'abc',
      recipient: 'def',
      user_data: 42,
    });
    const encoded = encodeSync(TestStruct, decoded);
    expect(encoded).toEqual({
      token_id: 'abc',
      recipient: 'def',
      user_data: 42,
    });
  });

  it('passes through keys without underscores unchanged', () => {
    const result = decodeSync(TestStruct, {
      token_id: 'x',
      recipient: 'unchanged',
      user_data: 0,
    });
    expect(result).toHaveProperty('recipient', 'unchanged');
  });

  it('handles multiple underscores', () => {
    const Deep = CamelCaseStruct({
      some_long_name: Schema.String,
    });
    const result = decodeSync(Deep, { some_long_name: 'value' });
    expect(result).toEqual({ someLongName: 'value' });
  });

  it('round-trips', () => {
    const input = { token_id: 'abc', recipient: 'def', user_data: 99 };
    const decoded = decodeSync(TestStruct, input);
    const encoded = encodeSync(TestStruct, decoded);
    expect(encoded).toEqual(input);
  });
});

describe('TypedVariant (serde mode)', () => {
  const TestVariant = TypedVariant({
    Add: null,
    Remove: null,
    Transfer: Schema.Struct({ amount: Schema.Number }),
  });

  it('decodes unit variant from bare string', () => {
    const result = decodeSync(TestVariant, 'Add');
    expect(result).toEqual({ type: 'Add' });
  });

  it('encodes unit variant to bare string', () => {
    const decoded = decodeSync(TestVariant, 'Add');
    const encoded = encodeSync(TestVariant, decoded);
    expect(encoded).toBe('Add');
  });

  it('decodes data variant from keyed object', () => {
    const result = decodeSync(TestVariant, { Transfer: { amount: 100 } });
    expect(result).toEqual({ type: 'Transfer', value: { amount: 100 } });
  });

  it('encodes data variant to keyed object', () => {
    const decoded = decodeSync(TestVariant, { Transfer: { amount: 100 } });
    const encoded = encodeSync(TestVariant, decoded);
    expect(encoded).toEqual({ Transfer: { amount: 100 } });
  });

  it('round-trips unit variant', () => {
    const decoded = decodeSync(TestVariant, 'Remove');
    const encoded = encodeSync(TestVariant, decoded);
    expect(encoded).toBe('Remove');
    expect(decodeSync(TestVariant, encoded)).toEqual({ type: 'Remove' });
  });

  it('round-trips data variant', () => {
    const input = { Transfer: { amount: 42 } };
    const decoded = decodeSync(TestVariant, input);
    const encoded = encodeSync(TestVariant, decoded);
    expect(encoded).toEqual(input);
  });

  it('rejects unknown variant name', () => {
    expect(() => decodeSync(TestVariant, 'Unknown')).toThrow();
  });

  it('rejects unknown keyed variant', () => {
    expect(() => decodeSync(TestVariant, { Foo: {} })).toThrow();
  });

  it('rejects object with zero keys', () => {
    expect(() => decodeSync(TestVariant, {})).toThrow();
  });

  it('rejects object with two keys', () => {
    expect(() => decodeSync(TestVariant, { Add: null, Remove: null })).toThrow();
  });
});

describe('TypedVariant (bcs mode)', () => {
  const BcsVariant = TypedVariant(
    {
      Add: null,
      Remove: null,
      Transfer: Schema.Struct({ amount: Schema.Number }),
    },
    { unitEncoding: 'bcs' },
  );

  it('decodes bcs unit variant { Key: [] }', () => {
    const result = decodeSync(BcsVariant, { Add: [] });
    expect(result).toEqual({ type: 'Add' });
  });

  it('encodes unit variant to { Key: [] }', () => {
    const decoded = decodeSync(BcsVariant, { Add: [] });
    const encoded = encodeSync(BcsVariant, decoded);
    expect(encoded).toEqual({ Add: [] });
  });

  it('decodes data variant same as serde', () => {
    const result = decodeSync(BcsVariant, { Transfer: { amount: 50 } });
    expect(result).toEqual({ type: 'Transfer', value: { amount: 50 } });
  });

  it('encodes data variant same as serde', () => {
    const decoded = decodeSync(BcsVariant, { Transfer: { amount: 50 } });
    const encoded = encodeSync(BcsVariant, decoded);
    expect(encoded).toEqual({ Transfer: { amount: 50 } });
  });
});
