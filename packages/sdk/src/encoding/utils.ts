import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToPrefixedHex } from "../bytes";
import { BcsType } from "@mysten/bcs";

export function hashStruct<T>(type: BcsType<T>, struct: T): string {
    const data = type.serialize(struct).toBytes();
    return bytesToPrefixedHex(keccak_256(data));
}