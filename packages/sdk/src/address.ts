import { bech32m } from "bech32";

export class Address {
  private addressBytes: Uint8Array;

  constructor(addressBytes: Uint8Array) {
    this.addressBytes = addressBytes;
  }

  get bytes(): Uint8Array {
    return this.addressBytes;
  }

  toString(): string {
    return encodeAddressToBech32m(this.addressBytes);
  }

  static fromString(address: string): Address {
    const addressBytes = decodeAddressFromBech32m(address);
    return new Address(addressBytes);
  }

  toArray(): number[] {
    return Array.from(this.addressBytes);
  }
}

export function encodeAddressToBech32m(address: Uint8Array): string {
  const prefix = "fast";
  const words = bech32m.toWords(address);
  return bech32m.encode(prefix, words);
}

export function decodeAddressFromBech32m(address: string): Uint8Array {
  const { words } = bech32m.decode(address);
  const bytes = bech32m.fromWords(words);
  return new Uint8Array(bytes);
}