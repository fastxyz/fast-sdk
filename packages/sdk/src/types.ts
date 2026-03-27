import { FAST_NETWORK_IDS } from './encoding/schema';

export type BytesLike = Uint8Array | ArrayLike<number>;

export type FastNetworkId = (typeof FAST_NETWORK_IDS)[number];