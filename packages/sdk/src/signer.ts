
import { BcsType } from '@mysten/bcs';
import * as ed from '@noble/ed25519';
import { Address } from './address';
import { bytesToPrefixedHex, hexToBytes } from './bytes';
import { type BytesLike } from './types';

function buildTypedDataMessage<T>(type: BcsType<T>, data: T): Uint8Array {
    const prefix = new TextEncoder().encode(type.name + '::');
    const body = type.serialize(data).toBytes();
    const msg = new Uint8Array(prefix.length + body.length);
    msg.set(prefix, 0);
    msg.set(body, prefix.length);
    return msg;
}

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

    async signTypedData<T>(type: BcsType<T>, data: T): Promise<Uint8Array> {
        const signature = await this.signMessage(buildTypedDataMessage(type, data));
        return signature;
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

    static async verifyTypedData<T>(
        signature: BytesLike,
        type: BcsType<T>,
        data: T,
        pubkeyOrAddress: BytesLike | string | Address,
    ): Promise<boolean> {
        return await Signer.verify(signature, buildTypedDataMessage(type, data), pubkeyOrAddress);
    }


}
