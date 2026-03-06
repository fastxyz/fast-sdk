/**
 * keys.ts — Key management for money SDK
 *
 * SECURITY INVARIANT: Private keys MUST NEVER appear in any return value,
 * log, error message, or console output (except the internal generate/load
 * functions that return them for immediate use by withKey).
 */
/**
 * Generate an ed25519 keypair.
 * Internal — callers should prefer withKey().
 */
export declare function generateEd25519Key(): Promise<{
    publicKey: string;
    privateKey: string;
}>;
/**
 * Load a keyfile from disk.
 * Expands `~` in the path.
 */
export declare function loadKeyfile(path: string): Promise<{
    publicKey: string;
    privateKey: string;
}>;
/**
 * Save a keypair to a keyfile.
 * Creates parent directories with mode 0700 and writes the file with mode 0600.
 *
 * Uses O_CREAT | O_WRONLY | O_EXCL so the call **fails** if the file already
 * exists.  This prevents any code path from accidentally overwriting a wallet
 * private key.
 *
 * After writing, a backup copy is created at `<dir>/backups/<name>` so keys
 * can be recovered even if the primary file is accidentally deleted.
 */
export declare function saveKeyfile(keyPath: string, keypair: {
    publicKey: string;
    privateKey: string;
}): Promise<void>;
/**
 * Sign a message with ed25519.
 */
export declare function signEd25519(message: Uint8Array, privateKeyHex: string): Promise<Uint8Array>;
/**
 * Verify an Ed25519 signature.
 * Returns true if the signature is valid for the given message and public key.
 */
export declare function verifyEd25519(signature: Uint8Array, message: Uint8Array, publicKeyHex: string): Promise<boolean>;
/**
 * Load a keypair, run `fn` with it, then zero out the private key from memory.
 * This is the primary way adapters should access keys.
 */
export declare function withKey<T>(keyfilePath: string, fn: (keypair: {
    publicKey: string;
    privateKey: string;
}) => Promise<T>): Promise<T>;
//# sourceMappingURL=keys.d.ts.map