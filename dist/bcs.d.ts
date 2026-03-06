/**
 * bcs.ts — BCS schema definitions for Fast chain transactions
 *
 * Must match on-chain types exactly.
 */
export declare const TransactionBcs: import("@mysten/bcs").BcsStruct<{
    sender: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike>, Iterable<number>, "bytes[32]">;
    recipient: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike>, Iterable<number>, "bytes[32]">;
    nonce: import("@mysten/bcs").BcsType<string, string | number | bigint, "u64">;
    timestamp_nanos: import("@mysten/bcs").BcsType<string, string | number | bigint, "u128">;
    claim: import("@mysten/bcs").BcsEnum<{
        TokenTransfer: import("@mysten/bcs").BcsStruct<{
            token_id: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike>, Iterable<number>, "bytes[32]">;
            amount: import("@mysten/bcs").BcsType<string, string, "u256">;
            user_data: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike> | null, Iterable<number> | null | undefined, "Option<bytes[32]>">;
        }, string>;
        TokenCreation: import("@mysten/bcs").BcsStruct<{
            token_name: import("@mysten/bcs").BcsType<string, string, "string">;
            decimals: import("@mysten/bcs").BcsType<number, number, "u8">;
            initial_amount: import("@mysten/bcs").BcsType<string, string, "u256">;
            mints: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike>[], Iterable<Iterable<number>> & {
                length: number;
            }, string>;
            user_data: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike> | null, Iterable<number> | null | undefined, "Option<bytes[32]>">;
        }, string>;
        TokenManagement: import("@mysten/bcs").BcsStruct<{
            token_id: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike>, Iterable<number>, "bytes[32]">;
            update_id: import("@mysten/bcs").BcsType<string, string | number | bigint, "u64">;
            new_admin: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike> | null, Iterable<number> | null | undefined, "Option<bytes[32]>">;
            mints: import("@mysten/bcs").BcsType<[import("@mysten/bcs").EnumOutputShapeWithKeys<{
                Add: [];
                Remove: [];
            }, "Add" | "Remove">, Uint8Array<ArrayBufferLike>][], Iterable<readonly [import("@mysten/bcs").EnumInputShape<{
                Add: readonly [];
                Remove: readonly [];
            }>, Iterable<number>]> & {
                length: number;
            }, string>;
            user_data: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike> | null, Iterable<number> | null | undefined, "Option<bytes[32]>">;
        }, string>;
        Mint: import("@mysten/bcs").BcsStruct<{
            token_id: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike>, Iterable<number>, "bytes[32]">;
            amount: import("@mysten/bcs").BcsType<string, string, "u256">;
        }, string>;
        StateInitialization: import("@mysten/bcs").BcsStruct<{
            dummy: import("@mysten/bcs").BcsType<number, number, "u8">;
        }, string>;
        StateUpdate: import("@mysten/bcs").BcsStruct<{
            dummy: import("@mysten/bcs").BcsType<number, number, "u8">;
        }, string>;
        ExternalClaim: import("@mysten/bcs").BcsStruct<{
            claim: import("@mysten/bcs").BcsStruct<{
                verifier_committee: import("@mysten/bcs").BcsType<Uint8Array<ArrayBufferLike>[], Iterable<Iterable<number>> & {
                    length: number;
                }, string>;
                verifier_quorum: import("@mysten/bcs").BcsType<string, string | number | bigint, "u64">;
                claim_data: import("@mysten/bcs").BcsType<number[], Iterable<number> & {
                    length: number;
                }, string>;
            }, string>;
            signatures: import("@mysten/bcs").BcsType<[Uint8Array<ArrayBufferLike>, Uint8Array<ArrayBufferLike>][], Iterable<readonly [Iterable<number>, Iterable<number>]> & {
                length: number;
            }, string>;
        }, string>;
        StateReset: import("@mysten/bcs").BcsStruct<{
            dummy: import("@mysten/bcs").BcsType<number, number, "u8">;
        }, string>;
        JoinCommittee: import("@mysten/bcs").BcsStruct<{
            dummy: import("@mysten/bcs").BcsType<number, number, "u8">;
        }, string>;
        LeaveCommittee: import("@mysten/bcs").BcsStruct<{
            dummy: import("@mysten/bcs").BcsType<number, number, "u8">;
        }, string>;
        ChangeCommittee: import("@mysten/bcs").BcsStruct<{
            dummy: import("@mysten/bcs").BcsType<number, number, "u8">;
        }, string>;
        Batch: import("@mysten/bcs").BcsType<import("@mysten/bcs").EnumOutputShapeWithKeys<{
            TokenTransfer: {
                token_id: Uint8Array<ArrayBufferLike>;
                recipient: Uint8Array<ArrayBufferLike>;
                amount: string;
                user_data: Uint8Array<ArrayBufferLike> | null;
            };
            TokenCreation: {
                token_name: string;
                decimals: number;
                initial_amount: string;
                mints: Uint8Array<ArrayBufferLike>[];
                user_data: Uint8Array<ArrayBufferLike> | null;
            };
            TokenManagement: {
                token_id: Uint8Array<ArrayBufferLike>;
                update_id: string;
                new_admin: Uint8Array<ArrayBufferLike> | null;
                mints: [import("@mysten/bcs").EnumOutputShapeWithKeys<{
                    Add: [];
                    Remove: [];
                }, "Add" | "Remove">, Uint8Array<ArrayBufferLike>][];
                user_data: Uint8Array<ArrayBufferLike> | null;
            };
            Mint: {
                token_id: Uint8Array<ArrayBufferLike>;
                recipient: Uint8Array<ArrayBufferLike>;
                amount: string;
            };
        }, "TokenTransfer" | "TokenCreation" | "TokenManagement" | "Mint">[], Iterable<import("@mysten/bcs").EnumInputShape<{
            TokenTransfer: {
                token_id: Iterable<number>;
                recipient: Iterable<number>;
                amount: string;
                user_data: Iterable<number> | null | undefined;
            };
            TokenCreation: {
                token_name: string;
                decimals: number;
                initial_amount: string;
                mints: Iterable<Iterable<number>> & {
                    length: number;
                };
                user_data: Iterable<number> | null | undefined;
            };
            TokenManagement: {
                token_id: Iterable<number>;
                update_id: string | number | bigint;
                new_admin: Iterable<number> | null | undefined;
                mints: Iterable<readonly [import("@mysten/bcs").EnumInputShape<{
                    Add: readonly [];
                    Remove: readonly [];
                }>, Iterable<number>]> & {
                    length: number;
                };
                user_data: Iterable<number> | null | undefined;
            };
            Mint: {
                token_id: Iterable<number>;
                recipient: Iterable<number>;
                amount: string;
            };
        }>> & {
            length: number;
        }, string>;
    }, "ClaimType">;
    archival: import("@mysten/bcs").BcsType<boolean, boolean, "bool">;
}, string>;
export type FastTransaction = Parameters<typeof TransactionBcs.serialize>[0];
export declare function hashTransaction(transaction: FastTransaction): string;
export declare const FAST_DECIMALS = 18;
/** Native SET token ID: [0xfa, 0x57, 0x5e, 0x70, 0, 0, ..., 0] */
export declare const SET_TOKEN_ID: Uint8Array<ArrayBuffer>;
export declare const EXPLORER_BASE = "https://explorer.fastset.xyz/txs";
/** Compare two token ID byte arrays for equality */
export declare function tokenIdEquals(a: number[] | Uint8Array, b: Uint8Array): boolean;
/** Parse a hex string (with or without 0x prefix) into a 32-byte token ID */
export declare function hexToTokenId(hex: string): Uint8Array;
//# sourceMappingURL=bcs.d.ts.map