const LABEL = /^[a-z0-9_]{1,15}$/;

export const RESERVED_LABELS = new Set([
  "api",
  "admin",
  "www",
  "id",
  "app",
  "assets",
  "static",
  "_next",
  "favicon",
  "robots",
]);

const ADDRESS = /^fast1[023456789acdefghjklmnpqrstuvwxyz]{20,90}$/;

export function isCanonicalName(input: string): boolean {
  if (input !== input.toLowerCase()) return false;
  const parts = input.split(".");
  if (parts.length !== 2) return false;
  return parts.every((part) => LABEL.test(part) && !RESERVED_LABELS.has(part));
}

export function isFastAddress(input: string): boolean {
  return ADDRESS.test(input);
}

export type Query =
  | { kind: "name"; value: string }
  | { kind: "address"; value: string }
  | { kind: "invalid"; value: string };

export function classifyQuery(raw: string): Query {
  const value = raw.trim().toLowerCase();
  if (isCanonicalName(value)) return { kind: "name", value };
  if (isFastAddress(value)) return { kind: "address", value };
  return { kind: "invalid", value };
}
