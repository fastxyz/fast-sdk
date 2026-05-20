const URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeBase64Url(text: string): Uint8Array {
  if (!URL_ALPHABET.test(text)) {
    throw new Error("Invalid base64url: disallowed characters");
  }
  if (text.includes("=")) {
    throw new Error("Invalid base64url: padding not allowed");
  }
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  if (remainder === 1) {
    throw new Error("Invalid base64url: bad length");
  }
  const full = remainder === 0 ? padded : padded + "=".repeat(4 - remainder);
  const binary = atob(full);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
