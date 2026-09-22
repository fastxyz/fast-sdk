export type RequestedTokenMetadataEntry<T> = readonly [Uint8Array, T | null];

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

<<<<<<< HEAD
/** Return metadata only when the response contains one unambiguous row for the requested token. */
=======
/** Return metadata only when exactly one row matches the requested token. */
>>>>>>> eddd104 (fix(cli): correlate token metadata by id)
export function findRequestedTokenMetadata<T>(
  entries: ReadonlyArray<RequestedTokenMetadataEntry<T>> | undefined,
  tokenId: Uint8Array,
): T | null {
  const matches = (entries ?? []).filter(([id]) => sameBytes(id, tokenId));
  if (matches.length !== 1) return null;
  return matches[0]![1];
}
