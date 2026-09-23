import { fromFastAddress, toFastAddress } from "@fastxyz/sdk";

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function abbreviateFastAddress(address: string): string {
  return address.length <= 16
    ? address
    : `${address.slice(0, 9)}…${address.slice(-4)}`;
}

export function isCanonicalFastAddress(address: string): boolean {
  try {
    const bytes = fromFastAddress(address);
    return bytes.byteLength === 32 && toFastAddress(bytes) === address;
  } catch {
    return false;
  }
}

export function isConnectedOwner(
  profileAddress: string,
  sessionAddress: string | undefined,
): boolean {
  if (!sessionAddress) return false;
  try {
    const bytes = fromFastAddress(sessionAddress);
    return bytes.byteLength === 32 && toFastAddress(bytes) === profileAddress;
  } catch {
    return false;
  }
}

/** The lowercase 64-hex public key required by the registration wire. */
export function signerHexOf(account: {
  address: string;
  publicKey?: string;
}): string {
  if (account.publicKey) {
    const hex = account.publicKey.replace(/^0x/i, "").toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hex)) return hex;
  }
  return toHex(fromFastAddress(account.address));
}

/** Convert a stored signer public key to its canonical `fast1…` address. */
export function fastAddressFromSignerHex(hex: unknown): string | null {
  if (typeof hex !== "string") return null;
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) return null;
  try {
    const bytes = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) {
      bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    }
    return toFastAddress(bytes);
  } catch {
    return null;
  }
}
