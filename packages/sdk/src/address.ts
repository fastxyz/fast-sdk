import { bech32m } from "bech32";
import { type BytesLike } from "./types";

export class Address {
  private addressBytes: Uint8Array;

  constructor(addressBytes: BytesLike) {
    this.addressBytes = addressBytes instanceof Uint8Array ? addressBytes : new Uint8Array(addressBytes);
  }

  get bytes(): Uint8Array {
    return this.addressBytes;
  }

  get bytesArray(): number[] {
    return Array.from(this.addressBytes);
  }

  toString(): string {
    return encodeAddressToBech32m(this.addressBytes);
  }

  static fromString(address: string): Address {
    const addressBytes = decodeAddressFromBech32m(address);
    return new Address(addressBytes);
  }
}

export function encodeAddressToBech32m(address: BytesLike): string {
  const prefix = "fast";
  const words = bech32m.toWords(address instanceof Uint8Array ? address : new Uint8Array(address));
  return bech32m.encode(prefix, words);
}

export function decodeAddressFromBech32m(address: string): Uint8Array {
  const { words } = bech32m.decode(address);
  const bytes = bech32m.fromWords(words);
  return new Uint8Array(bytes);
}