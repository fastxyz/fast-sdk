
import * as ed from '@noble/ed25519';
import { hexToBytes, bytesToPrefixedHex } from './bytes';
import { Address } from './address';
import { VersionedTransaction as IVersionedTransaction } from './encoding/types';
import { serializeVersionedTransaction, hashTransaction, VersionedTransaction } from './encoding/schema';
import { type BytesLike } from './types';

export class Signer {
    private readonly _privateKey: Uint8Array;
    private _pubKey?: Uint8Array;

    constructor(privateKey: string | Uint8Array) {
        this._privateKey =
            typeof privateKey === 'string'
                ? hexToBytes(privateKey.replace(/^0x/i, ''))
                : new Uint8Array(privateKey);
    }

    get privateKey(): string {
        return bytesToPrefixedHex(this._privateKey);
    }

    async getPublicKey(): Promise<Uint8Array> {
        return (this._pubKey ??= await ed.getPublicKeyAsync(this._privateKey));
    }

    async getPublicKeyHex(): Promise<string> {
        return bytesToPrefixedHex(await this.getPublicKey());
    }

    async getAddress(): Promise<Address> {
        return new Address(await this.getPublicKey());
    }

    async signMessage(message: BytesLike): Promise<Uint8Array> {
        return await ed.signAsync(message instanceof Uint8Array ? message : new Uint8Array(message), this._privateKey);
    }

    async signTransaction(versionedTransaction: IVersionedTransaction): Promise<[string, Uint8Array]> {
        const prefix = new TextEncoder().encode(VersionedTransaction.name + '::');
        const body = serializeVersionedTransaction(versionedTransaction);
        const msg = new Uint8Array(prefix.length + body.length);
        msg.set(prefix, 0);
        msg.set(body, prefix.length);
        const signature = await this.signMessage(msg);
        return [hashTransaction(versionedTransaction), signature];
    }

    static async verify(
        signature: BytesLike,
        message: BytesLike,
        pubkeyOrAddress: BytesLike | string | Address,
    ): Promise<boolean> {
        try {
            const pubkey =
                pubkeyOrAddress instanceof Address ? pubkeyOrAddress.bytes
                    : typeof pubkeyOrAddress === 'string' ? Address.fromString(pubkeyOrAddress).bytes
                        : pubkeyOrAddress;
            return await ed.verifyAsync(signature instanceof Uint8Array ? signature : new Uint8Array(signature), message instanceof Uint8Array ? message : new Uint8Array(message), pubkey instanceof Uint8Array ? pubkey : new Uint8Array(pubkey));
        } catch {
            return false;
        }
    }

    static async verifyTransaction(
        signature: BytesLike,
        versionedTransaction: IVersionedTransaction,
        pubkeyOrAddress: BytesLike | string | Address,
    ): Promise<boolean> {
        const prefix = new TextEncoder().encode(VersionedTransaction.name + '::');
        const body = serializeVersionedTransaction(versionedTransaction);
        const msg = new Uint8Array(prefix.length + body.length);
        msg.set(prefix, 0);
        msg.set(body, prefix.length);
        return await Signer.verify(signature, msg, pubkeyOrAddress);
    }
}
