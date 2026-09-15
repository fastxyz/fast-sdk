import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { toHex } from "../src/address.js";
import { encodeProfileMessage, type AvatarOp } from "../src/profile-message.js";
import { hexToBytes } from "../src/verify.js";

interface ProfileFixtureCase {
  id: string;
  fields: {
    addressHex: string;
    network: string;
    displayName: string;
    bio: string;
    avatar:
      | { kind: "nochange" | "clear" }
      | { kind: "set"; digestHex: string };
    expiry: string;
    serverNonceHex: string;
  };
  hex: string;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/parity/profile-message.json", import.meta.url),
    ),
    "utf8",
  ),
) as { cases: ProfileFixtureCase[] };

describe("profile-message parity with the web writer", () => {
  it.each(fixture.cases)("matches $id byte-for-byte", ({ fields, hex }) => {
    const avatar: AvatarOp =
      fields.avatar.kind === "set"
        ? { kind: "set", digest: hexToBytes(fields.avatar.digestHex) }
        : { kind: fields.avatar.kind };
    expect(
      toHex(
        encodeProfileMessage({
          address: hexToBytes(fields.addressHex),
          network: fields.network,
          displayName: fields.displayName,
          bio: fields.bio,
          avatar,
          expiry: BigInt(fields.expiry),
          serverNonce: hexToBytes(fields.serverNonceHex),
        }),
      ),
    ).toBe(hex);
  });
});
