/**
 * Frozen canonical JSON profile used by AllSet claims.
 *
 * Values contain only strings, arrays, and objects. Object keys follow an
 * explicit layout, indentation is two spaces, line endings are LF, UTF-8 is
 * literal, and the document has no trailing newline.
 */

export type CanonicalValue = string | CanonicalValue[] | { [key: string]: CanonicalValue | undefined };

export type KeyLayout = {
  [key: string]: string[] | KeyLayout;
};

const encoder = new TextEncoder();

function escapeString(value: string): string {
  let output = '"';

  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);

    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error('canonical JSON: unpaired surrogate');
      }
      output += value[index] + value[index + 1];
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('canonical JSON: unpaired surrogate');
    }

    const character = value[index];
    if (character === '"') output += '\\"';
    else if (character === '\\') output += '\\\\';
    else if (unit === 0x08) output += '\\b';
    else if (unit === 0x09) output += '\\t';
    else if (unit === 0x0a) output += '\\n';
    else if (unit === 0x0c) output += '\\f';
    else if (unit === 0x0d) output += '\\r';
    else if (unit < 0x20) {
      output += `\\u${unit.toString(16).padStart(4, '0')}`;
    } else output += character;
  }

  return output + '"';
}

function write(value: CanonicalValue, order: string[] | KeyLayout | undefined, depth: number): string {
  if (typeof value === 'string') return escapeString(value);

  const indentation = '  '.repeat(depth);
  const childIndentation = '  '.repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const childOrder = order && !Array.isArray(order) ? order['*'] : undefined;
    return '[\n' + value.map((item) => childIndentation + write(item, childOrder, depth + 1)).join(',\n') + '\n' + indentation + ']';
  }

  if (value === null || typeof value !== 'object') {
    throw new Error('canonical JSON: every leaf must be a string, array, or object');
  }

  const keys = Array.isArray(order) ? order : order ? Object.keys(order).filter((key) => key !== '*') : Object.keys(value);
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length > 0) {
    throw new Error(`canonical JSON: keys without a layout position: ${extra.join(', ')}`);
  }

  const present = keys.filter((key) => value[key] !== undefined);
  if (present.length === 0) return '{}';

  return (
    '{\n' +
    present
      .map((key) => {
        const childOrder = order && !Array.isArray(order) ? order[key] : undefined;
        return childIndentation + escapeString(key) + ': ' + write(value[key] as CanonicalValue, childOrder, depth + 1);
      })
      .join(',\n') +
    '\n' +
    indentation +
    '}'
  );
}

export function canonicalJson(value: { [key: string]: CanonicalValue | undefined }, order: string[], layout: KeyLayout): Uint8Array {
  const topLevelLayout = Object.fromEntries(order.map((key) => [key, layout[key] ?? []])) as KeyLayout;

  return encoder.encode(write(value, topLevelLayout, 0));
}
