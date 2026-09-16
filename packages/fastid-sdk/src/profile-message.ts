export type AvatarOp =
  | { kind: "nochange" }
  | { kind: "set"; digest: Uint8Array }
  | { kind: "clear" };

export interface ProfileMessageFields {
  address: Uint8Array;
  network: string;
  displayName: string;
  bio: string;
  avatar: AvatarOp;
  expiry: bigint;
  serverNonce: Uint8Array;
}

const DOMAIN = new TextEncoder().encode("fastid-profile-v1");

export function displayNameOk(value: string): boolean {
  return [...value].length <= 64;
}

export function bioOk(value: string): boolean {
  return [...value].length <= 512;
}

function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function u64be(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  let remaining = value & 0xffff_ffff_ffff_ffffn;
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    arrays.reduce((length, array) => length + array.length, 0),
  );
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

/** Frozen §7d profile-message wire, byte-identical to the index implementation. */
export function encodeProfileMessage(
  fields: ProfileMessageFields,
): Uint8Array {
  const encoder = new TextEncoder();
  const network = encoder.encode(fields.network);
  const displayName = encoder.encode(fields.displayName);
  const bio = encoder.encode(fields.bio);
  if (network.length > 0xff) throw new Error("network too long");
  if (displayName.length > 0xffff) throw new Error("display_name too long");
  if (bio.length > 0xffff) throw new Error("bio too long");
  if (fields.address.length !== 32) throw new Error("address must be 32 bytes");
  if (fields.serverNonce.length !== 32) {
    throw new Error("server nonce must be 32 bytes");
  }
  if (fields.avatar.kind === "set" && fields.avatar.digest.length !== 32) {
    throw new Error("avatar digest must be 32 bytes");
  }

  const avatarFlag =
    fields.avatar.kind === "nochange" ? 0 : fields.avatar.kind === "set" ? 1 : 2;
  const digest =
    fields.avatar.kind === "set" ? fields.avatar.digest : new Uint8Array();
  return concat(
    DOMAIN,
    fields.address,
    new Uint8Array([network.length]),
    network,
    u16be(displayName.length),
    displayName,
    u16be(bio.length),
    bio,
    new Uint8Array([avatarFlag]),
    digest,
    u64be(fields.expiry),
    fields.serverNonce,
  );
}
