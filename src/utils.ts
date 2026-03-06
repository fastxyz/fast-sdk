/**
 * utils.ts — Shared utilities for money SDK
 *
 * Decimal/amount conversion and path helpers.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function isWritableDirectory(dir: string): boolean {
  try {
    const stats = fs.statSync(dir);
    if (!stats.isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    const probeName = `.money-write-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const probePath = path.join(dir, probeName);
    fs.writeFileSync(probePath, 'ok', { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    fs.rmSync(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function ensureWritableDirectory(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a writable home directory.
 * Falls back to a temp directory when HOME/os.homedir() are unavailable.
 */
export function resolveHomeDir(): string {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const rawHome = process.env.HOME;
  if (typeof rawHome === 'string' && rawHome.trim().length > 0) {
    const resolved = path.resolve(rawHome);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      candidates.push(resolved);
    }
  }

  try {
    const osHome = os.homedir();
    if (typeof osHome === 'string' && osHome.trim().length > 0) {
      const resolved = path.resolve(osHome);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        candidates.push(resolved);
      }
    }
  } catch {
    // Ignore and continue to fallback.
  }

  for (const candidate of candidates) {
    if (isWritableDirectory(candidate)) {
      return candidate;
    }
  }

  const tmpFallback = path.join(os.tmpdir(), '.money-home');
  if (ensureWritableDirectory(tmpFallback)) {
    return tmpFallback;
  }

  const cwdFallback = path.resolve('.money-home');
  ensureWritableDirectory(cwdFallback);
  return cwdFallback;
}

/**
 * Expand `~` in a path string to the user's home directory.
 */
export function expandHome(p: string): string {
  const home = resolveHomeDir();
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(home, p.slice(2));
  }
  return path.resolve(p);
}

/** Convert human-readable decimal (e.g. "1.5") to raw bigint */
export function toRaw(humanAmount: string, decimals: number): bigint {
  // Normalise scientific notation (e.g. "1e18" → "1000000000000000000")
  // parseFloat handles it; toFixed gives us a decimal string BigInt can parse.
  const normalised = humanAmount.includes('e') || humanAmount.includes('E')
    ? parseFloat(humanAmount).toFixed(decimals)
    : humanAmount;
  const [intPart, fracPart = ''] = normalised.split('.');
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart) * BigInt(10) ** BigInt(decimals) + BigInt(paddedFrac);
}

/** Convert raw amount to human-readable decimal */
export function toHuman(rawAmount: bigint | number | string, decimals: number): string {
  const raw = BigInt(rawAmount);
  const divisor = BigInt(10) ** BigInt(decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  if (fracPart === 0n) return intPart.toString();
  const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${intPart}.${fracStr}`;
}

/** Convert human-readable decimal to hex string (for Fast protocol) */
export function toHex(humanAmount: string, decimals: number): string {
  return toRaw(humanAmount, decimals).toString(16);
}

/** Convert hex string to human-readable decimal (for Fast protocol) */
export function fromHex(hexAmount: string, decimals: number): string {
  if (!hexAmount || hexAmount === '0') return '0';
  return toHuman(BigInt(`0x${hexAmount}`), decimals);
}

/**
 * Compare two decimal number strings without floating-point precision loss.
 * Normalises both strings to the same number of decimal places, converts to
 * BigInt, and compares. Returns -1, 0, or 1.
 */
export function compareDecimalStrings(a: string, b: string): number {
  const [aInt, aFrac = ''] = a.split('.');
  const [bInt, bFrac = ''] = b.split('.');
  const maxFrac = Math.max(aFrac.length, bFrac.length);
  const aRaw = BigInt(aInt + aFrac.padEnd(maxFrac, '0'));
  const bRaw = BigInt(bInt + bFrac.padEnd(maxFrac, '0'));
  if (aRaw < bRaw) return -1;
  if (aRaw > bRaw) return 1;
  return 0;
}
