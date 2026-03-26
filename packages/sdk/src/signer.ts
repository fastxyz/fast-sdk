
import * as ed from '@noble/ed25519';
import { hexToBytes, bytesToPrefixedHex, stringToBytes } from './bytes';
import { serializeVersionedTransaction, type FastTransaction } from './bcs';
import { Address } from './address';

export class Signer {
    private readonly _privKey: Uint8Array;
    private _pubKey?: Uint8Array;

    constructor(privateKey: string | Uint8Array) {
        this._privKey =
            typeof privateKey === 'string'
                ? hexToBytes(privateKey.replace(/^0x/i, ''))
                : new Uint8Array(privateKey);
    }

    get privateKey(): string {
        return bytesToPrefixedHex(this._privKey);
    }

    async getPublicKey(): Promise<Uint8Array> {
        return (this._pubKey ??= await ed.getPublicKeyAsync(this._privKey));
    }

    async getPublicKeyHex(): Promise<string> {
        return bytesToPrefixedHex(await this.getPublicKey());
    }

    async getAddress(): Promise<Address> {
        return new Address(await this.getPublicKey());
    }

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
        return ed.signAsync(message, this._privKey);
    }

    async signTransaction(transaction: FastTransaction): Promise<Uint8Array> {
        const prefix = stringToBytes('VersionedTransaction::');
        const body = serializeVersionedTransaction(transaction);
        const msg = new Uint8Array(prefix.length + body.length);
        msg.set(prefix, 0);
        msg.set(body, prefix.length);
        return this.signMessage(msg);
    }

    /**
     * Verify an Ed25519 signature.
     *
     * @param signature - 64-byte Ed25519 signature
     * @param message   - Original signed message bytes
     * @param pubkeyOrAddress - 32-byte public key, or a `fast...` bech32m address string, or an Address instance
     * @returns true if valid, false otherwise (never throws)
     */
    static async verify(
        signature: Uint8Array,
        message: Uint8Array,
        pubkeyOrAddress: Uint8Array | string | Address,
    ): Promise<boolean> {
        try {
            const pubkey =
                pubkeyOrAddress instanceof Address ? pubkeyOrAddress.bytes
                : typeof pubkeyOrAddress === 'string' ? Address.fromString(pubkeyOrAddress).bytes
                : pubkeyOrAddress;
            return await ed.verifyAsync(signature, message, pubkey);
        } catch {
            return false;
        }
    }
}
