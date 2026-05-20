export function detectDuplicateKeys(text: string): void {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"\s*:/g) ?? [];
  const keys = tokens.map((t) => t.slice(0, t.lastIndexOf(":")).trim());
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) throw new Error("duplicate JSON key");
    seen.add(k);
  }
}
